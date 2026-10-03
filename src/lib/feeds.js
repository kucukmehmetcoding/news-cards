import { XMLParser } from 'fast-xml-parser';
import { clean, tokens, jaccard } from './text.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: false });
const text = (v) => (v && typeof v === 'object' ? v['#text'] ?? '' : v ?? '');

// Atom'da bağlantı `<link href rel>` öğesidir, birden fazla olabilir.
function link(v) {
  if (typeof v === 'string') return v;
  const all = [].concat(v ?? []);
  const alt = all.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? all[0];
  return alt?.['@_href'] ?? text(alt);
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: { 'user-agent': 'Mozilla/5.0 (news-cards)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${feed.source} ${res.status}`);
  const xml = parser.parse(await res.text());
  // RSS 2.0, Atom (NTV) ve RDF/RSS 1.0 (DW) akışları aynı biçime getirilir.
  const items = [].concat(xml?.rss?.channel?.item ?? xml?.feed?.entry ?? xml?.['rdf:RDF']?.item ?? []);
  if (!items.length) throw new Error(`${feed.source} akışında öğe yok`);
  return items.map((it) => {
    let title = clean(text(it.title));
    let source = feed.source;
    if (feed.aggregator) {
      // Google News başlıkları "Başlık - Yayın" biçiminde gelir.
      const i = title.lastIndexOf(' - ');
      if (i > 0) [title, source] = [title.slice(0, i), title.slice(i + 3)];
    }
    return {
      title,
      source,
      category: feed.category,
      link: link(it.link),
      // Toplayıcı açıklamaları yalnızca bağlantı listesi; metin olarak kullanılmaz.
      description: feed.aggregator ? '' : clean(text(it.description ?? it.summary ?? it.content)),
      date: new Date(text(it.pubDate ?? it.published ?? it.updated ?? it['dc:date']) || Date.now()).getTime(),
      ...(feed.lang ? { lang: feed.lang } : {}),
      ...(feed.kind ? { kind: feed.kind } : {}),
    };
  });
}

export async function collect(feeds, maxAgeHours) {
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${feeds[i].url}: ${r.reason.message}`] : []));
  const cutoff = Date.now() - maxAgeHours * 3600e3;
  const items = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((it) => it.title.length > 20 && it.date >= cutoff);
  return { items, failed };
}

// Aynı olayı anlatan başlıkları tek kümeye toplar; küme = bir haber adayı.
export function cluster(items, threshold) {
  const clusters = [];
  for (const it of items.sort((a, b) => b.date - a.date)) {
    const tk = tokens(it.title);
    const hit = clusters.find((c) => c.items.some((o) => jaccard(tk, o.tk) >= threshold));
    if (hit) hit.items.push({ ...it, tk });
    else clusters.push({ items: [{ ...it, tk }] });
  }
  return clusters.map((c) => {
    const sources = [...new Set(c.items.map((i) => i.source))];
    // Açıklaması en dolu olan öğe metnin kaynağı olur.
    const lead = [...c.items].sort((a, b) => b.description.length - a.description.length)[0];
    return {
      title: lead.title,
      description: lead.description,
      category: lead.category,
      lead: lead.link,
      sources,
      links: c.items.map((i) => i.link),
      date: Math.max(...c.items.map((i) => i.date)),
      // Türk basınında karşılığı olmayan, yalnız yabancı kaynaklarda geçen haber: hesabın asıl katma değeri.
      foreign: c.items.every((i) => i.lang === 'en'),
      ...(lead.titleEn ? { titleEn: lead.titleEn } : {}),
    };
  });
}
