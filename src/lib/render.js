import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { background } from './image.js';

const require = createRequire(import.meta.url);
const font = (w) =>
  ['latin', 'latin-ext']
    .map((subset) => {
      const b64 = readFileSync(require.resolve(`@fontsource/inter/files/inter-${subset}-${w}-normal.woff2`)).toString('base64');
      const range = subset === 'latin' ? 'U+0000-00FF,U+2013-2014,U+2018-201D,U+2026' : 'U+0100-024F,U+1E00-1EFF';
      return `@font-face{font-family:Inter;font-weight:${w};src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range}}`;
    })
    .join('');
const FONTS = [500, 700, 900].map(font).join('');

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const headlineSize = (n) => (n < 60 ? 96 : n < 90 ? 82 : n < 120 ? 70 : n < 150 ? 62 : 54);

function page({ brand, cat, body, footer, bg, note }) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${FONTS}
*{margin:0;box-sizing:border-box}
body{width:1080px;height:1350px;font-family:Inter,sans-serif;color:#fff;overflow:hidden;
  background:radial-gradient(1200px 900px at 85% 0%,${cat.accent}55,transparent 60%),linear-gradient(160deg,${cat.from},${cat.to})}
.photo{position:absolute;inset:0;background:url(${bg ?? ''}) center 25%/cover}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,#000000b0 0%,#00000030 22%,#00000040 40%,${cat.to}f0 68%,${cat.to} 100%)}
.ai{position:absolute;top:176px;right:80px;max-width:760px;text-align:right;font-weight:500;font-size:20px;line-height:1.3;color:#ffffffa0}
.grid{position:absolute;inset:0;background-image:linear-gradient(#ffffff0a 1px,transparent 1px),linear-gradient(90deg,#ffffff0a 1px,transparent 1px);background-size:90px 90px}
.wrap{position:absolute;inset:0;padding:80px;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between}
.mark{font-weight:900;font-size:40px;letter-spacing:-1px;background:#fff;color:#111;padding:10px 18px;border-radius:14px}
.cat{font-weight:700;font-size:28px;letter-spacing:6px;color:${cat.accent};border:3px solid ${cat.accent};padding:10px 22px;border-radius:999px}
.body{flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:50px}
.bar{width:120px;height:12px;background:${cat.accent};border-radius:6px;margin-bottom:44px}
h1{font-weight:900;line-height:1.08;letter-spacing:-1.5px}
.kicker{font-weight:900;font-size:34px;letter-spacing:5px;color:#111;background:${cat.accent};align-self:flex-start;padding:12px 22px;border-radius:12px;margin-bottom:36px}
.src{font-weight:500;font-size:28px;color:#ffffffb0;margin-top:34px}
.foot{display:flex;justify-content:space-between;align-items:center;font-weight:500;font-size:26px;color:#ffffffb0;border-top:2px solid #ffffff26;padding-top:30px}
.foot b{font-weight:700;color:#fff}
</style></head><body>${bg ? `<div class="photo"></div><div class="shade"></div><div class="ai">${esc(note)}</div>` : '<div class="grid"></div>'}<div class="wrap">
<div class="top"><div class="mark">${esc(brand.mark)}</div><div class="cat">${esc(cat.label)}</div></div>
<div class="body">${body}</div>
<div class="foot"><span><b>${esc(brand.name)}</b> · ${esc(brand.handle)}</span><span>${footer}</span></div>
</div></body></html>`;
}

const NOTES = { photo: 'Arşiv fotoğrafı', stock: 'Temsilî fotoğraf' };

// Bültenin bir slaydı = bir haber. İlk slayt gönderinin kapağıdır: kaç haber olduğunu ve kaydırılacağını söyler.
export function slide(story, i, total, settings, bg) {
  const note = NOTES[story.image?.kind] ?? 'Temsilî görsel · yapay zekâ';
  return page({
    brand: settings.brand,
    cat: settings.categories[story.category],
    body:
      (i === 0 ? `<div class="kicker">GÜNDEMDEN ${total} HABER</div>` : '<div class="bar"></div>') +
      `<h1 style="font-size:${headlineSize(story.headline.length)}px">${esc(story.headline)}</h1>` +
      `<div class="src">Kaynak: ${esc(story.sources.slice(0, 3).join(', '))}</div>`,
    footer: `${i + 1}/${total}${i < total - 1 ? ' · KAYDIR →' : ''}`,
    bg,
    // Açık lisanslı fotoğrafın atfı slaydın üstünde durur; açıklamada yer tutmaz.
    note: story.image?.credit ? `${note} · ${story.image.credit}` : note,
  });
}

async function withPage(fn) {
  const browser = await chromium.launch();
  try {
    return await fn(await browser.newPage({ viewport: { width: 1080, height: 1350 } }));
  } finally {
    await browser.close();
  }
}

// Havuza giren her haber için arka plan görselini bulur ve 1080x1350 JPEG olarak `data/bg` altına yazar.
// Görsel bulunamayan haberin `bg` alanı boş kalır; çağıran taraf o haberi atar.
export async function backgrounds(stories, settings, root, taken) {
  mkdirSync(`${root}data/bg`, { recursive: true });
  await withPage(async (pg) => {
    for (const d of stories) {
      const img = await background(d, settings, root, taken);
      if (!img) continue;
      if (img.file) taken.add(img.file);
      d.image = { kind: img.kind, via: img.via, ...(img.credit ? { credit: img.credit } : {}), ...(img.file ? { file: img.file } : {}) };
      await pg.setContent(`<body style="margin:0;background:#000 url(${img.dataUrl}) center 25%/cover">`, { waitUntil: 'load' });
      d.bg = `data/bg/${d.id}.jpg`;
      await pg.screenshot({ path: root + d.bg, type: 'jpeg', quality: 85 });
    }
  });
}

// Bülten slaytlarını `public/cards` altına yazar, dosya adlarını döndürür.
export async function renderPost(post, stories, settings, root) {
  mkdirSync(`${root}public/cards`, { recursive: true });
  return withPage(async (pg) => {
    const images = [];
    for (const [i, s] of stories.entries()) {
      const bg = `data:image/jpeg;base64,${readFileSync(root + s.bg).toString('base64')}`;
      await pg.setContent(slide(s, i, stories.length, settings, bg), { waitUntil: 'load' });
      await pg.evaluate(() => document.fonts.ready);
      const name = `${post.id}-${i + 1}.jpg`;
      await pg.screenshot({ path: `${root}public/cards/${name}`, type: 'jpeg', quality: 90 });
      images.push(name);
    }
    return images;
  });
}

// Hikâye (9:16). Üst ve alt ~250 px Instagram arayüzünün altında kalır; yazılar ortadaki güvenli alanda durur.
export function storyPage(story, settings, bg) {
  const cat = settings.categories[story.category];
  const { brand } = settings;
  const note = NOTES[story.image?.kind] ?? 'Temsilî görsel · yapay zekâ';
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${FONTS}
*{margin:0;box-sizing:border-box}
body{width:1080px;height:1920px;font-family:Inter,sans-serif;color:#fff;overflow:hidden;background:${cat.to}}
.photo{position:absolute;inset:0 0 520px 0;background:url(${bg}) center 30%/cover}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,#000000a0 0%,#00000020 16%,#00000000 38%,${cat.to}e0 60%,${cat.to} 72%)}
.wrap{position:absolute;inset:270px 80px 300px;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between}
.mark{font-weight:900;font-size:44px;letter-spacing:-1px;background:#fff;color:#111;padding:10px 20px;border-radius:14px}
.cat{font-weight:700;font-size:30px;letter-spacing:6px;color:${cat.accent};border:3px solid ${cat.accent};padding:10px 24px;border-radius:999px;background:#00000066}
.note{margin-top:18px;align-self:flex-end;max-width:760px;text-align:right;font-weight:500;font-size:22px;color:#ffffffb0}
.body{flex:1;display:flex;flex-direction:column;justify-content:flex-end}
.bar{width:140px;height:14px;background:${cat.accent};border-radius:7px;margin-bottom:44px}
h1{font-weight:900;line-height:1.08;letter-spacing:-1.5px}
.src{font-weight:500;font-size:30px;color:#ffffffb8;margin-top:36px}
.cta{margin-top:56px;font-weight:700;font-size:32px;color:#111;background:${cat.accent};align-self:flex-start;padding:16px 28px;border-radius:14px}
.foot{margin-top:40px;font-weight:500;font-size:28px;color:#ffffffb0}
.foot b{color:#fff}
</style></head><body><div class="photo"></div><div class="shade"></div><div class="wrap">
<div class="top"><div class="mark">${esc(brand.mark)}</div><div class="cat">${esc(cat.label)}</div></div>
<div class="note">${esc(story.image?.credit ? `${note} · ${story.image.credit}` : note)}</div>
<div class="body"><div class="bar"></div>
<h1 style="font-size:${headlineSize(story.headline.length) + 6}px">${esc(story.headline)}</h1>
<div class="src">Kaynak: ${esc(story.sources.slice(0, 3).join(', '))}</div>
<div class="cta">Günün diğer haberleri profilde</div>
<div class="foot"><b>${esc(brand.name)}</b> · ${esc(brand.handle)}</div></div>
</div></body></html>`;
}

export async function renderStory(post, story, settings, root) {
  mkdirSync(`${root}public/cards`, { recursive: true });
  const browser = await chromium.launch();
  try {
    const pg = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    const bg = `data:image/jpeg;base64,${readFileSync(root + story.bg).toString('base64')}`;
    await pg.setContent(storyPage(story, settings, bg), { waitUntil: 'load' });
    await pg.evaluate(() => document.fonts.ready);
    const name = `${post.id}-1.jpg`;
    await pg.screenshot({ path: `${root}public/cards/${name}`, type: 'jpeg', quality: 90 });
    return [name];
  } finally {
    await browser.close();
  }
}
