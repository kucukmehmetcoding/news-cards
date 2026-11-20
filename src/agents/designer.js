// Grafik tasarımcı: habere görsel bulur (src/lib/image.js sırası) ve gönderi slaytlarını çizer.
import { backgrounds, renderPost, renderStory } from '../lib/render.js';
import { root, settings, loadPosts, trDay } from '../newsroom/context.js';

// Bugün fotoğrafı kullanılmış özneler (havuz + bugünkü gönderiler): aynı yüz gün içinde ikinci kez kapak olmaz.
function subjectsUsedToday(open) {
  const todays = loadPosts().filter((p) => trDay(p.createdAt) === trDay(Date.now()) && p.status !== 'rejected').flatMap((p) => p.items);
  return new Set([...open, ...todays].filter((d) => d.image?.kind === 'photo' && d.imageSubject).map((d) => d.imageSubject.toLocaleLowerCase('tr-TR')));
}

// Seçilen haberlere arka plan görseli atar (d.bg, d.image). Görsel bulunamayan haberde d.bg boş kalır.
export async function illustrate(picked, open) {
  const used = subjectsUsedToday(open);
  await backgrounds(picked, settings, root, new Set(open.map((d) => d.image?.file).filter(Boolean)), used);
}

export const slides = (post, stories) => renderPost(post, stories, settings, root);
export const storySlide = (post, d) => renderStory(post, d, settings, root);
