import { clean } from './text.js';

// Özetin dayanacağı metin: haber sayfasındaki paragraflar. Alınamazsa boş döner.
export async function articleText(url, maxLen = 3000) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (news-cards)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    const html = (await res.text()).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ');
    const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => clean(m[1]))
      .filter((p) => p.length > 80 && !/çerez|cookie|abone ol|tüm hakları|©/i.test(p));
    return [...new Set(paragraphs)].join(' ').slice(0, maxLen);
  } catch {
    return '';
  }
}
