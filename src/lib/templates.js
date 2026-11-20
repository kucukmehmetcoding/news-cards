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

// sections: [{label, text}] — boş metinli bölüm slayt olmaz. charts: [{title, svg, source}] kapaktan hemen sonra gelir.
// video: true → Reels kareleri; "KAYDIR" gibi karusel yönergeleri yazılmaz.
export function explainerPages(d, x, settings, bg, charts = [], { video = false } = {}) {
  const swipe = (s) => (video ? s.replace(/ · (KAYDIR →|KAYDET, LAZIM OLUR)$/, '') : s);
  const sections = [
    { label: 'NE DEĞİŞTİ?', text: x.changed },
    { label: 'KİMİ ETKİLER?', text: x.affects },
    { label: 'SIRADA NE VAR?', text: x.next },
  ].filter((s) => s.text);
  const total = sections.length + charts.length + 1;
  const src = `<div class="src">Kaynak: ${esc(d.sources.slice(0, 3).join(', '))}</div>`;
  const cover = frame(
    settings,
    d.category,
    `<div class="kicker">CEBİNE DOKUNAN</div><h1 style="font-size:${headlineSize(x.hook.length) + 8}px">${esc(x.hook)}</h1>${src}`,
    swipe(`1/${total} · KAYDIR →`),
    bg,
    d.image
  );
  const inner = sections.map((s, i) =>
    frame(
      settings,
      d.category,
      `${steps(i + 1 + charts.length, total)}<div class="label">${s.label}</div><div class="para">${esc(s.text)}</div>${i === sections.length - 1 ? src : ''}`,
      swipe(i === sections.length - 1 ? `${total}/${total} · KAYDET, LAZIM OLUR` : `${i + 2 + charts.length}/${total} · KAYDIR →`),
      null,
      null
    )
  );
  const chartSlides = charts.map((c, i) => chartPage(d, c.title, c.svg, c.source, settings, swipe(`${i + 2}/${total} · KAYDIR →`)));
  return [cover, ...chartSlides, ...inner];
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

// Veri grafiği slaydı: başlık + çizgi grafik + kaynak. Açıklayıcıya ek slayt olarak girer.
export function chartPage(d, title, svg, source, settings, footer) {
  return frame(
    settings,
    d.category,
    `<div class="label">${esc(title)}</div><div style="margin:10px 0 0">${svg}</div><div class="src">Kaynak: ${esc(source)}</div>`,
    footer,
    null,
    null
  );
}

// "Dosya": aynı olayın son günlerdeki seyri. Kapak (fotoğraf + güncel başlık) + zaman çizelgesi.
// entries: [{ day: 'YYYY-MM-DD', headline }] eskiden yeniye; son öğe bugünkü gelişme.
export function dossierPages(d, entries, settings, bg) {
  const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  const cover = frame(
    settings,
    d.category,
    `<div class="kicker">DOSYA · ${entries.length} GELİŞME</div><h1 style="font-size:${headlineSize(d.headline.length)}px">${esc(d.headline)}</h1>` +
      `<div class="src">Kaynak: ${esc(d.sources.slice(0, 3).join(', '))}</div>`,
    '1/2 · KAYDIR →',
    bg,
    d.image
  );
  const rows = entries
    .map((e, i) => {
      const last = i === entries.length - 1;
      return `<div style="display:flex;gap:28px;align-items:flex-start;margin-bottom:30px">
<div style="flex:none;width:22px;height:22px;margin-top:12px;border-radius:50%;background:${last ? 'var(--a)' : '#ffffff60'}"></div>
<div><div style="font-weight:700;font-size:26px;letter-spacing:3px;color:${last ? 'var(--a)' : '#ffffffa0'}">${esc(day(e.day).toLocaleUpperCase('tr-TR'))}</div>
<div style="font-weight:${last ? 900 : 700};font-size:${entries.length > 4 ? 34 : 40}px;line-height:1.18;margin-top:6px">${esc(e.headline)}</div></div></div>`;
    })
    .join('');
  const line = frame(settings, d.category, `<div class="label">NE OLDU, NASIL GELDİ?</div>${rows}`, '2/2 · KAYDET', null, null);
  return [cover, line];
}

// "YORUM": kapak (fotoğraf + kanca, YORUM rozeti) + analiz bölümleri + "MEHMET'İN NOTU" görüş slaydı.
// Analiz doğrulayıcıdan geçmiştir; görüş kullanıcının seçtiği/yazdığı metindir ve öyle etiketlenir.
export function commentaryPages(d, x, opinion, settings, bg, signature) {
  const sections = [
    { label: 'NE OLDU?', text: x.changed },
    { label: 'NEDEN ÖNEMLİ?', text: x.affects },
    { label: 'SIRADA NE VAR?', text: x.next },
  ].filter((s) => s.text);
  const total = sections.length + 2;
  const src = `<div class="src">Kaynak: ${esc(d.sources.slice(0, 3).join(', '))}</div>`;
  const cover = frame(
    settings,
    d.category,
    `<div class="kicker">YORUM</div><h1 style="font-size:${headlineSize(x.hook.length) + 8}px">${esc(x.hook)}</h1>${src}`,
    `1/${total} · KAYDIR →`,
    bg,
    d.image
  );
  const inner = sections.map((s, i) =>
    frame(settings, d.category, `${steps(i + 1, total)}<div class="label">${s.label}</div><div class="para">${esc(s.text)}</div>`, `${i + 2}/${total} · KAYDIR →`, null, null)
  );
  const size = opinion.length > 260 ? 44 : opinion.length > 180 ? 50 : 58;
  const note = frame(
    settings,
    d.category,
    `${steps(total - 1, total)}<div class="label">${esc(signature.toLocaleUpperCase('tr-TR'))}</div>` +
      `<div class="para" style="font-size:${size}px;font-weight:700;border-left:10px solid var(--a);padding-left:34px">${esc(opinion)}</div>` +
      `<div class="src">Kişisel değerlendirmedir. Olgular: ${esc(d.sources.slice(0, 2).join(', '))}</div>`,
    `${total}/${total} · SEN NE DÜŞÜNÜYORSUN?`,
    null,
    null
  );
  return [cover, ...inner, note];
}
