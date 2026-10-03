import { sentence, firstSentences } from './text.js';
import { askJson, PERSONA } from './llm.js';

const SYSTEM = `${PERSONA}
Görevin haber kartı ve paylaşım metni yazmak. Yalnızca verilen başlık, özet ve haber metnindeki bilgiyi kullan; bilgi ekleme, tahmin yürütme, yorum katma.
Çıktı yalnızca JSON:
{"headline": "...", "details": ["..."], "brief": "...", "summary": "...", "hashtags": ["..."], "image_subject": "...", "image_query": "...", "image_prompt": "..."}
- headline: haberin kendisi, tek cümle, en çok 140 karakter, geçmiş zaman bildirme kipi, nokta ile biter. İlgi çekici ama abartısız.
- Kaynağın kullandığı yafta ve yorum sıfatlarını ("soykırımcı", "hain", "skandal" gibi) metne taşıma; kişi ve ülkeleri yalın adlarıyla an.
- details: 0-3 kısa madde, her biri en çok 110 karakter; rakam, tarih, alıntı gibi somut ek bilgiler. Ek bilgi yoksa boş dizi.
- brief: haberin 1-2 cümlelik kısa özeti, en çok 220 karakter; başlığı yinelemez, başlıkta olmayan en önemli bilgiyi verir.
- summary: paylaşım açıklaması için haberin özeti. 3-5 cümle, 350-700 karakter, düz paragraf. Kim, ne, nerede, ne zaman ve varsa neden/sonuç. Nötr ajans dili.
- hashtags: 6-8 etiket, "#" olmadan, boşluksuz, Türkçe karakter kullanılabilir. Haberin öznesi (kişi, kurum, takım, ülke), konusu ve 1-2 genel etiket (sondakika, haber, gündem, ekonomi, spor gibi). Alakasız popüler etiket yok.
- image_subject: haberin merkezinde gerçek, tanınmış bir kişi, kulüp, kurum ya da yer varsa onun adı (örn. "Mehmet Şimşek", "Galatasaray", "Soma"). Yoksa boş dize.
- image_query: İngilizce 2-3 kelimelik genel fotoğraf araması (örn. "oil tanker", "stock exchange", "football stadium").
- image_prompt: İngilizce, kartın arka planı için sembolik bir sahne tarifi (mekân, nesne, atmosfer). Gerçek kişi, yüz, yazı, logo, kan ya da şiddet içermez. En çok 30 kelime.
- Metinlerde emoji ve büyük harfle bağırma yok.
- Kaynak metin İngilizce olabilir: her alanı (image_* hariç) Türkçe yaz. Bu durumda özetin ilk cümlesinde kaynağı Türkçe ekiyle an
  ("BBC'nin haberine göre", "Guardian'ın aktardığına göre"). Çeviri yaparken anlamı ve kesinlik derecesini koru.
- Bilim/sağlık haberinde bulguyu abartma: "araştırmacılar ... buldu/gösterdi" kipini kullan, ön bulguyu kesin sonuç gibi yazma.`;

const DEFAULT_TAGS = {
  turkiye: ['sondakika', 'haber', 'gündem', 'türkiye'],
  dunya: ['sondakika', 'haber', 'dünya', 'gündem'],
  ekonomi: ['sondakika', 'ekonomi', 'borsa', 'piyasa', 'haber'],
  spor: ['spor', 'futbol', 'sondakika', 'haber'],
  dunyabasini: ['dünyabasını', 'dünya', 'haber', 'gündem'],
  iyihaber: ['güzelhaberler', 'iyihaber', 'dünya', 'bilim'],
};

const tag = (t) => String(t).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Metni tam cümlelerle `max` karaktere indirir. Cümle sonu, ardından boşluk ve büyük harf/rakam gelen
// noktadır; böylece "4.154,78" gibi sayılar ortadan bölünmez.
function fit(s, max) {
  let out = '';
  for (const p of s.split(/(?<=[.!?]["”]?)\s+(?=[\p{Lu}\d"“])/u)) {
    if (`${out} ${p}`.trim().length > max) break;
    out = `${out} ${p}`.trim();
  }
  return out;
}

function validate(out) {
  if (typeof out.headline !== 'string' || out.headline.length < 15) throw new Error('boş başlık');
  if (typeof out.summary !== 'string' || out.summary.length < 80) throw new Error('boş özet');
  return {
    headline: sentence(out.headline).slice(0, 180),
    details: (Array.isArray(out.details) ? out.details : []).filter((d) => typeof d === 'string' && d.trim()).slice(0, 3),
    brief: fit(str(out.brief, 600), 240),
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
  return { headline, details, brief: '', summary, hashtags: [], imageSubject: '', imageQuery: '', imagePrompt: '' };
}

export async function writeCard(story) {
  const lang = story.titleEn ? `Kaynak: ${story.sources.join(', ')} (İngilizce)\nÖzgün başlık: ${story.titleEn}\n` : '';
  const user = `${lang}Başlık: ${story.title}\nÖzet: ${story.description || '(yok)'}\nHaber metni: ${story.article || '(alınamadı)'}`;
  const res = await askJson(SYSTEM, user, validate);
  const card = res ? { ...res.value, writer: res.model } : { ...fallback(story), writer: 'fallback' };
  // Etiket her paylaşımda bulunur: model vermediyse kategori varsayılanları kullanılır.
  const tags = [...new Set([...card.hashtags, ...(card.hashtags.length >= 4 ? [] : DEFAULT_TAGS[story.category] ?? DEFAULT_TAGS.turkiye)])];
  // Kısa özet modelden gelmediyse (ya da sınırı aştıysa) özetin ilk cümlelerinden alınır.
  const brief = card.brief || fit(card.summary, 240);
  return { ...card, brief, hashtags: tags.slice(0, 8) };
}

const GENERAL = {
  bulletin: { tags: ['sondakika', 'haber', 'gündem'], title: (n) => `Gündemden ${n} başlık` },
  goodnews: { tags: ['güzelhaberler', 'iyihaber', 'dünya'], title: () => 'Dünyadan güzel haberler' },
};
const general = (post) => GENERAL[post.kind] ?? GENERAL.bulletin;
const title = (post) => general(post).title(post.items.length);

// Bülten etiketleri: her haberden en belirleyici iki etiket (en çok 7) + genel etiketler.
function hashtagLine(post) {
  const { tags } = general(post);
  const own = post.items.flatMap((s) => (s.hashtags ?? []).filter((t) => !tags.includes(t)).slice(0, 2));
  return [...new Set([...own.slice(0, 7), ...tags])].map((t) => `#${t}`).join(' ');
}

// Instagram/Facebook açıklaması: numaralı başlıklar, her haberin kısa özeti ve kaynağı, sonda etiketler.
// 2200 karakter sınırına sığmazsa kısa özetler sondan başlayarak düşer; başlık ve kaynak her zaman kalır.
export function caption(post, limit = 2200) {
  const tags = hashtagLine(post);
  const note = post.items.some((s) => s.image?.kind === 'ai') ? 'Yapay zekâ ile üretilen görseller temsilîdir.' : '';
  const build = (briefs) =>
    [
      title(post),
      ...post.items.map((s, i) => [`${i + 1}) ${s.headline}`, i < briefs && s.brief, `Kaynak: ${s.sources.slice(0, 3).join(', ')}`].filter(Boolean).join('\n')),
      note,
      tags,
    ]
      .filter(Boolean)
      .join('\n\n');
  let briefs = post.items.length;
  while (briefs > 0 && build(briefs).length > limit) briefs--;
  return build(briefs).slice(0, limit);
}

// Threads gibi kısa metin sınırı olan yerler için: sığdığı kadar numaralı başlık.
export function shortCaption(post, limit) {
  let text = title(post);
  for (const [i, s] of post.items.entries()) {
    const next = `${text}${i ? '\n' : '\n\n'}${i + 1}) ${s.headline}`;
    if (next.length > limit) break;
    text = next;
  }
  return text;
}
