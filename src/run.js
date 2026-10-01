import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { collect, cluster } from './lib/feeds.js';
import { writeCard } from './lib/write.js';
import { render } from './lib/render.js';
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
const trHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }));
// Zamanlayıcı günün her saatinde çalışır; gece saatlerinde taslak hazırlanmaz ve yayın yapılmaz.
const quiet = () => trHour() < settings.activeHours[0] || trHour() >= settings.activeHours[1];
const publishedToday = () => state.published.filter((p) => trDay(p.at) === trDay(Date.now()));

function expireOld(drafts) {
  for (const d of drafts)
    if (['pending', 'approved'].includes(d.status) && Date.now() - d.createdAt > settings.draftExpiryHours * 3600e3) {
      d.status = 'expired';
      saveDraft(d);
    }
}

async function prepare() {
  if (quiet()) return console.log('Sessiz saatler: taslak hazırlanmıyor.');
  const drafts = loadDrafts();
  expireOld(drafts);
  const open = drafts.filter((d) => ['pending', 'approved'].includes(d.status));
  const room = Math.min(settings.maxOpenDrafts - open.length, settings.dailyCap - publishedToday().length - open.length);
  if (room <= 0) return console.log('Yeni taslak gerekmiyor.');

  const { items, failed } = await collect(feeds, settings.maxItemAgeHours);
  failed.forEach((f) => console.warn(`Kaynak okunamadı: ${f}`));

  const usedToday = [...publishedToday(), ...open].reduce((m, p) => ((m[p.topic ?? p.category] = (m[p.topic ?? p.category] ?? 0) + 1), m), {});
  const fresh = cluster(items, settings.clusterThreshold)
    .filter((c) => !c.links.some((l) => state.seen[l]))
    .filter((c) => MODE === 'manual' || c.sources.length >= settings.minSourcesForAuto);
  // İlgi puanı belirleyici; çok kaynaklı ve o gün az işlenmiş konular (savaş, kriz, piyasa, spor) öne gelir.
  const score = (c) => c.interest * 10 + c.sources.length * 4 - (usedToday[c.topic] ?? 0) * 6;
  const candidates = (await rank(fresh, settings))
    .filter((c) => c.interest >= settings.interest.minInterest)
    .sort((a, b) => score(b) - score(a) || b.date - a.date);
  console.log(`${items.length} haber, ${fresh.length} aday, ${candidates.length} tanesi ilgi eşiğini geçti.`);

  const picked = [];
  for (const c of candidates) {
    if (picked.length === room) break;
    if (picked.some((p) => p.topic === c.topic)) continue; // aynı turda konu çeşitliliği
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

  await render(picked, settings, root);
  for (const d of picked) {
    // Haber, taslak olsun olmasın bir daha aday olmasın diye işaretlenir.
    d.links.forEach((l) => (state.seen[l] = d.createdAt));
    if (!d.images.length) {
      console.warn(`ATLANDI ${d.id}: görsel bulunamadı, görselsiz paylaşım yapılmaz. ${d.headline}`);
      continue;
    }
    saveDraft(d);
    console.log(`${d.status.toUpperCase()} ${d.id} [${d.category}/${d.topic}] ilgi ${d.interest} (${d.sources.length} kaynak, görsel: ${d.image.via}) ${d.headline}`);
  }
  // seen kaydı sınırsız büyümesin
  const week = Date.now() - 7 * 86400e3;
  for (const [l, t] of Object.entries(state.seen)) if (t < week) delete state.seen[l];
  saveState();
}

async function publishNext() {
  if (quiet()) return console.log('Sessiz saatler: yayın yapılmıyor.');
  const drafts = loadDrafts();
  expireOld(drafts);
  // Yarım kalan (bazı platformlara gitmiş) taslak önce tamamlanır.
  const next = drafts.find((d) => d.status === 'partial') ?? drafts.find((d) => d.status === 'approved');
  if (!next) return console.log('Onaylı taslak yok.');
  if (next.status === 'approved') {
    if (publishedToday().length >= settings.dailyCap) return console.log('Günlük sınır doldu.');
    const last = state.published.at(-1);
    if (last && Date.now() - last.at < settings.minGapMinutes * 60e3) return console.log('Son yayından bu yana yeterli süre geçmedi.');
  }

  const base = process.env.IMAGE_BASE_URL;
  const platforms = enabled();
  if (!base || !platforms.length) throw new Error('IMAGE_BASE_URL ve en az bir platformun anahtarları tanımlı olmalı.');
  if (!next.images?.length) throw new Error(`${next.id}: görseli olmayan taslak yayınlanamaz.`);
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
    saveDraft(next); // her platformdan sonra kaydet: yarıda kesilirse aynı yere iki kez gönderilmez
  }

  const anyPosted = Object.keys(next.posted).length > 0;
  const open = platforms.some((p) => !next.posted[p.name] && (next.attempts[p.name] ?? 0) < settings.maxPublishAttempts);
  if (anyPosted && !state.published.some((p) => p.id === next.id)) {
    state.published.push({ id: next.id, at: Date.now(), category: next.category, topic: next.topic });
    state.published = state.published.slice(-200);
    saveState();
  }
  next.status = open ? (anyPosted ? 'partial' : 'approved') : anyPosted ? 'published' : 'failed';
  saveDraft(next);
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
