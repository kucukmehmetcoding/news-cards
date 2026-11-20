// Zamanlayıcı: kanalın kendi ölçümünden, hangi saat diliminde paylaşılan içeriğin daha çok eriştiğini öğrenir.
// Saatler 3 saatlik dilimlere toplanır (veri az; tek saat gürültülü). Yeterli örnek yoksa öneri yapılmaz.
// Uygulama: yalnız zamana duyarsız türler (açıklayıcı, rakam, dosya, reels) en iyi dilime kadar bekletilir;
// bülten ve hikâye gündem içindir, bekletilmez.
import { trHour, mature, median } from './score.js';

const SLOT = 3;
const slotOf = (h) => Math.floor(h / SLOT) * SLOT;
export const EVERGREEN = ['explainer', 'figure', 'dossier', 'reel'];

// rows: metrics.media değerleri. Dönüş: { bySlot: {slot: {n, reach}}, best: [slot...], n }
export function plan(rows, { minPerSlot = 4, activeHours = [7, 24] } = {}) {
  const data = mature(rows).filter((r) => r.kind !== 'story');
  const slots = {};
  for (const r of data) (slots[slotOf(trHour(r.at))] ??= []).push(r.reach || r.views);
  const bySlot = Object.fromEntries(
    Object.entries(slots)
      .filter(([s]) => Number(s) >= slotOf(activeHours[0]) && Number(s) < activeHours[1])
      .map(([s, xs]) => [s, { n: xs.length, reach: Math.round(median(xs)) }])
  );
  const ranked = Object.entries(bySlot)
    .filter(([, v]) => v.n >= minPerSlot)
    .sort((a, b) => b[1].reach - a[1].reach);
  // En iyi iki dilim; ikincisi birincinin %85'inden azsa tek dilim.
  const best = ranked.slice(0, 2).filter(([, v], i) => i === 0 || v.reach >= 0.85 * ranked[0][1].reach).map(([s]) => Number(s));
  return { bySlot, best, n: data.length, slot: SLOT };
}

// Şimdi bu tür yayınlanmalı mı? Öneri yoksa ya da tür gündem türüyse her zaman evet.
// En çok 5 saat bekletilir: onaylı gönderi 6 saatte bayatlar (settings.bulletin.expiryHours).
export function due(kind, schedule, hour, createdAt, maxHoldHours = 5) {
  if (!EVERGREEN.includes(kind) || !schedule?.best?.length) return true;
  if (Date.now() - createdAt > maxHoldHours * 3600e3) return true; // sonsuza dek bekletme
  return schedule.best.includes(slotOf(hour));
}
