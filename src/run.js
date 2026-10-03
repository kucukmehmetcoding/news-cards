import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { collect, cluster } from './lib/feeds.js';
import { tokens } from './lib/text.js';
import { writeCard } from './lib/write.js';
import { backgrounds, renderPost } from './lib/render.js';
import { articleText } from './lib/article.js';
import { rank } from './lib/rank.js';
import { enabled } from './lib/platforms.js';

const root = new URL('..', import.meta.url).pathname;
const json = (p) => JSON.parse(readFileSync(root + p, 'utf8'));
const settings = json('config/settings.json');
const { feeds } = json('config/sources.json');
const STATE = 'data/state.json';
const state = existsSync(root + STATE) ? json(STATE) : { seen: {}, published: [] };
const saveState = () => writeFileSync(root + STATE, JSON.stringify(state, null, 2) + '\n');

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
const isOpen = (p) => ['approved', 'partial'].includes(p.status);
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
  for (const d of drafts) if (inPool(d) && Date.now() - d.createdAt > settings.pool.expiryHours * 3600e3) retire(d, 'expired');
  // Hiçbir platforma gidemeden bayatlayan bülten yayınlanmaz.
  for (const p of posts)
    if (p.status === 'approved' && Date.now() - p.createdAt > settings.bulletin.expiryHours * 3600e3) {
      p.status = 'expired';
      savePost(p);
    }
}

// Havuzu doldurur: ilgi eşiğini geçen yeni haberler yazılır, görseli bulunur ve taslak olarak saklanır.
async function fillPool(drafts) {
  const open = drafts.filter(inPool);
  const room = Math.min(settings.pool.max - open.length, settings.pool.perRun);
  if (room <= 0) return console.log('Havuz dolu.');

  // Günün ilk bülteninden önce gece birikenler de aday olsun diye yaş sınırı geniş tutulur.
  const { items, failed } = await collect(feeds, publishedToday().length ? settings.maxItemAgeHours : settings.firstRunItemAgeHours);
  failed.forEach((f) => console.warn(`Kaynak okunamadı: ${f}`));

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
    .filter((c) => MODE === 'manual' || c.sources.length >= settings.minSourcesForAuto);
  // İlgi puanı belirleyici; çok kaynaklı ve o gün az işlenmiş konular (savaş, kriz, piyasa, spor) öne gelir.
  const score = (c) => c.interest * 10 + c.sources.length * 4 - (usedToday[c.topic] ?? 0) * 6;
  const candidates = (await rank(fresh, settings))
    // Dört ana konu (savaş, kriz, piyasa, spor) dışındaki haberler ancak çok yüksek puanla girer.
    .filter((c) => c.interest >= (c.topic === 'diger' ? settings.interest.minInterestOther : settings.interest.minInterest))
    .sort((a, b) => score(b) - score(a) || b.date - a.date);
  console.log(`${items.length} haber, ${fresh.length} aday, ${candidates.length} tanesi ilgi eşiğini geçti.`);

  const picked = [];
  const topicCount = (t) => [...open, ...picked].filter((p) => p.topic === t).length;
  for (const c of candidates) {
    if (picked.length === room) break;
    if (topicCount(c.topic) >= settings.bulletin.maxPerTopic) continue; // bülten tek konuya yığılmasın
    if (picked.some((p) => sameEvent(ev(p), { title: c.title }))) continue;
    const card = await writeCard({ ...c, article: await articleText(c.lead) });
    picked.push({
      id: `${trDay(Date.now())}-${createHash('sha1').update(c.links[0]).digest('hex').slice(0, 8)}`,
      status: MODE === 'auto' ? 'approved' : 'pending',
      createdAt: Date.now(),
      category: c.category,
      sources: c.sources,
      links: c.links,
      originalTitle: c.title,
      interest: c.interest,
      topic: c.topic,
      ...card,
    });
  }
  if (!picked.length) return console.log('Uygun haber bulunamadı.');

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
  // seen kaydı sınırsız büyümesin
  const week = Date.now() - 7 * 86400e3;
  for (const [l, t] of Object.entries(state.seen)) if (t < week) delete state.seen[l];
  saveState();
}

// Vakti geldiyse havuzdaki en güçlü haberlerden bir bülten derler. Vakit saatle değil aralıkla belirlenir:
// zamanlayıcı düzensiz çalışsa da son gönderiden yeterince sonra ve yeterli haber varken bülten çıkar.
async function compose(drafts, posts) {
  const b = settings.bulletin;
  if (posts.some(isOpen)) return console.log('Yayın bekleyen bülten var.');
  if (publishedToday().length >= b.dailyCap) return console.log('Günlük sınır doldu.');
  const last = state.published.at(-1);
  if (last && Date.now() - last.at < b.minGapMinutes * 60e3) return console.log('Son yayından bu yana yeterli süre geçmedi.');

  const ready = drafts.filter((d) => d.status === 'approved' && d.bg && existsSync(root + d.bg));
  const stories = [];
  for (const d of ready.sort((x, y) => y.interest - x.interest || y.sources.length - x.sources.length)) {
    if (stories.length === b.stories) break;
    if (stories.filter((s) => s.topic === d.topic).length >= b.maxPerTopic) continue;
    if (stories.some((s) => sameEvent(ev(s), ev(d)))) continue;
    stories.push(d);
  }
  if (stories.length < b.minStories) return console.log(`Bülten için yeterli haber yok (${stories.length}/${b.minStories}).`);

  const post = {
    id: `${trDay(Date.now())}-b${createHash('sha1').update(stories.map((s) => s.id).join()).digest('hex').slice(0, 7)}`,
    status: 'approved',
    createdAt: Date.now(),
    // Bülten kendi kendine yeter: yayın adımı haber taslaklarını yeniden okumaz.
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
  console.log(`BÜLTEN ${post.id} (${stories.length} haber)\n${stories.map((s, i) => `  ${i + 1}) [${s.topic}] ${s.headline}`).join('\n')}`);
}

async function prepare() {
  if (quiet()) return console.log('Sessiz saatler: haber hazırlanmıyor.');
  const drafts = loadDrafts();
  const posts = loadPosts();
  expireOld(drafts, posts);
  await fillPool(drafts);
  await compose(drafts, posts);
}

async function publishNext() {
  if (quiet()) return console.log('Sessiz saatler: yayın yapılmıyor.');
  const posts = loadPosts();
  expireOld([], posts);
  // Yarım kalan (bazı platformlara gitmiş) bülten önce tamamlanır.
  const next = posts.find((p) => p.status === 'partial') ?? posts.find((p) => p.status === 'approved');
  if (!next) return console.log('Yayın bekleyen bülten yok.');

  const base = process.env.IMAGE_BASE_URL;
  const platforms = enabled();
  if (!base || !platforms.length) throw new Error('IMAGE_BASE_URL ve en az bir platformun anahtarları tanımlı olmalı.');
  if ((next.images?.length ?? 0) < 2) throw new Error(`${next.id}: bülten en az iki slayt içermeli.`);
  const urls = next.images.map((f) => `${base.replace(/\/$/, '')}/${f}`);

  next.posted ??= {};
  next.attempts ??= {};
  for (const p of platforms) {
    if (next.posted[p.name] || (next.attempts[p.name] ?? 0) >= settings.maxPublishAttempts) continue;
    try {
      next.posted[p.name] = await p.publish(urls, p.text(next));
      console.log(`YAYINLANDI ${p.name} ${next.id} → ${next.posted[p.name]}`);
    } catch (e) {
      next.attempts[p.name] = (next.attempts[p.name] ?? 0) + 1;
      console.error(`HATA ${p.name} ${next.id} (deneme ${next.attempts[p.name]}): ${e.message}`);
      process.exitCode = 1;
    }
    savePost(next); // her platformdan sonra kaydet: yarıda kesilirse aynı yere iki kez gönderilmez
  }

  const anyPosted = Object.keys(next.posted).length > 0;
  const open = platforms.some((p) => !next.posted[p.name] && (next.attempts[p.name] ?? 0) < settings.maxPublishAttempts);
  if (anyPosted && !state.published.some((p) => p.id === next.id)) {
    state.published.push({ id: next.id, at: Date.now(), stories: next.items.map((s) => ({ topic: s.topic, ...ev(s) })) });
    state.published = state.published.slice(-200);
    saveState();
  }
  next.status = open ? (anyPosted ? 'partial' : 'approved') : anyPosted ? 'published' : 'failed';
  savePost(next);
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
    console.log(`${p.status.padEnd(8)} ${p.id} bülten: ${p.items.length} haber\n         public/cards/${p.images.join(', ')}`);
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
