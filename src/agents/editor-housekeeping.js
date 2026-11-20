// Editörün havuz temizliği: bayatlayan haber ve bülten yayına çıkmaz.
import { settings, savePost, inPool, isGood, retire } from '../newsroom/context.js';

export function expireOld(drafts, posts) {
  // Güzel haber gündeme bağlı değil; günlük gönderiye yetişsin diye havuzda daha uzun kalır.
  for (const d of drafts)
    if (inPool(d) && Date.now() - d.createdAt > (isGood(d) ? 48 : settings.pool.expiryHours) * 3600e3) retire(d, 'expired');
  // Hiçbir platforma gidemeden bayatlayan bülten yayınlanmaz.
  for (const p of posts)
    if (p.status === 'approved' && Date.now() - p.createdAt > settings.bulletin.expiryHours * 3600e3) {
      p.status = 'expired';
      savePost(p);
    }
}
