// Yazar: seçilen olay için kaynak metni okur ve kartı (başlık, maddeler, özet, görsel tarifi) yazar.
import { articleText } from '../lib/article.js';
import { writeCard } from '../lib/write.js';
import { settings } from '../newsroom/context.js';

// Kaynak metin yeterli değilse (yabancı/güzel haber) null döner: yalnız başlıktan haber uydurulmaz.
export async function draft(c, { needText = false } = {}) {
  const article = await articleText(c.lead);
  if (needText && (article || c.description).length < settings.foreign.minText) return null;
  const story = { ...c, article };
  return { story, card: await writeCard(story) };
}
