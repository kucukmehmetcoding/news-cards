// Büyüme ajanlarının ortak ölçütleri. Hedef: takipçi DIŞINA ulaşmak ve kaydedilip paylaşılmak.
// Beğeni ucuz sinyaldir; kaydetme + paylaşım öneri algoritmasının en güçlü sinyalidir, bu yüzden ağırlığı yüksektir.

const trHour = (t) => Number(new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }));
export { trHour };

// Bir ölçüm satırının (metrics.json media) puanı: erişim başına değerli etkileşim (binde).
export function value(r) {
  const reach = r.reach || r.views || 0;
  if (!reach) return null;
  const strong = 3 * (r.saved ?? 0) + 3 * (r.shares ?? 0) + 2 * (r.comments ?? 0) + (r.likes ?? 0) + 5 * (r.follows ?? 0);
  return (1000 * strong) / reach;
}

// Olgunlaşmış satırlar: yayından en az `hours` saat geçmiş (ilk saatlerdeki rakam yanıltır).
export const mature = (rows, hours = 24) => rows.filter((r) => Date.now() - r.at > hours * 3600e3 && (r.reach || r.views));

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
