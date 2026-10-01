import { sentence, firstSentences } from './text.js';
import { askJson, PERSONA } from './llm.js';

const SYSTEM = `${PERSONA}
Görevin haber kartı ve paylaşım metni yazmak. Yalnızca verilen başlık, özet ve haber metnindeki bilgiyi kullan; bilgi ekleme, tahmin yürütme, yorum katma.
Çıktı yalnızca JSON:
{"headline": "...", "details": ["..."], "summary": "...", "hashtags": ["..."], "image_subject": "...", "image_query": "...", "image_prompt": "..."}
- headline: haberin kendisi, tek cümle, en çok 140 karakter, geçmiş zaman bildirme kipi, nokta ile biter. İlgi çekici ama abartısız.
- Kaynağın kullandığı yafta ve yorum sıfatlarını ("soykırımcı", "hain", "skandal" gibi) metne taşıma; kişi ve ülkeleri yalın adlarıyla an.
- details: 0-3 kısa madde, her biri en çok 110 karakter; rakam, tarih, alıntı gibi somut ek bilgiler. Ek bilgi yoksa boş dizi.
- summary: paylaşım açıklaması için haberin özeti. 3-5 cümle, 350-700 karakter, düz paragraf. Kim, ne, nerede, ne zaman ve varsa neden/sonuç. Nötr ajans dili.
- hashtags: 6-8 etiket, "#" olmadan, boşluksuz, Türkçe karakter kullanılabilir. Haberin öznesi (kişi, kurum, takım, ülke), konusu ve 1-2 genel etiket (sondakika, haber, gündem, ekonomi, spor gibi). Alakasız popüler etiket yok.
- image_subject: haberin merkezinde gerçek, tanınmış bir kişi, kulüp, kurum ya da yer varsa onun adı (örn. "Mehmet Şimşek", "Galatasaray", "Soma"). Yoksa boş dize.
- image_query: İngilizce 2-3 kelimelik genel fotoğraf araması (örn. "oil tanker", "stock exchange", "football stadium").
- image_prompt: İngilizce, kartın arka planı için sembolik bir sahne tarifi (mekân, nesne, atmosfer). Gerçek kişi, yüz, yazı, logo, kan ya da şiddet içermez. En çok 30 kelime.
- Metinlerde emoji ve büyük harfle bağırma yok.`;

const DEFAULT_TAGS = {
  turkiye: ['sondakika', 'haber', 'gündem', 'türkiye'],
  dunya: ['sondakika', 'haber', 'dünya', 'gündem'],
  ekonomi: ['sondakika', 'ekonomi', 'borsa', 'piyasa', 'haber'],
  spor: ['spor', 'futbol', 'sondakika', 'haber'],
};

const tag = (t) => String(t).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function validate(out) {
  if (typeof out.headline !== 'string' || out.headline.length < 15) throw new Error('boş başlık');
  if (typeof out.summary !== 'string' || out.summary.length < 80) throw new Error('boş özet');
  return {
    headline: sentence(out.headline).slice(0, 180),
    details: (Array.isArray(out.details) ? out.details : []).filter((d) => typeof d === 'string' && d.trim()).slice(0, 3),
    summary: out.summary.trim().slice(0, 1500),
    hashtags: (Array.isArray(out.hashtags) ? out.hashtags : []).map(tag).filter((t) => t.length > 1).slice(0, 8),
    imageSubject: str(out.image_subject, 80),
    imageQuery: str(out.image_query, 80),
    imagePrompt: str(out.image_prompt, 300),
  };
}

function fallback(story) {
  const headline = sentence(story.title);
  const body = story.article || story.description;
  const details = firstSentences(story.description).filter((d) => !headline.startsWith(d.slice(0, 30)));
  const summary = firstSentences(body, 4, 700).join(' ') || headline;
  return { headline, details, summary, hashtags: [], imageSubject: '', imageQuery: '', imagePrompt: '' };
}

export async function writeCard(story) {
  const user = `Başlık: ${story.title}\nÖzet: ${story.description || '(yok)'}\nHaber metni: ${story.article || '(alınamadı)'}`;
  const res = await askJson(SYSTEM, user, validate);
  const card = res ? { ...res.value, writer: res.model } : { ...fallback(story), writer: 'fallback' };
  // Etiket her paylaşımda bulunur: model vermediyse kategori varsayılanları kullanılır.
  const tags = [...new Set([...card.hashtags, ...(card.hashtags.length >= 4 ? [] : DEFAULT_TAGS[story.category] ?? DEFAULT_TAGS.turkiye)])];
  return { ...card, hashtags: tags.slice(0, 8) };
}

const sourceLine = (d) => `Kaynak: ${d.sources.slice(0, 3).join(', ')}`;
const hashtagLine = (d) => (d.hashtags ?? []).map((t) => `#${t}`).join(' ');

function imageLine(d) {
  if (d.image?.kind === 'ai') return 'Görsel yapay zekâ ile üretilmiştir, temsilîdir.';
  if (d.image?.kind === 'photo') return `Arşiv fotoğrafı: ${d.image.credit}`;
  if (d.image?.kind === 'stock') return `Temsilî fotoğraf: ${d.image.credit}`;
  return '';
}

// Instagram/Facebook açıklaması: başlık + haberin özeti + kaynak + görsel notu + etiketler.
export function caption(draft) {
  const parts = [draft.headline];
  if (draft.summary && draft.summary !== draft.headline) parts.push(draft.summary);
  parts.push(sourceLine(draft));
  if (imageLine(draft)) parts.push(imageLine(draft));
  const tags = hashtagLine(draft);
  const body = parts.join('\n\n').slice(0, 2100 - tags.length);
  return tags ? `${body}\n\n${tags}` : body;
}

// Threads gibi kısa metin sınırı olan yerler için: başlık + sığdığı kadar tam cümle + kaynak.
export function shortCaption(draft, limit) {
  const source = sourceLine(draft);
  let text = draft.headline;
  for (const s of draft.summary?.match(/[^.!?]+[.!?]+["”]?/g) ?? []) {
    const next = `${text}${text === draft.headline ? '\n\n' : ' '}${s.trim()}`;
    if (next.length + source.length + 2 > limit) break;
    text = next;
  }
  return `${text}\n\n${source}`.slice(0, limit);
}
