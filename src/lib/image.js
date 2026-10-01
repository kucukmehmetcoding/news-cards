import { readdirSync, readFileSync } from 'node:fs';

// Kart görseli zinciri. Görselsiz kart yayınlanmaz; sıra:
//  1) Haberin öznesi gerçek bir kişi/kulüp/yer ise açık lisanslı arşiv fotoğrafı (Wikimedia Commons, Openverse)
//  2) Yapay zekâ ile üretilmiş temsilî sahne (Pollinations, anahtarsız)
//  3) Genel aramayla açık lisanslı fotoğraf (Openverse)
//  4) Depodaki hazır arka plan havuzu (assets/backgrounds)
// Arama motorlarından rastgele haber fotoğrafı indirilmez: telifli ajans görseli hesabı riske atar.
const UA = { 'user-agent': 'news-cards/1.0 (github.com/kucukmehmetcoding/news-cards)' };
const STYLE = 'cinematic editorial photograph, moody lighting, shallow depth of field, no people, no faces, no text, no letters, no logos, no watermark';
const CATEGORY_PROMPTS = {
  turkiye: 'aerial view of a Turkish city skyline at dusk',
  dunya: 'earth globe and world map on a dark desk',
  ekonomi: 'stock market charts glowing on dark screens, coins on a table',
  spor: 'empty football stadium under floodlights at night',
};

const norm = (s) => s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
const words = (s) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
// Yanlış kişinin fotoğrafını almamak için: aranan tüm kelimeler dosya başlığında geçmeli.
const titleMatches = (title, query) => words(query).every((w) => norm(title).includes(w));
const strip = (html = '') => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function download(url, timeoutSeconds) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutSeconds * 1000) });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !/^image\/(jpeg|png|webp)/.test(type)) throw new Error(`${res.status} ${type}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 20000) throw new Error('görsel çok küçük');
  return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
}

async function commons(query, settings) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '10',
    gsrsearch: `${query} filetype:bitmap`, prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1280',
  });
  const json = await (await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) })).json();
  const pages = Object.values(json.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const license = meta.LicenseShortName?.value ?? '';
    if (!info || info.width < settings.image.minWidth) continue;
    if (!/^(public domain|cc0|cc by \d)/i.test(license) || /sa|nc|nd/i.test(license.replace(/^public domain/i, ''))) continue;
    if (!titleMatches(p.title, query)) continue;
    try {
      const dataUrl = await download(info.thumburl ?? info.url, settings.image.timeoutSeconds);
      const author = strip(meta.Artist?.value).slice(0, 60) || 'Wikimedia Commons';
      return { dataUrl, kind: 'photo', credit: `${author} / ${license} (Wikimedia Commons)` };
    } catch {}
  }
  return null;
}

async function openverse(query, settings, strict) {
  const url = new URL('https://api.openverse.org/v1/images/');
  url.search = new URLSearchParams({ q: query, license: 'cc0,pdm,by', page_size: '15', mature: 'false' });
  const json = await (await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) })).json();
  for (const r of json.results ?? []) {
    if ((r.width ?? 0) < settings.image.minWidth) continue;
    if (strict && !titleMatches(r.title ?? '', query)) continue;
    try {
      const dataUrl = await download(r.url, settings.image.timeoutSeconds);
      return { dataUrl, kind: 'photo', credit: `${(r.creator || r.source || 'Openverse').slice(0, 60)} / ${r.license.toUpperCase()} (${r.source})` };
    } catch {}
  }
  return null;
}

async function generated(draft, settings) {
  const prompt = `${draft.imagePrompt || CATEGORY_PROMPTS[draft.category]}, ${STYLE}`;
  const seed = parseInt(draft.id.slice(-8), 16) % 1e6;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1350&nologo=true&seed=${seed}`;
  for (let attempt = 1; attempt <= settings.image.retries; attempt++) {
    try {
      return { dataUrl: await download(url, settings.image.timeoutSeconds), kind: 'ai' };
    } catch (e) {
      console.warn(`Görsel üretilemedi (deneme ${attempt}): ${e.message}`);
      // Anahtarsız kullanım kotası dar: art arda isteklerde 402 dönüyor, bekleyince açılıyor.
      if (attempt < settings.image.retries) await new Promise((r) => setTimeout(r, settings.image.backoffSeconds * 1000));
    }
  }
  return null;
}

function pool(draft, root) {
  const dir = `${root}assets/backgrounds`;
  const files = readdirSync(dir).filter((f) => f.startsWith(`${draft.category}-`) && f.endsWith('.jpg'));
  if (!files.length) return null;
  const file = files[parseInt(draft.id.slice(-8), 16) % files.length];
  return { dataUrl: `data:image/jpeg;base64,${readFileSync(`${dir}/${file}`).toString('base64')}`, kind: 'ai' };
}

export async function background(draft, settings, root) {
  const steps = [
    ['arşiv (Commons)', () => draft.imageSubject && commons(draft.imageSubject, settings)],
    ['arşiv (Openverse)', () => draft.imageSubject && openverse(draft.imageSubject, settings, true)],
    ['yapay zekâ', () => generated(draft, settings)],
    // Genel aramadan gelen fotoğraf olayın kendisini göstermez; kartta "temsilî" diye etiketlenir.
    ['genel arama', async () => {
      const img = draft.imageQuery && (await openverse(draft.imageQuery, settings, false));
      return img && { ...img, kind: 'stock' };
    }],
    ['havuz', () => pool(draft, root)],
  ];
  for (const [name, step] of steps) {
    try {
      const img = await step();
      if (img) return { ...img, via: name };
    } catch (e) {
      console.warn(`Görsel adımı başarısız (${name}): ${e.message}`);
    }
  }
  return null;
}
