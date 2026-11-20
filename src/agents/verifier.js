// Doğrulayıcı: yazılan kartı kaynak metne karşı denetler. Geçemeyen kart havuza girmez.
import { verifyCard } from '../lib/verify.js';
import { MODE, state } from '../newsroom/context.js';
import { log } from '../newsroom/desk.js';

// Haber "görüldü" işaretlenir ki her turda yeniden yazılmasın.
export async function checked(card, story) {
  if (card.writer === 'fallback') return true; // LLM'siz kart zaten otomatik modda yayınlanmaz (usable)
  const v = await verifyCard(card, story);
  if (v.ok) return true;
  console.warn(`DOĞRULANAMADI ${story.links[0]}: ${v.problems.map((p) => `[${p.rule}] ${p.text}`).join('; ')} — ${card.headline}`);
  log('verifier', 'rejected', story.links[0], { headline: card.headline, problems: v.problems, model: v.model });
  if (v.model !== 'yok') story.links.forEach((l) => (state.seen[l] = Date.now()));
  return false;
}

// Hiçbir model yanıt vermediyse kart, kaynağın başlığıyla yazılır (yafta ve ünlem içerebilir). Otomatik modda
// böyle kart yayınlanmaz; haber "görüldü" sayılmaz ve kota açılınca yeniden denenir.
export function usable(card) {
  if (MODE === 'manual' || card.writer !== 'fallback') return true;
  console.warn('Dil modeli yanıt vermedi (Gemini kotası/FreeLLMAPI erişimi); bu tur yeni haber yazılmıyor.');
  return false;
}
