// Grafik tasarımcı: habere görsel bulur (src/lib/image.js sırası) ve gönderi slaytlarını çizer.
import { readFileSync } from 'node:fs';
import { backgrounds, renderPost, renderStory, renderPages } from '../lib/render.js';
import { explainerPages, figurePage } from '../lib/templates.js';
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

const photo = (d) => `data:image/jpeg;base64,${readFileSync(root + d.bg).toString('base64')}`;
export const explainerSlides = (post, d, x) => renderPages(post, explainerPages(d, x, settings, photo(d)), root);
export const figureSlide = (post, d, figure, source) => renderPages(post, [figurePage(d, figure, source, settings, photo(d))], root);
