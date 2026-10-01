import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { collect, cluster } from './lib/feeds.js';
import { writeCard, caption } from './lib/write.js';
import { render } from './lib/render.js';
import { publish } from './lib/instagram.js';

const root = new URL('..', import.meta.url).pathname;
const json = (p) => JSON.parse(readFileSync(root + p, 'utf8'));
const settings = json('config/settings.json');
const { feeds } = json('config/sources.json');
const STATE = 'data/state.json';
const state = existsSync(root + STATE) ? json(STATE) : { seen: {}, published: [] };
const saveState = () => writeFileSync(root + STATE, JSON.stringify(state, null, 2) + '\n');

// manual: her taslak onay bekler. auto: en az iki kaynaklı haberler onaysız yayınlanır.
const MODE = process.env.APPROVAL_MODE === 'auto' ? 'auto' : 'manual';

const draftPath = (id) => `${root}drafts/${id}.json`;
const loadDrafts = () =>
  readdirSync(root + 'drafts')
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`${root}drafts/${f}`, 'utf8')))
    .sort((a, b) => a.createdAt - b.createdAt);
const saveDraft = (d) => writeFileSync(draftPath(d.id), JSON.stringify(d, null, 2) + '\n');

const trDay = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
const publishedToday = () => state.published.filter((p) => trDay(p.at) === trDay(Date.now()));

function expireOld(drafts) {
  for (const d of drafts)
    if (['pending', 'approved'].includes(d.status) && Date.now() - d.createdAt > settings.draftExpiryHours * 3600e3) {
      d.status = 'expired';
      saveDraft(d);
    }
}

async function prepare() {
  const drafts = loadDrafts();
  expireOld(drafts);
  const open = drafts.filter((d) => ['pending', 'approved'].includes(d.status));
  const room = Math.min(settings.maxOpenDrafts - open.length, settings.dailyCap - publishedToday().length - open.length);
  if (room <= 0) return console.log('Yeni taslak gerekmiyor.');

  const { items, failed } = await collect(feeds, settings.maxItemAgeHours);
  failed.forEach((f) => console.warn(`Kaynak okunamadı: ${f}`));

  const usedToday = [...publishedToday(), ...open].reduce((m, p) => ((m[p.category] = (m[p.category] ?? 0) + 1), m), {});
  const candidates = cluster(items, settings.clusterThreshold)
    .filter((c) => !c.links.some((l) => state.seen[l]))
    .filter((c) => MODE === 'manual' || c.sources.length >= settings.minSourcesForAuto)
    // Çok kaynaklı ve o gün az işlenmiş kategoriler öne gelir.
    .sort((a, b) => b.sources.length * 10 - (usedToday[b.category] ?? 0) * 8 - (a.sources.length * 10 - (usedToday[a.category] ?? 0) * 8) || b.date - a.date);

  const picked = [];
  for (const c of candidates) {
    if (picked.length === room) break;
    if (picked.some((p) => p.category === c.category)) continue; // aynı turda kategori çeşitliliği
    const card = await writeCard(c);
    picked.push({
      id: `${trDay(Date.now())}-${createHash('sha1').update(c.links[0]).digest('hex').slice(0, 8)}`,
      status: MODE === 'auto' ? 'approved' : 'pending',
      createdAt: Date.now(),
      category: c.category,
      sources: c.sources,
      links: c.links,
      originalTitle: c.title,
      ...card,
    });
  }
  if (!picked.length) return console.log('Uygun haber bulunamadı.');

  await render(picked, settings, root + 'public/cards');
  for (const d of picked) {
    saveDraft(d);
    d.links.forEach((l) => (state.seen[l] = d.createdAt));
    console.log(`${d.status.toUpperCase()} ${d.id} [${d.category}] (${d.sources.length} kaynak) ${d.headline}`);
  }
  // seen kaydı sınırsız büyümesin
  const week = Date.now() - 7 * 86400e3;
  for (const [l, t] of Object.entries(state.seen)) if (t < week) delete state.seen[l];
  saveState();
}

async function publishNext() {
  const drafts = loadDrafts();
  expireOld(drafts);
  const next = drafts.find((d) => d.status === 'approved');
  if (!next) return console.log('Onaylı taslak yok.');
  if (publishedToday().length >= settings.dailyCap) return console.log('Günlük sınır doldu.');
  const last = state.published.at(-1);
  if (last && Date.now() - last.at < settings.minGapMinutes * 60e3) return console.log('Son yayından bu yana yeterli süre geçmedi.');

  const base = process.env.IMAGE_BASE_URL;
  if (!base || !process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID)
    throw new Error('IMAGE_BASE_URL, IG_ACCESS_TOKEN ve IG_USER_ID tanımlı olmalı.');
  const mediaId = await publish(next.images.map((f) => `${base.replace(/\/$/, '')}/${f}`), caption(next));
  next.status = 'published';
  next.mediaId = mediaId;
  saveDraft(next);
  state.published.push({ id: next.id, at: Date.now(), category: next.category, mediaId });
  state.published = state.published.slice(-200);
  saveState();
  console.log(`YAYINLANDI ${next.id} → ${mediaId}`);
}

function setStatus(to, ids) {
  const drafts = loadDrafts().filter((d) => d.status === 'pending');
  const targets = ids.includes('all') ? drafts : drafts.filter((d) => ids.includes(d.id));
  if (!targets.length) return console.log('Eşleşen bekleyen taslak yok.');
  for (const d of targets) {
    d.status = to;
    saveDraft(d);
    console.log(`${to.toUpperCase()} ${d.id} ${d.headline}`);
  }
}

function list() {
  for (const d of loadDrafts().filter((d) => ['pending', 'approved'].includes(d.status)))
    console.log(`${d.status.padEnd(8)} ${d.id} [${d.category}] ${d.headline}\n         public/cards/${d.images.join(', ')}`);
}

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  prepare,
  publish: publishNext,
  approve: () => setStatus('approved', args),
  reject: () => setStatus('rejected', args),
  list,
};
if (!commands[cmd]) {
  console.error('Kullanım: node src/run.js prepare | publish | approve <id|all> | reject <id|all> | list');
  process.exit(1);
}
await commands[cmd]();
