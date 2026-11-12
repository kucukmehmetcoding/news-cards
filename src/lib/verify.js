// Yayın öncesi doğrulama: yazılan kart, kaynak metne karşı ikinci bir model çağrısıyla denetlenir.
// Yazar ile doğrulayıcı ayrı roldür; doğrulayıcı yazmaz, yalnız "geçer / geçmez" der ve gerekçe verir.
// Kural: doğrulanamayan kart havuza girmez (2026-10/11'de gelecek olaylar "oldu" diye yayınlandı).
import { askJson, PERSONA } from './llm.js';

const SYSTEM = `${PERSONA}
Görevin bir haber kartını KAYNAK METNE karşı denetlemek. Yazmazsın, düzeltmezsin; yalnız hata ararsın.
Bugünün tarihi ve kaynak haberin yayın zamanı verilir. Şunları denetle:
1. kip: Henüz gerçekleşmemiş bir olay (maç, karar, toplantı, açıklama) gerçekleşmiş gibi yazılmış mı? Planlanan olay "-acak/-ecek" ya da "bekleniyor" ile yazılmalı.
2. iddia: Kaynakta iddia, haber, kulis ya da "X'e göre" olarak geçen bilgi kesin olgu gibi yazılmış mı? Atıf korunmalı.
3. olgu: Kartta kaynakta OLMAYAN bir bilgi (rakam, saat, tarih, kişi, neden, sonuç) var mı? Rakamlar ve adlar kaynakla aynı mı?
4. birlik: Başlık ve özet aynı olayı mı anlatıyor? İki farklı olay tek habere karışmış mı?
5. dil: Türkçe karakterler eksik mi (ı, ş, ğ, ç, ö, ü, İ yerine ASCII), cümle yarım mı, abartı/yafta/duygusal sıfat var mı?
6. tür: Kaynak bir canlı blog, bahis/reklam tanıtımı, derleme yazısı ya da maç önü tahmin yazısıysa haber değildir.
Çıktı yalnızca JSON: {"ok": true|false, "problems": [{"rule": "kip|iddia|olgu|birlik|dil|tür", "text": "kısa açıklama"}]}
Emin olmadığın şüpheli durumda ok=false ver: yanlış haber yayınlamak, bir haberi kaçırmaktan çok daha pahalıdır.`;

const RULES = new Set(['kip', 'iddia', 'olgu', 'birlik', 'dil', 'tür']);

function validate(out) {
  if (typeof out.ok !== 'boolean') throw new Error('ok alanı yok');
  const problems = (Array.isArray(out.problems) ? out.problems : [])
    .filter((p) => p && typeof p.text === 'string')
    .map((p) => ({ rule: RULES.has(p.rule) ? p.rule : 'olgu', text: p.text.slice(0, 200) }));
  // Model "ok" deyip sorun listelediyse kart geçmez.
  return { ok: out.ok && problems.length === 0, problems };
}

// Model gerektirmeyen, kesin kurallar. Doğrulayıcı modele gitmeden önce uygulanır.
const TR_CHARS = /[ıİşŞğĞçÇöÖüÜ]/;
const LIVE_TITLE = /^\s*(live|canlı)\s*[:|–-]|\blive\s*[:|–-]|\bcanlı (anlatım|blog|yayın)\b/i;
const LIVE_URL = /\/live(blog)?(\/|-|$)|[?&]live/i;
const PROMO = /\b(misli|bahis|iddaa|nesine|bilyoner)\b|mislide|misli\.com/i;
const HYPE = /\b(inanılmaz|şok edici|şok eden|olay yaratan|herkesi şaşırtan|tarihi (bir )?an|bomba gibi|flaş flaş|akıl almaz)\b/i;

export function hardChecks(card, story) {
  const problems = [];
  const text = `${card.headline} ${card.brief} ${card.summary}`;
  // 60+ harflik Türkçe metinde hiç Türkçe karakter yoksa metin ASCII'ye düşmüştür.
  if (text.replace(/[^\p{L}]/gu, '').length > 60 && !TR_CHARS.test(text)) problems.push({ rule: 'dil', text: 'Türkçe karakter yok' });
  if ([story.titleEn, story.title].some((t) => LIVE_TITLE.test(t ?? '')) || (story.links ?? []).some((l) => LIVE_URL.test(l)))
    problems.push({ rule: 'tür', text: 'canlı blog' });
  if ([story.titleEn, story.title, ...(story.links ?? [])].some((t) => PROMO.test(t ?? ''))) problems.push({ rule: 'tür', text: 'bahis/reklam tanıtımı' });
  if (HYPE.test(text)) problems.push({ rule: 'dil', text: `abartı: ${text.match(HYPE)[0]}` });
  return problems;
}

const fmt = (t) => new Date(t).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'long', timeStyle: 'short' });

// Dönüş: {ok, problems, model}. Model yanıt vermezse kart GEÇMEZ (otomatik modda güvenli taraf).
export async function verifyCard(card, story) {
  const hard = hardChecks(card, story);
  if (hard.length) return { ok: false, problems: hard, model: 'kural' };
  const source = (story.article || story.description || '').slice(0, 6000);
  const user = [
    `Bugün: ${fmt(Date.now())}`,
    `Kaynak yayın zamanı: ${story.date ? fmt(story.date) : 'bilinmiyor'}`,
    `Kaynaklar: ${(story.sources ?? []).join(', ')}`,
    `Kaynak başlık: ${story.titleEn ?? story.title}`,
    `Kaynak metin: ${source || '(yok)'}`,
    '---',
    `KART başlık: ${card.headline}`,
    `KART kısa özet: ${card.brief}`,
    `KART açıklama özeti: ${card.summary}`,
    `KART maddeler: ${(card.details ?? []).join(' | ') || '(yok)'}`,
  ].join('\n');
  const res = await askJson(SYSTEM, user, validate, { temperature: 0 });
  if (!res) return { ok: false, problems: [{ rule: 'olgu', text: 'doğrulayıcı model yanıt vermedi' }], model: 'yok' };
  return { ...res.value, model: res.model };
}
