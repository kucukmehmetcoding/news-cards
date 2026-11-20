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
    .map((x) => ({ text: `${trDay(x.createdAt)}: ${x.headline}`, source: x.sources.slice(0, 2).join(', '), url: x.links?.[0] }));
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

export async function research(d) {
  const facts = [...timeline(d), ...(await wikipedia(d.imageSubject)), ...(await tcmb(d))];
  log('researcher', 'researched', d.id, { facts: facts.length, sources: [...new Set(facts.map((f) => f.source))] });
  return facts;
}

// Yorumcu ve Doğrulayıcı için düz metin.
export const factsText = (facts) => facts.map((f, i) => `[A${i + 1}] ${f.text} (${f.source})`).join('\n') || '(yok)';
