import { readdirSync, readFileSync } from 'node:fs';
import { askVision, PERSONA } from './llm.js';

// Kart görseli zinciri. Görselsiz kart yayınlanmaz; sıra:
//  1) Haberin öznesi gerçek bir kişi/kurum ise açık lisanslı arşiv fotoğrafı (Wikimedia Commons "depicts" verisi, Openverse);
//     her aday fotoğraf görüntü destekli modele gösterilip habere uygunluğu DOĞRULANIR, doğrulanamayan fotoğraf kullanılmaz.
//  2) Yapay zekâ ile üretilmiş temsilî sahne (Pollinations, anahtarsız) — gerçek kişi yüzü üretilmez.
//  3) Depodaki hazır arka plan havuzu (assets/backgrounds)
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
// Yanlış kişinin fotoğrafını almamak için: aranan tüm kelimeler dosya başlığında TAM KELİME olarak geçmeli
// ("Katar" → "Katarina", "Victoria" → "Victorian" tutmaz).
const titleMatches = (title, query) => {
  const t = ` ${norm(title).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return words(query).every((w) => t.includes(` ${w} `));
};
const year = (s = '') => Number(s.match(/\b(19|20)\d{2}\b/)?.[0] ?? 0);
const strip = (html = '') => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function download(url, timeoutSeconds) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutSeconds * 1000) });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !/^image\/(jpeg|png|webp)/.test(type)) throw new Error(`${res.status} ${type}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 20000) throw new Error('görsel çok küçük');
  return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
}

// Özne Wikidata'da aranır: Q kimliği ile Commons'ta "bu dosya şunu gösterir" (P180) verisi üzerinden arama yapılır;
// metin eşleşmesinden çok daha isabetli. `human`: kişi ise eski fotoğraf elenir.
async function wikidata(query) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({ action: 'wbsearchentities', search: query, language: 'tr', uselang: 'tr', format: 'json', limit: '3' });
  const hit = (await (await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) })).json()).search?.find((h) => titleMatches(h.label ?? '', query));
  if (!hit) return null;
  const ent = new URL('https://www.wikidata.org/w/api.php');
  ent.search = new URLSearchParams({ action: 'wbgetentities', ids: hit.id, props: 'claims', format: 'json' });
  const claims = (await (await fetch(ent, { headers: UA, signal: AbortSignal.timeout(15000) })).json()).entities?.[hit.id]?.claims ?? {};
  const types = (claims.P31 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id);
  return { id: hit.id, label: hit.label, human: types.includes('Q5') };
}

async function commonsSearch(gsrsearch, extra = {}) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '10', gsrsearch,
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1280', ...extra,
  });
  const json = await (await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) })).json();
  return Object.values(json.query?.pages ?? {}).sort((a, b) => a.index - b.index);
}

// Commons adayları: önce Wikidata "depicts", bulunamazsa başlıkta tam kelime eşleşmesi. Her aday `verify` kapısından geçer.
async function commons(query, draft, settings, verify) {
  const entity = await wikidata(query).catch(() => null);
  draft.subjectKind = entity ? (entity.human ? 'kişi' : 'kurum/yer') : 'bilinmiyor';
  const pages = entity
    ? await commonsSearch(`haswbstatement:P180=${entity.id} filetype:bitmap`, { gsrsort: 'create_timestamp_desc' })
    : await commonsSearch(`${query} filetype:bitmap`);
  if (entity) console.log(`Commons: ${query} → ${entity.id} (${entity.human ? 'kişi' : 'kurum/yer'}), ${pages.length} aday`);
  let checked = 0;
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const license = meta.LicenseShortName?.value ?? '';
    // Yalnızca JPEG: PNG/SVG sonuçlar çoğunlukla grafik, logo ya da harita oluyor.
    if (!info || info.mime !== 'image/jpeg' || info.width < settings.image.minWidth) continue;
    if (!/^(public domain|cc0|cc by \d)/i.test(license) || /sa|nc|nd/i.test(license.replace(/^public domain/i, ''))) continue;
    if (!entity && !titleMatches(p.title, query)) continue;
    // Kişi fotoğrafı güncel olmalı: 1999'daki Putin, bugünkü haberi anlatmaz.
    const taken = year(meta.DateTimeOriginal?.value);
    if (entity?.human && taken && taken < settings.image.minPhotoYear) continue;
    if (checked++ >= settings.image.verifyCandidates) break;
    try {
      const dataUrl = await download(info.thumburl ?? info.url, settings.image.timeoutSeconds);
      if (!(await verify(dataUrl, p.title))) continue;
      const author = strip(meta.Artist?.value).slice(0, 60) || 'Wikimedia Commons';
      return { dataUrl, kind: 'photo', credit: `${author} / ${license} (Wikimedia Commons)` };
    } catch {}
  }
  return null;
}

async function openverse(query, settings, verify) {
  const url = new URL('https://api.openverse.org/v1/images/');
  url.search = new URLSearchParams({ q: query, license: 'cc0,pdm,by', page_size: '15', mature: 'false' });
  const json = await (await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) })).json();
  let checked = 0;
  for (const r of json.results ?? []) {
    if ((r.width ?? 0) < settings.image.minWidth) continue;
    if (!titleMatches(r.title ?? '', query)) continue;
    if (checked++ >= Math.min(2, settings.image.verifyCandidates)) break;
    try {
      const dataUrl = await download(r.url, settings.image.timeoutSeconds);
      if (!(await verify(dataUrl, r.title ?? ''))) continue;
      return { dataUrl, kind: 'photo', credit: `${(r.creator || r.source || 'Openverse').slice(0, 60)} / ${r.license.toUpperCase()} (${r.source})` };
    } catch {}
  }
  return null;
}

const VERIFY = `${PERSONA}
Görevin bir haber kartı için seçilen fotoğrafı denetlemek. Sana haber başlığı, aranan özne ve fotoğraf verilir.
Fotoğraf yalnızca şu koşullarda uygundur: (1) aranan özneyi açıkça ve baskın biçimde gösteriyor (kalabalık içinde küçük bir figür, başka birinin portresi,
yalnızca bir tabela/harita/logo/belge/nesne değil); (2) haberle ilgili yanlış bir izlenim vermiyor (başka bir olay, başka bir dönem, uygunsuz bir sahne);
(3) okunabilir büyük yazı, filigran ya da logo içermiyor; (4) fotoğraf kalitesi yayına uygun;
(5) özne bir kurum, kulüp ya da yer ise fotoğraf tek bir kişinin portresi OLAMAZ — haberde adı geçmeyen birinin yüzü okuru yanıltır;
bina, tesis, logo'suz genel görünüm ya da ilgili sahne olmalı.
Çıktı yalnızca JSON: {"ok": true|false, "shows": "fotoğrafta ne görünüyor (kısa)", "reason": "kısa gerekçe"}`;

// Görsel doğrulama kapısı. Model yoksa ya da yanıt vermezse fotoğraf GÜVENİLMEZ sayılır (doğrulanmamış arşiv fotoğrafı yayınlanmaz).
function verifier(draft, settings) {
  return async (dataUrl, title) => {
    const res = await askVision(
      VERIFY,
      `Haber başlığı: ${draft.headline}\nAranan özne: ${draft.imageSubject} (${draft.subjectKind ?? 'bilinmiyor'})\nDosya adı: ${title}`,
      dataUrl,
      (o) => {
        if (typeof o.ok !== 'boolean') throw new Error('ok alanı yok');
        return o;
      }
    );
    const v = res?.value;
    console.log(`Görsel denetimi (${res?.model ?? 'model yok'}): ${v ? (v.ok ? 'UYGUN' : 'RED') : 'YANITSIZ'} — ${v?.shows ?? ''} ${v?.reason ?? ''} [${title.slice(0, 50)}]`);
    return Boolean(v?.ok);
  };
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

// `taken`: havuzdaki diğer haberlerin kullandığı dosyalar; aynı bültende aynı arka plan iki kez çıkmasın.
function pool(draft, root, taken) {
  const dir = `${root}assets/backgrounds`;
  const files = readdirSync(dir).filter((f) => f.startsWith(`${draft.category}-`) && f.endsWith('.jpg') && !taken.has(f));
  if (!files.length) return null;
  const file = files[(parseInt(draft.id.slice(-8), 16) || 0) % files.length];
  return { file, dataUrl: `data:image/jpeg;base64,${readFileSync(`${dir}/${file}`).toString('base64')}`, kind: 'ai' };
}

// `usedSubjects`: bugün başka bir kartta fotoğrafı kullanılmış özneler; aynı yüz gün içinde ikinci kez kapak olmaz.
export async function background(draft, settings, root, taken = new Set(), usedSubjects = new Set()) {
  const subject = draft.imageSubject && !usedSubjects.has(draft.imageSubject.toLocaleLowerCase('tr-TR')) ? draft.imageSubject : '';
  if (draft.imageSubject && !subject) console.log(`Özne bugün kullanıldı, arşiv atlanıyor: ${draft.imageSubject}`);
  const verify = verifier(draft, settings);
  const steps = [
    ['arşiv (Commons)', () => subject && commons(subject, draft, settings, verify)],
    ['arşiv (Openverse)', () => subject && openverse(subject, settings, verify)],
    ['yapay zekâ', () => generated(draft, settings)],
    ['havuz', () => pool(draft, root, taken)],
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
