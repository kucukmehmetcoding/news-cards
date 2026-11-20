// Grafik tasarımcı: habere görsel bulur (src/lib/image.js sırası) ve gönderi slaytlarını çizer.
import { readFileSync } from 'node:fs';
import { backgrounds, renderPost, renderStory, renderPages } from '../lib/render.js';
import { explainerPages, figurePage, dossierPages, commentaryPages } from '../lib/templates.js';
import { lineChartSvg } from '../lib/chart.js';
import { rateSeries } from './researcher.js';
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
// Kur haberinde açıklayıcıya son 30 günün TCMB kur grafiği eklenir (veri alınamazsa grafiksiz devam).
const CURRENCY = [[/\bdolar|\bkur\b|döviz/i, 'USD', 'Dolar/TL'], [/\beuro/i, 'EUR', 'Euro/TL']];
async function charts(d) {
  if (d.topic !== 'piyasa') return [];
  const hit = CURRENCY.find(([re]) => re.test(`${d.headline} ${d.originalTitle}`));
  if (!hit) return [];
  const series = await rateSeries(hit[1], 30);
  if (series.length < 5) return [];
  const svg = lineChartSvg(series, { accent: settings.categories[d.category]?.accent, digits: 2 });
  return [{ title: `SON 30 GÜN: ${hit[2].toLocaleUpperCase('tr-TR')}`, name: hit[2], svg, source: 'TCMB gösterge kuru (döviz satış)', series }];
}
export async function explainerSlides(post, d, x) {
  const c = await charts(d);
  post._charts = c; // Reels kareleri aynı grafikle çizilsin (kaydedilmez)
  if (c.length)
    post.charts = c.map(({ title, name, source, series }) => ({ title, name, source, from: series[0].date, to: series.at(-1).date, first: series[0].value, last: series.at(-1).value }));
  return renderPages(post, explainerPages(d, x, settings, photo(d), c), root);
}
// Reels kareleri: açıklayıcıyla aynı içerik, karusel yönergesi olmadan. Geçici dosyalar: <id>-f<n>.jpg
export const reelFrames = (post, d) =>
  renderPages({ id: `${post.id}-f` }, explainerPages(d, post.analysis, settings, photo(d), post._charts ?? [], { video: true }), root);
// Yorum slaytları: gönderinin kendi arka plan kopyası (post.bg) kullanılır — taslak bu arada bültene girip silinmiş olabilir.
export const commentarySlides = (post) => {
  const d = { ...post.items[0], sources: post.items[0].sources };
  const bg = `data:image/jpeg;base64,${readFileSync(root + post.bg).toString('base64')}`;
  return renderPages(post, commentaryPages(d, post.analysis, post.opinion.text, settings, bg, settings.commentary.signature, post.voices ?? []), root);
};
export const dossierSlides = (post, d, entries) => renderPages(post, dossierPages(d, entries, settings, photo(d)), root);
export const figureSlide = (post, d, figure, source) => renderPages(post, [figurePage(d, figure, source, settings, photo(d))], root);
