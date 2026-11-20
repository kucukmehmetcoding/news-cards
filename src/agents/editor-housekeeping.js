// Editörün havuz temizliği: bayatlayan haber ve bülten yayına çıkmaz.
import { rmSync } from 'node:fs';
import { settings, savePost, inPool, isGood, retire, root } from '../newsroom/context.js';

export function expireOld(drafts, posts) {
  // Güzel haber gündeme bağlı değil; günlük gönderiye yetişsin diye havuzda daha uzun kalır.
  for (const d of drafts)
    if (inPool(d) && Date.now() - d.createdAt > (isGood(d) ? 48 : settings.pool.expiryHours) * 3600e3) retire(d, 'expired');
  // Yanıtlanmayan yorum adayı bayatlar (gündem geçer).
  for (const p of posts)
    if (['awaiting', 'flagged'].includes(p.status) && Date.now() - p.createdAt > settings.commentary.awaitHours * 3600e3) {
      p.status = 'expired';
      if (p.bg) rmSync(root + p.bg, { force: true });
      savePost(p);
    }
  // Hiçbir platforma gidemeden bayatlayan gönderi yayınlanmaz (onay bekleyen yorumda süre onaydan başlar).
  for (const p of posts)
    if (p.status === 'approved' && Date.now() - (p.approvedAt ?? p.createdAt) > settings.bulletin.expiryHours * 3600e3) {
      p.status = 'expired';
      savePost(p);
    }
}
