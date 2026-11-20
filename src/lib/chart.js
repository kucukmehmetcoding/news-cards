// Veri grafiği: zaman serisini (ör. TCMB dolar kuru) kart içinde okunabilir bir çizgi grafiğe çevirir.
// Saf SVG; değerler yalnız verilen seriden gelir, eksen ve etiketler veriden hesaplanır.
const fmt = (v, digits) => v.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// series: [{ date: 'YYYY-MM-DD', value: number }] eskiden yeniye.
export function lineChartSvg(series, { accent = '#3BB273', width = 920, height = 560, digits = 2 } = {}) {
  if (series.length < 2) return '';
  const pad = { l: 20, r: 150, t: 30, b: 60 };
  const vals = series.map((p) => p.value);
  let [lo, hi] = [Math.min(...vals), Math.max(...vals)];
  const margin = (hi - lo || hi * 0.01) * 0.15;
  [lo, hi] = [lo - margin, hi + margin];
  const x = (i) => pad.l + (i / (series.length - 1)) * (width - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  const grid = [0, 0.5, 1]
    .map((f) => lo + f * (hi - lo))
    .map((v) => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#ffffff22" stroke-width="2"/>` +
      `<text x="${width - pad.r + 16}" y="${y(v) + 10}" fill="#ffffffa0" font-size="28" font-weight="500">${fmt(v, digits)}</text>`)
    .join('');
  const last = series.at(-1);
  const label = (p) => p.date.slice(8, 10) + '.' + p.date.slice(5, 7);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Inter,sans-serif">
${grid}
<polygon points="${pad.l},${height - pad.b} ${pts.join(' ')} ${x(series.length - 1)},${height - pad.b}" fill="${accent}22"/>
<polyline points="${pts.join(' ')}" fill="none" stroke="${accent}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="${x(series.length - 1)}" cy="${y(last.value)}" r="12" fill="${accent}" stroke="#fff" stroke-width="4"/>
<text x="${pad.l}" y="${height - 14}" fill="#ffffffa0" font-size="28" font-weight="500">${label(series[0])}</text>
<text x="${width - pad.r}" y="${height - 14}" fill="#ffffffa0" font-size="28" font-weight="500" text-anchor="end">${label(last)}</text>
</svg>`;
}
