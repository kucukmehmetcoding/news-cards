import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { collect, cluster } from './lib/feeds.js';
import { tokens } from './lib/text.js';
import { writeCard } from './lib/write.js';
import { backgrounds, renderPost, renderStory } from './lib/render.js';
import { articleText } from './lib/article.js';
import { rank } from './lib/rank.js';
import { translateTitles, scoreGood } from './lib/foreign.js';
import { usage } from './lib/llm.js';
import { enabled } from './lib/platforms.js';

const root = new URL('..', import.meta.url).pathname;
const json = (p) => JSON.parse(readFileSync(root + p, 'utf8'));
const settings = json('config/settings.json');
const { feeds } = json('config/sources.json');
const STATE = 'data/state.json';
const state = existsSync(root + STATE) ? json(STATE) : { seen: {}, published: [] };
// Model çıktıları önbelleği (çeviri, ilgi puanı, güzel haber puanı); kota tasarrufu için. 3 günde temizlenir.
state.cache ??= {};
for (const k of ['tr', 'rank', 'good']) state.cache[k] ??= {};
function saveState() {
  // seen kaydı ve model önbelleği sınırsız büyümesin
  const week = Date.now() - 7 * 86400e3;
  for (const [l, t] of Object.entries(state.seen)) if (t < week) delete state.seen[l];
  const old = Date.now() - 3 * 86400e3;
  for (const c of Object.values(state.cache)) for (const [k, v] of Object.entries(c)) if ((v.t ?? v[1]) < old) delete c[k];
  writeFileSync(root + STATE, JSON.stringify(state, null, 2) + '\n');
}

// Haber havuzu `drafts/` altında durur (pending → approved → used); bülten = havuzdan derlenen kaydırmalı gönderi (`posts/`).
// manual: her haber onay bekler. auto: en az iki kaynaklı haberler onaysız havuza girer.
const MODE = process.env.APPROVAL_MODE === 'auto' ? 'auto' : 'manual';

const load = (dir) =>
  readdirSync(root + dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`${root}${dir}/${f}`, 'utf8')))
    .sort((a, b) => a.createdAt - b.createdAt);
const save = (dir) => (d) => writeFileSync(`${root}${dir}/${d.id}.json`, JSON.stringify(d, null, 2) + '\n');
const loadDrafts = () => load('drafts');
const saveDraft = save('drafts');
const loadPosts = () => load('posts');
const savePost = save('posts');

const trDay = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
const trHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }));
// Zamanlayıcı günün her saatinde çalışır; gece saatlerinde haber hazırlanmaz ve yayın yapılmaz.
const quiet = () => trHour() < settings.activeHours[0] || trHour() >= settings.activeHours[1];
const publishedToday = () => state.published.filter((p) => trDay(p.at) === trDay(Date.now()));
const inPool = (d) => ['pending', 'approved'].includes(d.status);
const isGood = (d) => d.kind === 'goodnews';
const isOpen = (p) => ['approved', 'partial'].includes(p.status);
const kindOf = (p) => p.kind ?? 'bulletin';
// Aynı olayın gelişmesi ("sevk edildi" → "tutuklandı") farklı kelimelerle yazılır; jaccard bunu kaçırır.
// Kısa başlığın kelimelerinin yarısı ötekinde geçiyorsa ya da haberin öznesi aynıysa aynı olay sayılır.
function sameEvent(a, b) {
  const [x, y] = [tokens(a.title), tokens(b.title)];
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  if (inter / (Math.min(x.size, y.size) || 1) >= 0.5) return true;
  return Boolean(a.subject && a.subject === b.subject);
}
const ev = (d) => ({ title: d.originalTitle ?? d.title, subject: d.imageSubject || d.subject || '' });

// Havuzdan çıkan haberin arka plan dosyası artık gerekmez.
function retire(d, status) {
  d.status = status;
  if (d.bg) rmSync(root + d.bg, { force: true });
  saveDraft(d);
}

function expireOld(drafts, posts) {
  // Güzel haber gündeme bağlı değil; günlük gönderiye yetişsin diye havuzda daha uzun kalır.
  for (const d of drafts)
    if (inPool(d) && Date.now() - d.createdAt > (isGood(d) ? 48 : settings.pool.expiryHours) * 3600e3) retire(d, 'expired');
  // Hiçbir platforma gidemeden bayatlayan bülten yayınlanmaz.
  for (const p of posts)
    if (p.status === 'approved' && Date.now() - p.createdAt > settings.bulletin.expiryHours * 3600e3) {
      p.status = 'expired';
      savePost(p);
    }
}

// Havuzu doldurur: ilgi eşiğini geçen yeni haberler yazılır, görseli bulunur ve taslak olarak saklanır.
async function fillPool(drafts) {
  const open = drafts.filter((d) => inPool(d) && !isGood(d));
  const room = Math.min(settings.pool.max - open.length, settings.pool.perRun);
  if (room <= 0) return console.log('Havuz dolu.');

  // Günün ilk bülteninden önce gece birikenler de aday olsun diye yaş sınırı geniş tutulur.
  const news = feeds.filter((f) => f.kind !== 'goodnews');
  const collected = await collect(news, publishedToday().length ? settings.maxItemAgeHours : settings.firstRunItemAgeHours);
  collected.failed.forEach((f) => console.warn(`Kaynak okunamadı: ${f}`));
  // Yabancı başlıklar Türkçeye çevrilir; böylece Türk basınındaki aynı olayla aynı kümeye düşer.
  const items = await translateTitles(collected.items, settings.foreign.maxTitles, state.cache.tr);

  const todays = [...publishedToday().flatMap((p) => p.stories ?? []), ...open];
  const usedToday = todays.reduce((m, p) => ((m[p.topic] = (m[p.topic] ?? 0) + 1), m), {});
  // Aynı olay yeni bağlantıyla geri gelebilir: havuzdaki ve son iki günde yayınlanan başlıklarla karşılaştırılır.
  const recent = [
    ...state.published.filter((p) => Date.now() - p.at < 48 * 3600e3).flatMap((p) => p.stories ?? []),
    ...open.map(ev),
  ];
  const fresh = cluster(items, settings.clusterThreshold)
    .filter((c) => !c.links.some((l) => state.seen[l]))
    .filter((c) => !recent.some((r) => sameEvent(r, { title: c.title })))
    // Yalnız yabancı basında geçen haber tek kaynakla da girebilir, ama yalnız güvenilir yayın kuruluşlarından.
    .filter((c) => MODE === 'manual' || c.sources.length >= settings.minSourcesForAuto || (c.foreign && c.sources.some((s) => settings.foreign.trusted.includes(s))));
  // İlgi puanı belirleyici; çok kaynaklı ve o gün az işlenmiş konular (savaş, kriz, piyasa, spor) öne gelir.
  const score = (c) => c.interest * 10 + c.sources.length * 4 - (usedToday[c.topic] ?? 0) * 6;
  const candidates = (await rank(fresh, settings, state.cache.rank))
    // Dört ana konu (savaş, kriz, piyasa, spor) dışındaki haberler ancak çok yüksek puanla girer.
    .filter((c) => c.interest >= (c.topic === 'diger' ? settings.interest.minInterestOther : settings.interest.minInterest))
    .sort((a, b) => score(b) - score(a) || b.date - a.date);
  console.log(`${items.length} haber, ${fresh.length} aday, ${candidates.length} tanesi ilgi eşiğini geçti.`);

  const picked = [];
  const topicCount = (t) => [...open, ...picked].filter((p) => p.topic === t).length;
  for (const c of candidates) {
    if (picked.length === room) break;
    if (topicCount(c.topic) >= settings.bulletin.maxPerTopic) continue; // bülten tek konuya yığılmasın
    // Yabancı basın değer katar ama bülteni ele geçirmemeli: havuzda da bültende de sınırlı.
    if (c.foreign && [...open, ...picked].filter((p) => p.foreign).length >= settings.foreign.maxPerBulletin) continue;
    if (picked.some((p) => sameEvent(ev(p), { title: c.title }))) continue;
    const article = await articleText(c.lead);
    // Yabancı haberin Türkçesi kaynak metinden yazılır; metin yoksa yalnız başlıktan haber uydurulmaz.
    if (c.foreign && (article || c.description).length < settings.foreign.minText) continue;
    const card = await writeCard({ ...c, article });
    if (!usable(card)) break;
    picked.push({
      id: `${trDay(Date.now())}-${createHash('sha1').update(c.links[0]).digest('hex').slice(0, 8)}`,
      status: MODE === 'auto' ? 'approved' : 'pending',
      createdAt: Date.now(),
      category: c.category,
      sources: c.sources,
      links: c.links,
      originalTitle: c.title,
      ...(c.titleEn ? { titleEn: c.titleEn } : {}),
      ...(c.foreign ? { foreign: true } : {}),
      interest: c.interest,
      topic: c.topic,
      ...card,
    });
  }
  if (!picked.length) return console.log('Uygun haber bulunamadı.');

  await keep(picked, drafts, open);
}

// Hiçbir model yanıt vermediyse kart, kaynağın başlığıyla yazılır (yafta ve ünlem içerebilir). Otomatik modda
// böyle kart yayınlanmaz; haber "görüldü" sayılmaz ve kota açılınca yeniden denenir.
function usable(card) {
  if (MODE === 'manual' || card.writer !== 'fallback') return true;
  console.warn('Dil modeli yanıt vermedi (Gemini kotası/FreeLLMAPI erişimi); bu tur yeni haber yazılmıyor.');
  return false;
}

// Görseli bulunan haberler taslak olarak saklanır; görselsiz haber atılır.
async function keep(picked, drafts, open) {
  await backgrounds(picked, settings, root, new Set(open.map((d) => d.image?.file).filter(Boolean)));
  for (const d of picked) {
    // Haber, havuza girsin girmesin bir daha aday olmasın diye işaretlenir.
    d.links.forEach((l) => (state.seen[l] = d.createdAt));
    if (!d.bg) {
      console.warn(`ATLANDI ${d.id}: görsel bulunamadı, görselsiz paylaşım yapılmaz. ${d.headline}`);
      continue;
    }
    saveDraft(d);
    drafts.push(d);
    console.log(`${d.status.toUpperCase()} ${d.id} [${d.category}/${d.topic}] ilgi ${d.interest} (${d.sources.length} kaynak, görsel: ${d.image.via}) ${d.headline}`);
  }
  saveState();
}

// Vakti geldiyse havuzdaki en güçlü haberlerden bir bülten derler. Vakit saatle değil aralıkla belirlenir:
// zamanlayıcı düzensiz çalışsa da son gönderiden yeterince sonra ve yeterli haber varken bülten çıkar.
async function compose(drafts, posts) {
  const b = settings.bulletin;
  if (posts.some((p) => kindOf(p) === 'bulletin' && isOpen(p))) return console.log('Yayın bekleyen bülten var.');
  if (publishedToday().length >= b.dailyCap) return console.log('Günlük sınır doldu.');
  const last = state.published.at(-1);
  if (last && Date.now() - last.at < b.minGapMinutes * 60e3) return console.log('Son yayından bu yana yeterli süre geçmedi.');

  const ready = drafts.filter((d) => d.status === 'approved' && !isGood(d) && d.bg && existsSync(root + d.bg));
  const stories = [];
  for (const d of ready.sort((x, y) => y.interest - x.interest || y.sources.length - x.sources.length)) {
    if (stories.length === b.stories) break;
    if (stories.filter((s) => s.topic === d.topic).length >= b.maxPerTopic) continue;
    if (d.foreign && stories.filter((s) => s.foreign).length >= settings.foreign.maxPerBulletin) continue;
    if (stories.some((s) => sameEvent(ev(s), ev(d)))) continue;
    stories.push(d);
  }
  if (stories.length < b.minStories) return console.log(`Bülten için yeterli haber yok (${stories.length}/${b.minStories}).`);

  const post = {
    id: `${trDay(Date.now())}-b${createHash('sha1').update(stories.map((s) => s.id).join()).digest('hex').slice(0, 7)}`,
    status: 'approved',
    createdAt: Date.now(),
    // Bülten kendi kendine yeter: yayın adımı haber taslaklarını yeniden okumaz.
    items: stories.map(({ id, category, topic, interest, sources, originalTitle, imageSubject, headline, brief, hashtags, image, foreign }) => ({
      id, category, topic, interest, sources, originalTitle, imageSubject, headline, brief, hashtags, image, foreign,
    })),
  };
  post.images = await renderPost(post, stories, settings, root);
  savePost(post);
  posts.push(post);
  for (const d of stories) {
    d.postId = post.id;
    retire(d, 'used');
  }
  console.log(`BÜLTEN ${post.id} (${stories.length} haber)\n${stories.map((s, i) => `  ${i + 1}) [${s.topic}] ${s.headline}`).join('\n')}`);
}

// Hikâye: her pencerede (settings.stories.windows, TSİ saat aralıkları) bir tane. Havuzdaki en güçlü, daha önce
// hikâye olmamış haber seçilir; haber havuzda kalır, sonra bültene de girebilir. Hikâye bülten sınırına sayılmaz.
async function composeStory(drafts, posts) {
  const h = trHour();
  const window = settings.stories.windows.findIndex(([a, b]) => h >= a && h < b);
  if (window < 0) return;
  const today = posts.filter((p) => kindOf(p) === 'story' && trDay(p.createdAt) === trDay(Date.now()));
  if (today.some((p) => p.window === window && p.status !== 'rejected')) return;
  const d = drafts
    .filter((d) => d.status === 'approved' && !isGood(d) && !d.storyId && d.bg && existsSync(root + d.bg))
    .filter((d) => !today.some((p) => sameEvent(ev(p.items[0]), ev(d))))
    .sort((x, y) => y.interest - x.interest || y.sources.length - x.sources.length)[0];
  if (!d) return console.log('Hikâye için uygun haber yok.');

  const post = {
    id: `${trDay(Date.now())}-s${createHash('sha1').update(d.id).digest('hex').slice(0, 7)}`,
    kind: 'story',
    window,
    status: 'approved',
    createdAt: Date.now(),
    items: [{ id: d.id, category: d.category, topic: d.topic, sources: d.sources, originalTitle: d.originalTitle, imageSubject: d.imageSubject, headline: d.headline, image: d.image }],
  };
  post.images = await renderStory(post, d, settings, root);
  savePost(post);
  posts.push(post);
  d.storyId = post.id;
  saveDraft(d);
  console.log(`HİKÂYE ${post.id} [${d.topic}] ${d.headline}`);
}

// "Dünyadan güzel haberler": günde bir kaydırmalı gönderi. Havuzu gün içinde dolar, akşam penceresinde derlenir.
const goodToday = (posts) => posts.some((p) => p.kind === 'goodnews' && trDay(p.createdAt) === trDay(Date.now()) && p.status !== 'rejected');

async function fillGood(drafts, posts) {
  const g = settings.goodnews;
  const open = drafts.filter((d) => inPool(d) && isGood(d));
  const room = Math.min(g.pool - open.length, g.perRun);
  if (room <= 0 || goodToday(posts)) return;
  const collected = await collect(feeds.filter((f) => f.kind === 'goodnews'), g.maxItemAgeHours);
  collected.failed.forEach((f) => console.warn(`Kaynak okunamadı: ${f}`));
  const items = await translateTitles(collected.items, settings.foreign.maxTitles, state.cache.tr);
  const recent = posts.filter((p) => p.kind === 'goodnews').flatMap((p) => p.items.map(ev));
  const fresh = cluster(items, settings.clusterThreshold)
    .filter((c) => !c.links.some((l) => state.seen[l]))
    .filter((c) => ![...recent, ...open.map(ev)].some((r) => sameEvent(r, { title: c.title })));
  const candidates = (await scoreGood(fresh, state.cache.good)).filter((c) => c.interest >= g.minScore).sort((a, b) => b.interest - a.interest);
  console.log(`Güzel haber: ${items.length} haber, ${fresh.length} aday, ${candidates.length} tanesi eşiği geçti.`);

  const picked = [];
  for (const c of candidates) {
    if (picked.length === room) break;
    if (picked.some((p) => sameEvent(ev(p), { title: c.title }))) continue;
    const article = await articleText(c.lead);
    if ((article || c.description).length < settings.foreign.minText) continue;
    const card = await writeCard({ ...c, article });
    if (!usable(card)) break;
    picked.push({
      id: `${trDay(Date.now())}-g${createHash('sha1').update(c.links[0]).digest('hex').slice(0, 7)}`,
      kind: 'goodnews',
      status: MODE === 'auto' ? 'approved' : 'pending',
      createdAt: Date.now(),
      category: 'iyihaber',
      sources: c.sources,
      links: c.links,
      originalTitle: c.title,
      ...(c.titleEn ? { titleEn: c.titleEn } : {}),
      interest: c.interest,
      topic: 'iyi',
      ...card,
    });
  }
  if (picked.length) await keep(picked, drafts, open);
}

async function composeGood(drafts, posts) {
  const g = settings.goodnews;
  const h = trHour();
  if (h < g.window[0] || h >= g.window[1] || goodToday(posts)) return;
  const stories = [];
  for (const d of drafts.filter((d) => d.status === 'approved' && isGood(d) && d.bg && existsSync(root + d.bg)).sort((x, y) => y.interest - x.interest)) {
    if (stories.length === g.stories) break;
    if (!stories.some((s) => sameEvent(ev(s), ev(d)))) stories.push(d);
  }
  if (stories.length < g.minStories) return console.log(`Güzel haber gönderisi için yeterli haber yok (${stories.length}/${g.minStories}).`);
  const post = {
    id: `${trDay(Date.now())}-g${createHash('sha1').update(stories.map((s) => s.id).join()).digest('hex').slice(0, 7)}`,
    kind: 'goodnews',
    status: 'approved',
    createdAt: Date.now(),
    items: stories.map(({ id, category, topic, interest, sources, originalTitle, imageSubject, headline, brief, hashtags, image }) => ({
      id, category, topic, interest, sources, originalTitle, imageSubject, headline, brief, hashtags, image,
    })),
  };
  post.images = await renderPost(post, stories, settings, root);
  savePost(post);
  posts.push(post);
  for (const d of stories) {
    d.postId = post.id;
    retire(d, 'used');
  }
  console.log(`GÜZEL HABER ${post.id} (${stories.length} haber)\n${stories.map((s, i) => `  ${i + 1}) ${s.headline}`).join('\n')}`);
}

async function prepare() {
  if (quiet()) return console.log('Sessiz saatler: haber hazırlanmıyor.');
  const drafts = loadDrafts();
  const posts = loadPosts();
  expireOld(drafts, posts);
  await fillPool(drafts);
  await fillGood(drafts, posts);
  await composeStory(drafts, posts);
  await compose(drafts, posts);
  await composeGood(drafts, posts);
  saveState(); // model önbelleği yeni haber çıkmasa da saklanır
  console.log(`Model çağrıları: ${JSON.stringify(usage)}`);
}

async function publishOne(next) {
  const kind = kindOf(next);
  const base = process.env.IMAGE_BASE_URL;
  const platforms = enabled(kind);
  if (!base || !platforms.length) throw new Error('IMAGE_BASE_URL ve en az bir platformun anahtarları tanımlı olmalı.');
  if ((next.images?.length ?? 0) < (kind === 'story' ? 1 : 2)) throw new Error(`${next.id}: slayt sayısı eksik.`);
  const urls = next.images.map((f) => `${base.replace(/\/$/, '')}/${f}`);

  next.posted ??= {};
  next.attempts ??= {};
  for (const p of platforms) {
    if (next.posted[p.name] || (next.attempts[p.name] ?? 0) >= settings.maxPublishAttempts) continue;
    try {
      next.posted[p.name] = await p.publish(urls, p.text(next));
      console.log(`YAYINLANDI ${p.name} ${kind} ${next.id} → ${next.posted[p.name]}`);
    } catch (e) {
      next.attempts[p.name] = (next.attempts[p.name] ?? 0) + 1;
      console.error(`HATA ${p.name} ${kind} ${next.id} (deneme ${next.attempts[p.name]}): ${e.message}`);
      process.exitCode = 1;
    }
    savePost(next); // her platformdan sonra kaydet: yarıda kesilirse aynı yere iki kez gönderilmez
  }

  const anyPosted = Object.keys(next.posted).length > 0;
  const open = platforms.some((p) => !next.posted[p.name] && (next.attempts[p.name] ?? 0) < settings.maxPublishAttempts);
  // Bülten sınırı ve aralığı yalnız bültenlerle hesaplanır; hikâye kaydı `posts/` dosyasında kalır.
  if (kind === 'bulletin' && anyPosted && !state.published.some((p) => p.id === next.id)) {
    state.published.push({ id: next.id, at: Date.now(), stories: next.items.map((s) => ({ topic: s.topic, ...ev(s) })) });
    state.published = state.published.slice(-200);
    saveState();
  }
  next.status = open ? (anyPosted ? 'partial' : 'approved') : anyPosted ? 'published' : 'failed';
  savePost(next);
}

// Her türden (bülten, hikâye) yayın bekleyen birer gönderi yayınlanır; yarım kalan önce tamamlanır.
async function publishNext() {
  if (quiet()) return console.log('Sessiz saatler: yayın yapılmıyor.');
  const posts = loadPosts();
  expireOld([], posts);
  let any = false;
  for (const kind of ['bulletin', 'story', 'goodnews']) {
    const mine = posts.filter((p) => kindOf(p) === kind);
    const next = mine.find((p) => p.status === 'partial') ?? mine.find((p) => p.status === 'approved');
    if (!next) continue;
    any = true;
    try {
      await publishOne(next);
    } catch (e) {
      console.error(`HATA ${next.id}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  if (!any) console.log('Yayın bekleyen gönderi yok.');
}

function approve(ids) {
  const drafts = loadDrafts().filter((d) => d.status === 'pending');
  const targets = ids.includes('all') ? drafts : drafts.filter((d) => ids.includes(d.id));
  if (!targets.length) return console.log('Eşleşen bekleyen haber yok.');
  for (const d of targets) {
    d.status = 'approved';
    saveDraft(d);
    console.log(`APPROVED ${d.id} ${d.headline}`);
  }
}

// Havuzdaki haber (bekleyen ya da onaylı) ve henüz hiçbir yere gitmemiş bülten reddedilebilir.
function reject(ids) {
  const all = ids.includes('all');
  const drafts = loadDrafts().filter((d) => inPool(d) && (all || ids.includes(d.id)));
  const posts = loadPosts().filter((p) => p.status === 'approved' && (all || ids.includes(p.id)));
  if (!drafts.length && !posts.length) return console.log('Eşleşen haber ya da bülten yok.');
  for (const d of drafts) {
    retire(d, 'rejected');
    console.log(`REJECTED ${d.id} ${d.headline}`);
  }
  for (const p of posts) {
    p.status = 'rejected';
    savePost(p);
    console.log(`REJECTED ${p.id} (bülten, ${p.items.length} haber)`);
  }
}

function list() {
  for (const d of loadDrafts().filter(inPool)) console.log(`${d.status.padEnd(8)} ${d.id} [${d.category}/${d.topic}] ${d.headline}`);
  for (const p of loadPosts().filter(isOpen))
    console.log(`${p.status.padEnd(8)} ${p.id} ${{ story: 'hikâye', goodnews: 'güzel haber' }[kindOf(p)] ?? 'bülten'}: ${p.items.length} haber\n         public/cards/${p.images.join(', ')}`);
}

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  prepare,
  publish: publishNext,
  approve: () => approve(args),
  reject: () => reject(args),
  list,
};
if (!commands[cmd]) {
  console.error('Kullanım: node src/run.js prepare | publish | approve <id|all> | reject <id|all> | list');
  process.exit(1);
}
await commands[cmd]();
