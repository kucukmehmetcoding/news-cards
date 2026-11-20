// Topluluk: son gönderilerin yorumlarını okur, okurun ne sorduğunu/neye itiraz ettiğini özetler ve yanıt TASLAĞI yazar.
// Hiçbir şey göndermez — yanıtları insan onaylar (hesap güvenliği ve ton). Yorum izni yoksa sessizce atlar.
import { askJson, PERSONA } from '../../lib/llm.js';

const SYSTEM = `${PERSONA}
Görevin bir haber hesabının son gönderilerine gelen yorumları okumak.
Çıktı yalnızca JSON: {"themes": ["..."], "corrections": ["..."], "replies": [{"id": "...", "reply": "..."}]}
- themes: okurların en çok neyi sorduğu/konuştuğu, en çok 5 kısa madde.
- corrections: yorumcuların haberdeki olası bir HATAYA işaret ettiği durumlar (doğrulanmalı), yoksa boş dizi.
- replies: yalnız yanıtı hak eden (soru, düzeltme, teşekkür) en çok 5 yorum için kısa, nazik, tarafsız yanıt taslağı.
  Bilmediğin bilgiyi verme, tartışmaya girme, siyasi taraf tutma; hakaret/spam içeren yoruma yanıt yazma.`;

const validate = (o) => ({
  themes: (o.themes ?? []).filter((t) => typeof t === 'string').slice(0, 5),
  corrections: (o.corrections ?? []).filter((t) => typeof t === 'string').slice(0, 5),
  replies: (o.replies ?? []).filter((r) => r && typeof r.id === 'string' && typeof r.reply === 'string').slice(0, 5),
});

// fetchComments(mediaId) → [{id, text, username, timestamp}]; posts: [{id, cover, mediaId}]
export async function digest(posts, fetchComments) {
  const all = [];
  for (const p of posts) {
    try {
      for (const c of await fetchComments(p.mediaId)) all.push({ ...c, post: p.id, cover: p.cover });
    } catch (e) {
      return { error: e.message.slice(0, 200), comments: 0 };
    }
  }
  if (!all.length) return { comments: 0, themes: [], corrections: [], replies: [] };
  const user = all.slice(0, 80).map((c) => `[${c.id}] (gönderi: ${c.cover?.slice(0, 80)}) ${c.text.slice(0, 300)}`).join('\n');
  const res = await askJson(SYSTEM, user, validate, { tier: 'bulk' });
  const byId = Object.fromEntries(all.map((c) => [c.id, c]));
  return {
    comments: all.length,
    ...(res?.value ?? { themes: [], corrections: [], replies: [] }),
    replies: (res?.value.replies ?? []).filter((r) => byId[r.id]).map((r) => ({ ...r, comment: byId[r.id].text, post: byId[r.id].post })),
  };
}
