import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

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

function page({ brand, cat, body, footer }) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${FONTS}
*{margin:0;box-sizing:border-box}
body{width:1080px;height:1350px;font-family:Inter,sans-serif;color:#fff;overflow:hidden;
  background:radial-gradient(1200px 900px at 85% 0%,${cat.accent}55,transparent 60%),linear-gradient(160deg,${cat.from},${cat.to})}
.grid{position:absolute;inset:0;background-image:linear-gradient(#ffffff0a 1px,transparent 1px),linear-gradient(90deg,#ffffff0a 1px,transparent 1px);background-size:90px 90px}
.wrap{position:absolute;inset:0;padding:80px;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between}
.mark{font-weight:900;font-size:40px;letter-spacing:-1px;background:#fff;color:#111;padding:10px 18px;border-radius:14px}
.cat{font-weight:700;font-size:28px;letter-spacing:6px;color:${cat.accent};border:3px solid ${cat.accent};padding:10px 22px;border-radius:999px}
.body{flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:50px}
.bar{width:120px;height:12px;background:${cat.accent};border-radius:6px;margin-bottom:44px}
h1{font-weight:900;line-height:1.08;letter-spacing:-1.5px}
h2{font-weight:900;font-size:56px;letter-spacing:-1px;margin-bottom:50px}
li{list-style:none;font-weight:500;font-size:46px;line-height:1.28;margin-bottom:44px;padding-left:44px;border-left:8px solid ${cat.accent}}
.foot{display:flex;justify-content:space-between;align-items:center;font-weight:500;font-size:26px;color:#ffffffb0;border-top:2px solid #ffffff26;padding-top:30px}
.foot b{font-weight:700;color:#fff}
</style></head><body><div class="grid"></div><div class="wrap">
<div class="top"><div class="mark">${esc(brand.mark)}</div><div class="cat">${esc(cat.label)}</div></div>
<div class="body">${body}</div>
<div class="foot"><span><b>${esc(brand.name)}</b> · ${esc(brand.handle)}</span><span>${footer}</span></div>
</div></body></html>`;
}

export function slides(draft, settings) {
  const cat = settings.categories[draft.category];
  const { brand } = settings;
  const hasDetails = draft.details.length > 0;
  const out = [
    page({
      brand,
      cat,
      body: `<div class="bar"></div><h1 style="font-size:${headlineSize(draft.headline.length)}px">${esc(draft.headline)}</h1>`,
      footer: hasDetails ? 'KAYDIR →' : '',
    }),
  ];
  if (hasDetails)
    out.push(
      page({
        brand,
        cat,
        body: `<h2>Ayrıntılar</h2><ul>${draft.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`,
        footer: `Kaynak: ${esc(draft.sources.slice(0, 3).join(', '))}`,
      })
    );
  return out;
}

// Her taslak için 1080x1350 JPEG dosyaları üretir, dosya adlarını döndürür.
export async function render(drafts, settings, outDir) {
  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  try {
    for (const d of drafts) {
      d.images = [];
      for (const [i, html] of slides(d, settings).entries()) {
        await pg.setContent(html, { waitUntil: 'load' });
        await pg.evaluate(() => document.fonts.ready);
        const name = `${d.id}-${i + 1}.jpg`;
        await pg.screenshot({ path: `${outDir}/${name}`, type: 'jpeg', quality: 90 });
        d.images.push(name);
      }
    }
  } finally {
    await browser.close();
  }
}
