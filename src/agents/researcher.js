// Araştırmacı: seçilen haber için kaynağı belli, ücretsiz ve anahtarsız arka plan toplar.
// Ürettiği her olgu { text, source, url } biçimindedir; Yorumcu yalnız bunları ve haber metnini kullanabilir,
// Doğrulayıcı da kartı bunlara karşı denetler. Bulunamayan bilgi uydurulmaz — liste boş kalır.
//   1) Dosya: aynı özne/olay hakkında son 14 günde havuza girmiş haberler (zaman çizelgesi)
//   2) Vikipedi (tr) özeti: haberin öznesi tanınmış bir kişi/kurum ise
//   3) TCMB gösterge kurları (today.xml): piyasa haberlerinde güncel dolar/euro
import { loadDrafts, sameEvent, ev, trDay } from '../newsroom/context.js';
import { log } from '../newsroom/desk.js';

const UA = { 'user-agent': 'news-cards/1.0 (github.com/kucukmehmetcoding/news-cards)' };
const get = async (url, as = 'json') => {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === 'json' ? res.json() : res.text();
};

// Aynı olayın ya da aynı öznenin son 14 günlük haberleri, eskiden yeniye.
export function timeline(d, drafts = loadDrafts()) {
  const since = Date.now() - 14 * 86400e3;
  return drafts
    .filter((x) => x.id !== d.id && x.createdAt > since && x.status !== 'rejected')
    .filter((x) => sameEvent(ev(x), ev(d)))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-5)
    .map((x) => ({ text: `${trDay(x.createdAt)}: ${x.headline}`, day: trDay(x.createdAt), headline: x.headline, source: x.sources.slice(0, 2).join(', '), url: x.links?.[0] }));
}

async function wikipedia(subject) {
  if (!subject) return [];
  try {
    const s = await get(`https://tr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(subject.replace(/ /g, '_'))}`);
    if (s.type !== 'standard' || !s.extract) return [];
    const text = s.extract.split(/(?<=\.)\s+/).slice(0, 2).join(' ').slice(0, 400);
    return [{ text, source: 'Vikipedi', url: s.content_urls?.desktop?.page }];
  } catch {
    return [];
  }
}

const PIYASA = /dolar|euro|kur|döviz|faiz|enflasyon|altın|borsa|tcmb|merkez bankası/i;

async function tcmb(d) {
  if (d.topic !== 'piyasa' && !PIYASA.test(`${d.headline} ${d.originalTitle}`)) return [];
  try {
    const xml = await get('https://www.tcmb.gov.tr/kurlar/today.xml', 'text');
    const date = xml.match(/Tarih="([^"]+)"/)?.[1];
    const rate = (code) => xml.match(new RegExp(`Kod="${code}"[\\s\\S]*?<ForexSelling>([\\d.]+)<`))?.[1];
    return ['USD', 'EUR']
      .map((c) => [c, rate(c)])
      .filter(([, r]) => r)
      .map(([c, r]) => ({
        text: `TCMB gösterge kuru (${date}): 1 ${c === 'USD' ? 'ABD doları' : 'euro'} = ${Number(r).toLocaleString('tr-TR', { maximumFractionDigits: 4 })} TL (döviz satış)`,
        source: 'TCMB',
        url: 'https://www.tcmb.gov.tr/kurlar/today.xml',
      }));
  } catch {
    return [];
  }
}

// Sesler: duruşu belli kaynakların aynı olaya attığı başlık — olgu değil, "kim ne diyor" bilgisidir.
export const voiceFacts = (d) =>
  (d.voices ?? []).map((v) => ({ text: `${v.source} (${v.stance}) başlığı: "${v.title}"`, source: v.source, url: v.link, voice: true }));

export async function research(d) {
  const facts = [...timeline(d), ...voiceFacts(d), ...(await wikipedia(d.imageSubject)), ...(await tcmb(d))];
  log('researcher', 'researched', d.id, { facts: facts.length, sources: [...new Set(facts.map((f) => f.source))] });
  return facts;
}

// Yorumcu ve Doğrulayıcı için düz metin.
export const factsText = (facts) => facts.map((f, i) => `[A${i + 1}] ${f.text} (${f.source})`).join('\n') || '(yok)';

// TCMB arşivinden günlük döviz satış kuru serisi (iş günleri; tatilde dosya yoktur). Grafik için.
// code: 'USD' | 'EUR'. Dönüş: [{date:'YYYY-MM-DD', value}] eskiden yeniye; alınamazsa boş dizi.
export async function rateSeries(code, days = 30) {
  const dates = [];
  for (let i = days; i >= 0; i--) {
    const t = new Date(Date.now() - i * 86400e3);
    if ([0, 6].includes(t.getUTCDay())) continue;
    dates.push(t.toISOString().slice(0, 10));
  }
  const one = async (iso) => {
    const [y, m, d] = iso.split('-');
    try {
      const xml = await get(`https://www.tcmb.gov.tr/kurlar/${y}${m}/${d}${m}${y}.xml`, 'text');
      const v = Number(xml.match(new RegExp(`Kod="${code}"[\\s\\S]*?<ForexSelling>([\\d.]+)<`))?.[1]);
      return v ? { date: iso, value: v } : null;
    } catch {
      return null;
    }
  };
  const out = [];
  for (let i = 0; i < dates.length; i += 8) out.push(...(await Promise.all(dates.slice(i, i + 8).map(one))));
  return out.filter(Boolean);
}

// ── Kim ne diyor ────────────────────────────────────────────────────────────────────────────────────────
// Farklı duruştaki yayınlar aynı olayı çok farklı başlıklarla verir; kelime benzerliği eşleştiremez.
// Muhabir her turda duruşu belli akışların son 24 saatini data/regional.json'a yazar; yorum adayı seçilince
// Araştırmacı tek model çağrısıyla aynı olayı anlatan başlıkları bulur ve Türkçeye çevirir. Çeviri dışında yorum yok.
import { writeFileSync as wf, readFileSync as rf, existsSync as ex } from 'node:fs';
import { askJson, PERSONA } from '../lib/llm.js';
import { root as R } from '../newsroom/context.js';
import { detectCountries, englishNames } from '../lib/geo.js';

const REGIONAL = 'data/regional.json';

export function keepRegional(items) {
  const since = Date.now() - 24 * 3600e3;
  const old = ex(R + REGIONAL) ? JSON.parse(rf(R + REGIONAL, 'utf8')) : [];
  const fresh = items.filter((i) => i.stance).map(({ source, stance, party, title, titleEn, link, date }) => ({ source, stance, party: Boolean(party), title: titleEn ?? title, link, date }));
  const merged = [...new Map([...old, ...fresh].filter((i) => i.date > since).map((i) => [i.link, i])).values()].sort((a, b) => b.date - a.date).slice(0, 400);
  wf(R + REGIONAL, JSON.stringify(merged) + '\n');
}

const MATCH = `${PERSONA}
Sana bir haber ve farklı yayın organlarının son 24 saatteki başlıkları verilir. Görevin, AYNI OLAYI (aynı saldırı, açıklama,
görüşme, karar) anlatan başlıkları bulmak. Benzer konu yetmez; aynı olay olmalı. Her eşleşen başlığı anlamını ve kesinlik
derecesini koruyarak Türkçeye çevir (iddia ise iddia kalsın). Yorum ekleme.
Çıktı yalnızca JSON: {"matches": [{"i": 0, "tr": "..."}]} — eşleşme yoksa boş dizi.`;

export async function findVoices(d, max = 60) {
  if (!ex(R + REGIONAL)) return [];
  const all = JSON.parse(rf(R + REGIONAL, 'utf8')).filter((i) => !(d.links ?? []).includes(i.link));
  // Ön süzgeç: haberde geçen ülkelerden birini (İngilizce adı/sıfatı/başkenti) anan başlıklar; yoksa en yeniler.
  const words = detectCountries(`${d.headline} ${d.originalTitle ?? ''}`).flatMap(englishNames);
  const re = words.length ? new RegExp(`\\b(${words.map((w) => w.replace(/[.]/g, '\\.')).join('|')})`, 'i') : null;
  const hits = re ? all.filter((i) => re.test(i.title)) : [];
  // Her kaynaktan en çok 6 başlık: tek bir yoğun akış (TASS gibi) listeyi doldurmasın.
  const perSource = {};
  const pool = [...hits, ...all.filter((i) => !hits.includes(i))].filter((i) => (perSource[i.source] = (perSource[i.source] ?? 0) + 1) <= 6).slice(0, max);
  if (!pool.length) return [];
  const user = `HABER: ${d.headline}\n\nBAŞLIKLAR:\n${pool.map((p, i) => `${i}. [${p.source}] ${p.title}`).join('\n')}`;
  const res = await askJson(MATCH, user, (o) => (o.matches ?? []).filter((m) => Number.isInteger(m.i) && pool[m.i] && typeof m.tr === 'string'), { temperature: 0, tier: 'bulk' });
  const found = (res?.value ?? []).map((m) => ({ ...pool[m.i], title: m.tr.trim() }));
  // Kaynak başına bir başlık
  return [...new Map(found.map((v) => [v.source, v])).values()];
}
