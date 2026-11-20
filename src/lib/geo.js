// Konum haritası: haberde geçen ülkeyi bulur ve bölgesini gösteren küçük bir SVG çizer.
// Veri: world-atlas (Natural Earth 1:110m, kamu malı). Ülke tespiti sözlükle yapılır — model yok, uydurma yok:
// metinde sözlükteki bir ülke adı geçmiyorsa harita çizilmez.
import { createRequire } from 'node:module';
import { geoEqualEarth, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const world = require('world-atlas/countries-110m.json');
const countries = feature(world, world.objects.countries).features;
const byName = new Map(countries.map((c) => [c.properties.name, c]));

// Türkçe ad, TAM kelime (özel adın eki kesme ile ayrılır: "Fas'ta" → "fas ta"; böylece "fasulye" eşleşmez) → world-atlas adı. Sık geçen ülkeler; gerektikçe genişletilir.
const TR = {
  'abd': 'United States of America', 'amerika birleşik devletleri': 'United States of America', 'rusya': 'Russia', 'ukrayna': 'Ukraine', 'çin': 'China',
  'israil': 'Israel', 'iran': 'Iran', 'irak': 'Iraq', 'suriye': 'Syria', 'lübnan': 'Lebanon', 'ürdün': 'Jordan', 'mısır': 'Egypt',
  'suudi arabistan': 'Saudi Arabia', 'yemen': 'Yemen', 'katar': 'Qatar', 'birleşik arap emirlikleri': 'United Arab Emirates', 'bae': 'United Arab Emirates',
  'almanya': 'Germany', 'fransa': 'France', 'ingiltere': 'United Kingdom', 'birleşik krallık': 'United Kingdom', 'italya': 'Italy', 'ispanya': 'Spain',
  'yunanistan': 'Greece', 'bulgaristan': 'Bulgaria', 'polonya': 'Poland', 'hollanda': 'Netherlands', 'belçika': 'Belgium', 'avusturya': 'Austria',
  'isveç': 'Sweden', 'norveç': 'Norway', 'finlandiya': 'Finland', 'macaristan': 'Hungary', 'romanya': 'Romania', 'sırbistan': 'Serbia',
  'azerbaycan': 'Azerbaijan', 'gürcistan': 'Georgia', 'ermenistan': 'Armenia', 'kazakistan': 'Kazakhstan', 'özbekistan': 'Uzbekistan',
  'afganistan': 'Afghanistan', 'pakistan': 'Pakistan', 'hindistan': 'India', 'japonya': 'Japan', 'güney kore': 'South Korea', 'kuzey kore': 'North Korea',
  'endonezya': 'Indonesia', 'avustralya': 'Australia', 'kanada': 'Canada', 'meksika': 'Mexico', 'brezilya': 'Brazil', 'arjantin': 'Argentina',
  'venezuela': 'Venezuela', 'küba': 'Cuba', 'libya': 'Libya', 'sudan': 'Sudan', 'etiyopya': 'Ethiopia', 'somali': 'Somalia', 'nijerya': 'Nigeria',
  'güney afrika': 'South Africa', 'cezayir': 'Algeria', 'fas': 'Morocco', 'tunus': 'Tunisia', 'tayvan': 'Taiwan', 'filistin': 'Palestine',
  'gazze': 'Israel', 'rus': 'Russia', 'husi': 'Yemen', 'husiler': 'Yemen', 'hamas': 'Israel', 'hizbullah': 'Lebanon', 'çinli': 'China', 'grönland': 'Greenland', 'danimarka': 'Denmark', 'portekiz': 'Portugal', 'irlanda': 'Ireland', 'isviçre': 'Switzerland',
};
const keys = Object.keys(TR).sort((a, b) => b.length - a.length);
const norm = (s) => ` ${s.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ')} `;

// Metinde ilk geçen ülke (Türkiye hariç: kendi gündemimiz için harita bilgi taşımaz).
export function detectCountry(text) {
  const t = norm(text ?? '');
  let best = null;
  for (const k of keys) {
    const i = t.indexOf(` ${k} `);
    if (i >= 0 && (!best || i < best.i)) best = { i, name: TR[k] };
  }
  return best && byName.has(best.name) ? best.name : null;
}

// Metinde geçen TÜM ülkeler (sözlükteki), atlas adıyla.
export function detectCountries(text) {
  const t = norm(text ?? '');
  return [...new Set(keys.filter((k) => t.includes(` ${k} `)).map((k) => TR[k]))];
}

// İngilizce başlıkta ülkeyi yakalamak için ad + sıfat kökleri (araştırmacının ön süzgeci).
const EN = {
  'United States of America': ['US', 'U.S.', 'America', 'American', 'Washington', 'Trump'], Russia: ['Russia', 'Russian', 'Moscow', 'Kremlin', 'Putin'],
  Ukraine: ['Ukraine', 'Ukrainian', 'Kyiv', 'Zelensky'], China: ['China', 'Chinese', 'Beijing', 'Xi'], Israel: ['Israel', 'Israeli', 'IDF', 'Netanyahu', 'Gaza', 'Hamas', 'Palestinian'],
  Iran: ['Iran', 'Iranian', 'Tehran'], Iraq: ['Iraq', 'Iraqi', 'Baghdad'], Syria: ['Syria', 'Syrian', 'Damascus'], Lebanon: ['Lebanon', 'Lebanese', 'Hezbollah', 'Beirut'],
  Yemen: ['Yemen', 'Yemeni', 'Houthi', 'Sanaa', 'Ansarallah'], Palestine: ['Gaza', 'Palestinian', 'Hamas', 'West Bank'], Egypt: ['Egypt', 'Egyptian', 'Cairo'],
  'Saudi Arabia': ['Saudi', 'Riyadh'], Qatar: ['Qatar', 'Qatari', 'Doha'], Poland: ['Poland', 'Polish', 'Warsaw'], Germany: ['Germany', 'German', 'Berlin'],
  France: ['France', 'French', 'Paris'], 'United Kingdom': ['Britain', 'British', 'UK', 'London'], Taiwan: ['Taiwan', 'Taiwanese', 'Taipei'],
  Turkey: ['Turkey', 'Türkiye', 'Turkish', 'Ankara', 'Erdogan'], Jordan: ['Jordan', 'Jordanian', 'Amman'], 'United Arab Emirates': ['UAE', 'Emirati', 'Abu Dhabi'],
  Libya: ['Libya', 'Libyan', 'Tripoli'], Sudan: ['Sudan', 'Sudanese', 'Khartoum'], 'North Korea': ['North Korea', 'Pyongyang'], Japan: ['Japan', 'Japanese', 'Tokyo'],
};
export const englishNames = (country) => EN[country] ?? [country];

// Ülkeyi çevresiyle gösteren harita. Küçük ülkede çerçeve en az ~25° genişlikte tutulur ki bölge tanınsın.
export function locatorSvg(name, { accent = '#2E86AB', width = 360, height = 300 } = {}) {
  const target = byName.get(name);
  if (!target) return '';
  const probe = geoPath(geoEqualEarth());
  const [[x0, y0], [x1, y1]] = probe.bounds(target);
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const span = Math.max(x1 - x0, y1 - y0, 70) * 1.6;
  const frame = { type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [geoEqualEarth().invert([cx - span / 2, cy - span / 2]), geoEqualEarth().invert([cx + span / 2, cy + span / 2])] } };
  const projection = geoEqualEarth().fitExtent([[10, 10], [width - 10, height - 10]], frame);
  const path = geoPath(projection);
  const land = countries
    .filter((c) => c !== target)
    .map((c) => path(c))
    .filter(Boolean)
    .map((d) => `<path d="${d}" fill="#ffffff26" stroke="#ffffff40" stroke-width="0.6"/>`)
    .join('');
  const [px, py] = path.centroid(target);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<defs><clipPath id="c"><rect width="${width}" height="${height}" rx="18"/></clipPath></defs>
<g clip-path="url(#c)"><rect width="${width}" height="${height}" fill="#0b0f16d9"/>${land}
<path d="${path(target)}" fill="${accent}" stroke="#fff" stroke-width="1.2"/>
<circle cx="${px}" cy="${py}" r="7" fill="#fff" stroke="${accent}" stroke-width="3"/></g></svg>`;
}
