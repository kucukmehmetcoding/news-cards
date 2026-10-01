import { sentence, firstSentences } from './text.js';

const SYSTEM = `Türkçe haber kartı editörüsün. Yalnızca verilen başlık, özet ve haber metnindeki bilgiyi kullan; bilgi ekleme, tahmin yürütme, yorum katma.
Çıktı yalnızca JSON:
{"headline": "...", "details": ["..."], "summary": "...", "image_prompt": "..."}
- headline: haberin kendisi, tek cümle, en çok 140 karakter, geçmiş zaman bildirme kipi, nokta ile biter.
- details: 0-3 kısa madde, her biri en çok 110 karakter; rakam, tarih, alıntı gibi somut ek bilgiler. Ek bilgi yoksa boş dizi.
- summary: Instagram açıklaması için haberin özeti. 3-5 cümle, 350-700 karakter, düz paragraf. Kim, ne, nerede, ne zaman ve varsa neden/sonuç. Nötr ajans dili.
- image_prompt: İngilizce, kartın arka planı için sembolik bir sahne tarifi (mekân, nesne, atmosfer). Gerçek kişi, yüz, yazı, logo, bayrak üzerinde yazı, kan ya da şiddet içermez. En çok 30 kelime.
- Emoji, hashtag, büyük harfle bağırma yok.`;

// Sırayla denenir; ilk yanıt veren kullanılır. GEMINI_MODEL ile başa model eklenebilir.
const MODELS = [process.env.GEMINI_MODEL, 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].filter(Boolean);

async function gemini(model, story) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        {
          role: 'user',
          parts: [{ text: `Başlık: ${story.title}\nÖzet: ${story.description || '(yok)'}\nHaber metni: ${story.article || '(alınamadı)'}` }],
        },
      ],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`${model} ${res.status} ${(await res.text()).slice(0, 160)}`);
  const raw = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  if (typeof out.headline !== 'string' || out.headline.length < 15) throw new Error(`${model} boş başlık`);
  if (typeof out.summary !== 'string' || out.summary.length < 80) throw new Error(`${model} boş özet`);
  return {
    headline: sentence(out.headline).slice(0, 180),
    details: (Array.isArray(out.details) ? out.details : []).filter((d) => typeof d === 'string' && d.trim()).slice(0, 3),
    summary: out.summary.trim().slice(0, 1500),
    imagePrompt: typeof out.image_prompt === 'string' ? out.image_prompt.slice(0, 300) : '',
  };
}

function fallback(story) {
  const headline = sentence(story.title);
  const body = story.article || story.description;
  const details = firstSentences(story.description).filter((d) => !headline.startsWith(d.slice(0, 30)));
  const summary = firstSentences(body, 4, 700).join(' ') || headline;
  return { headline, details, summary, imagePrompt: '' };
}

export async function writeCard(story) {
  if (process.env.GEMINI_API_KEY) {
    for (const model of MODELS) {
      try {
        return { ...(await gemini(model, story)), writer: model };
      } catch (e) {
        console.warn(`Gemini başarısız: ${e.message}`);
      }
    }
  }
  return { ...fallback(story), writer: 'fallback' };
}

// Açıklama: başlık + haberin özeti + kaynak. Hashtag yok.
export function caption(draft) {
  const parts = [draft.headline];
  if (draft.summary && draft.summary !== draft.headline) parts.push(draft.summary);
  parts.push(`Kaynak: ${draft.sources.slice(0, 3).join(', ')}`);
  if (draft.background) parts.push('Görsel yapay zekâ ile üretilmiştir, temsilîdir.');
  return parts.join('\n\n').slice(0, 2100);
}
