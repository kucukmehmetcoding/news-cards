const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'", '#39': "'" };

export function clean(html = '') {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (ENTITIES[e]) return ENTITIES[e];
      if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (/^#\d+$/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(
  've ile de da bir bu için olan olarak ise en çok daha son dakika haberi haber haberleri oldu etti dedi'.split(' ')
);

// Başlıkları kümelemek için: küçük harf, noktalama yok, kısa/boş kelimeler atılır.
export function tokens(title) {
  return new Set(
    title
      .toLocaleLowerCase('tr-TR')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.slice(0, 6)) // Türkçe ekleri kabaca buda
  );
}

export function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

export function sentence(s) {
  const t = s.trim().replace(/\s*[-–|]\s*$/, '');
  return /[.!?…"”]$/.test(t) ? t : t + '.';
}

export function firstSentences(s, max = 2, maxLen = 220) {
  const parts = s.match(/[^.!?]+[.!?]+/g) || [];
  const out = [];
  for (const p of parts) {
    const t = p.trim();
    if (t.length < 25) continue;
    if (out.join(' ').length + t.length > maxLen) break;
    out.push(t);
    if (out.length === max) break;
  }
  return out;
}
