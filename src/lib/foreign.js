// Yabancı (İngilizce) kaynaklar: başlıkların Türkçeye çevrilmesi ve "Dünyadan güzel haberler" seçimi.
// Çeviri yalnızca SEÇİM içindir (kümeleme, puanlama); kart metni writeCard'da kaynak metinden yazılır.
import { askJson, llmAvailable, PERSONA } from './llm.js';

const TRANSLATE = `${PERSONA}
Görevin İngilizce haber başlıklarını Türkçeye çevirmek. Anlamı değiştirme, ekleme yapma; kişi, kurum ve yer adlarını ve rakamları koru.
Türkiye için "Türkiye" yaz. Çıktı yalnızca JSON dizi: [{"i": 0, "tr": "..."}, ...] — her başlık için bir öğe.`;

// İngilizce öğelerin `title` alanını Türkçeye çevirir (`titleEn` korunur). Model yoksa ya da çeviri
// gelmezse o öğe listeden çıkar: çevrilmemiş başlık Türkçe haberlerle eşleşemez ve yayınlanamaz.
// `cache` (bağlantı → [çeviri, zaman]) sayesinde aynı başlık her saat yeniden çevrilmez.
export async function translateTitles(items, max, cache = {}) {
  const tr = items.filter((it) => it.lang !== 'en');
  const hit = items.filter((it) => it.lang === 'en' && cache[it.link]).map((it) => ({ ...it, titleEn: it.title, title: cache[it.link][0] }));
  const en = items.filter((it) => it.lang === 'en' && !cache[it.link]).sort((a, b) => b.date - a.date).slice(0, max);
  if (!en.length || !llmAvailable()) return [...tr, ...hit];
  const res = await askJson(
    TRANSLATE,
    en.map((it, i) => `${i}. ${it.title}`).join('\n'),
    (arr) => {
      const out = new Map(arr.filter((r) => Number.isInteger(r.i) && typeof r.tr === 'string' && r.tr.trim()).map((r) => [r.i, r.tr.trim()]));
      if (out.size < en.length / 2) throw new Error('eksik çeviri');
      return out;
    },
    { temperature: 0, open: '[', close: ']', tier: 'bulk' }
  );
  if (!res) return [...tr, ...hit];
  const done = en.flatMap((it, i) => (res.value.has(i) ? [{ ...it, titleEn: it.title, title: res.value.get(i) }] : []));
  done.forEach((it) => (cache[it.link] = [it.title, Date.now()]));
  console.log(`${done.length}/${en.length} yeni yabancı başlık çevrildi (${res.model}), ${hit.length} önbellekten.`);
  return [...tr, ...hit, ...done];
}

const GOOD = `${PERSONA}
Görevin "Dünyadan güzel haberler" gönderisi için haber seçmek. Her başlığa 0-10 puan ver.
Yüksek puan (8-10): somut, doğrulanabilir olumlu gelişme — bilimsel/tıbbi ilerleme (abartısız), çevre ve doğa koruma başarısı,
hayvanların kurtarılması, toplumsal dayanışma, insanların hayatını iyileştiren yenilik, rekor ya da ilk; Türk okurun da ilgisini çekecek evrensel konu.
0 puan: astroloji/burç, reklam, ürün tanıtımı, liste/kılavuz/tavsiye yazısı, alıntı derlemesi, siyaset, savaş, ölüm, tek çalışmaya dayanıp
"kanseri yendi" gibi kesinlik iddia eden başlık, sözde bilim, yalnızca tek bir ülkenin yerel ilgisine hitap eden haber.
Çıktı yalnızca JSON dizi: [{"i": 0, "score": 8}, ...] — her başlık için bir öğe.`;

export async function scoreGood(all, cache = {}) {
  const mark = (c, score) => ({ ...c, interest: score, topic: 'iyi', category: 'iyihaber' });
  const known = all.filter((c) => cache[c.lead]).map((c) => mark(c, cache[c.lead][0]));
  const candidates = all.filter((c) => !cache[c.lead]);
  if (!candidates.length || !llmAvailable()) return known;
  const res = await askJson(
    GOOD,
    candidates.map((c, i) => `${i}. ${c.titleEn ?? c.title}`).join('\n'),
    (arr) => {
      const out = new Map(arr.filter((r) => Number.isInteger(r.i) && typeof r.score === 'number').map((r) => [r.i, r.score]));
      if (out.size < candidates.length / 2) throw new Error('eksik puan');
      return out;
    },
    { temperature: 0, open: '[', close: ']', tier: 'bulk' }
  );
  if (!res) return known;
  const scored = candidates.map((c, i) => mark(c, res.value.get(i) ?? 0));
  scored.forEach((c) => (cache[c.lead] = [c.interest, Date.now()]));
  return [...known, ...scored];
}
