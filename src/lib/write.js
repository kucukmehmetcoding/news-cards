import { sentence, firstSentences } from './text.js';

const SYSTEM = `Türkçe haber kartı yazarısın. Yalnızca verilen başlık ve özetteki bilgiyi kullan; bilgi ekleme, yorum katma.
Çıktı yalnızca JSON: {"headline": "...", "details": ["...", "..."]}
- headline: haberin kendisi, tek cümle, en çok 140 karakter, geçmiş zaman bildirme kipi, nokta ile biter.
- details: 0-3 kısa madde, her biri en çok 110 karakter; rakam, tarih, alıntı gibi somut ek bilgiler. Ek bilgi yoksa boş dizi.
- Emoji, hashtag, büyük harfle bağırma yok.`;

// OpenAI uyumlu herhangi bir uç nokta (LLM_BASE_URL) varsa onu kullanır.
async function llm(story) {
  const res = await fetch(`${process.env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.LLM_API_KEY ?? ''}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Başlık: ${story.title}\nÖzet: ${story.description || '(yok)'}` },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const raw = (await res.json()).choices[0].message.content;
  const out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  if (typeof out.headline !== 'string' || out.headline.length < 15) throw new Error('LLM boş başlık');
  return {
    headline: sentence(out.headline).slice(0, 180),
    details: (Array.isArray(out.details) ? out.details : []).filter((d) => typeof d === 'string').slice(0, 3),
  };
}

function fallback(story) {
  const headline = sentence(story.title);
  const details = firstSentences(story.description).filter((d) => !headline.startsWith(d.slice(0, 30)));
  return { headline, details };
}

export async function writeCard(story) {
  if (process.env.LLM_BASE_URL && process.env.LLM_MODEL) {
    try {
      return { ...(await llm(story)), writer: 'llm' };
    } catch (e) {
      console.warn(`LLM başarısız, başlık olduğu gibi kullanılıyor: ${e.message}`);
    }
  }
  return { ...fallback(story), writer: 'fallback' };
}

export function caption(draft) {
  return [
    draft.headline,
    ...draft.details.map((d) => `— ${d}`),
    `Kaynak: ${draft.sources.slice(0, 3).join(', ')}`,
  ].join('\n\n');
}
