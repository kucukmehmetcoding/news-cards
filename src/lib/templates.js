// Grafik tasarımcının yeni şablonları (1080x1350, ortak marka çerçevesi `page`):
//   explainer — "Cebine dokunan" açıklayıcı: kapak (fotoğraflı, kanca) + Ne değişti + Kimi etkiler + Sırada ne var
//   figure    — "Rakamla": tek kart, dev rakam + ne olduğu + kaynak
import { page, esc, headlineSize, NOTES } from './render.js';

const EXTRA = `<style>
.label{font-weight:900;font-size:30px;letter-spacing:6px;color:var(--a);margin-bottom:28px}
.para{font-weight:700;font-size:58px;line-height:1.16;letter-spacing:-1px}
.num{font-weight:900;font-size:220px;line-height:.95;letter-spacing:-8px;color:var(--a)}
.numlabel{font-weight:700;font-size:56px;line-height:1.15;letter-spacing:-1px;margin-top:34px}
.step{display:flex;gap:14px;margin-bottom:40px}.step i{flex:1;height:8px;border-radius:4px;background:#ffffff30}.step i.on{background:var(--a)}
</style>`;

const frame = (settings, category, body, footer, bg, image) => {
  const cat = settings.categories[category] ?? settings.categories.ekonomi;
  const note = NOTES[image?.kind] ?? 'Temsilî görsel · yapay zekâ';
  return page({
    brand: settings.brand,
    cat: { ...cat, label: cat.label },
    body: `${EXTRA}<div style="--a:${cat.accent};display:contents">${body}</div>`,
    footer,
    bg,
    note: image?.credit ? `${note} · ${image.credit}` : note,
  });
};

const steps = (i, n) => `<div class="step">${Array.from({ length: n }, (_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>`;

// sections: [{label, text}] — boş metinli bölüm slayt olmaz.
export function explainerPages(d, x, settings, bg) {
  const sections = [
    { label: 'NE DEĞİŞTİ?', text: x.changed },
    { label: 'KİMİ ETKİLER?', text: x.affects },
    { label: 'SIRADA NE VAR?', text: x.next },
  ].filter((s) => s.text);
  const total = sections.length + 1;
  const src = `<div class="src">Kaynak: ${esc(d.sources.slice(0, 3).join(', '))}</div>`;
  const cover = frame(
    settings,
    d.category,
    `<div class="kicker">CEBİNE DOKUNAN</div><h1 style="font-size:${headlineSize(x.hook.length) + 8}px">${esc(x.hook)}</h1>${src}`,
    `1/${total} · KAYDIR →`,
    bg,
    d.image
  );
  const inner = sections.map((s, i) =>
    frame(
      settings,
      d.category,
      `${steps(i + 1, total)}<div class="label">${s.label}</div><div class="para">${esc(s.text)}</div>${i === sections.length - 1 ? src : ''}`,
      i === sections.length - 1 ? `${i + 2}/${total} · KAYDET, LAZIM OLUR` : `${i + 2}/${total} · KAYDIR →`,
      null,
      null
    )
  );
  return [cover, ...inner];
}

// Kural: görselsiz paylaşım yok — rakam kartının arkasında da haberin görseli durur.
export function figurePage(d, f, source, settings, bg) {
  return frame(
    settings,
    d.category,
    `<div class="kicker">RAKAMLA</div><div class="num" style="font-size:${f.value.length > 7 ? 170 : 220}px">${esc(f.value)}</div>` +
      `<div class="numlabel">${esc(f.label)}</div><div class="src">Kaynak: ${esc(source)}</div>`,
    'KAYDET · PAYLAŞ',
    bg,
    d.image
  );
}
