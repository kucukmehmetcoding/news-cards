// Yazı İşleri Müdürü: ajanları sırayla çalıştırır. Kararı ajanlar verir; burada yalnız akış ve kayıt var.
//   Muhabir (reporter) → Editör (editor) → Yazar (writer) → Doğrulayıcı (verifier) → Tasarımcı (designer)
//   → havuz (drafts/) → Editör dizilim → Tasarımcı slayt → gönderi (posts/) → Yayın müdürü → kanal masaları
import { createHash } from 'node:crypto';
import * as reporter from '../agents/reporter.js';
import * as editor from '../agents/editor.js';
import { expireOld } from '../agents/editor-housekeeping.js';
import { draft } from '../agents/writer.js';
import { checked, usable } from '../agents/verifier.js';
import * as designer from '../agents/designer.js';
import { research, factsText, timeline } from '../agents/researcher.js';
import { explain } from '../agents/commentator.js';
import { verifyFields } from '../lib/verify.js';
import { makeReel } from '../agents/video.js';
import { perspectives } from '../agents/commentator.js';
import * as approvals from './approvals.js';
import { telegramEnabled, send as tgSend } from '../lib/telegram.js';
import { copyFileSync } from 'node:fs';
import { root } from './context.js';
import { usage } from '../lib/llm.js';
import {
  settings, state, saveState, MODE, loadDrafts, saveDraft, loadPosts, savePost,
  trDay, trHour, quiet, publishedToday, inPool, isGood, isOpen, kindOf, ev, sameEvent, retire, hasImage,
} from './context.js';
import { log, prune } from './desk.js';

const hash = (s, n) => createHash('sha1').update(s).digest('hex').slice(0, n);

// Havuz kaydı: yazılmış ve doğrulanmış olaydan taslak oluşturur.
const toDraft = (c, card, extra) => ({
  status: MODE === 'auto' ? 'approved' : 'pending',
  createdAt: Date.now(),
  sources: c.sources,
  links: c.links,
  originalTitle: c.title,
  ...(c.titleEn ? { titleEn: c.titleEn } : {}),
  interest: c.interest,
  ...extra,
  ...card,
});

// Yazar + Doğrulayıcı: aday listesinden `room` kadar kart üretir.
async function writeUp(list, room, taken, { needText, admit, make }) {
  const picked = [];
  for (const c of list) {
    if (picked.length === room) break;
    if (!admit(c, [...taken, ...picked])) continue;
    const r = await draft(c, { needText: needText(c) });
    if (!r) continue;
    if (!usable(r.card)) break;
    if (!(await checked(r.card, r.story))) continue;
    // Kaynak metin saklanır: Araştırmacı/Yorumcu sonradan açıklayıcı ve rakam kartı yazarken buna dayanır.
    picked.push({ ...make(c, r.card), sourceText: (r.story.article || c.description || '').slice(0, 5000), date: c.date });
  }
  return picked;
}

// Tasarımcı görsel bulur; görselli haber havuza girer, görselsiz haber atılır.
async function keep(picked, drafts, open) {
  await designer.illustrate(picked, open);
  for (const d of picked) {
    // Haber, havuza girsin girmesin bir daha aday olmasın diye işaretlenir.
    d.links.forEach((l) => (state.seen[l] = d.createdAt));
    if (!d.bg) {
      console.warn(`ATLANDI ${d.id}: görsel bulunamadı, görselsiz paylaşım yapılmaz. ${d.headline}`);
      log('designer', 'no-image', d.id, { headline: d.headline });
      continue;
    }
    saveDraft(d);
    drafts.push(d);
    log('editor', 'pooled', d.id, { status: d.status, topic: d.topic, interest: d.interest, sources: d.sources, image: d.image?.via, headline: d.headline });
    console.log(`${d.status.toUpperCase()} ${d.id} [${d.category}/${d.topic}] ilgi ${d.interest} (${d.sources.length} kaynak, görsel: ${d.image.via}) ${d.headline}`);
  }
  saveState();
}

async function fillPool(drafts) {
  const open = drafts.filter((d) => inPool(d) && !isGood(d));
  const room = Math.min(settings.pool.max - open.length, settings.pool.perRun);
  if (room <= 0) return console.log('Havuz dolu.');

  // Günün ilk bülteninden önce gece birikenler de aday olsun diye yaş sınırı geniş tutulur.
  const items = await reporter.gather('news', publishedToday().length ? settings.maxItemAgeHours : settings.firstRunItemAgeHours);
  const todays = [...publishedToday().flatMap((p) => p.stories ?? []), ...open];
  const usedToday = todays.reduce((m, p) => ((m[p.topic] = (m[p.topic] ?? 0) + 1), m), {});
  const recent = [...state.published.filter((p) => Date.now() - p.at < 48 * 3600e3).flatMap((p) => p.stories ?? []), ...open.map(ev)];
  const fresh = reporter.fresh(items, recent);
  const candidates = await editor.candidates(fresh, usedToday);
  console.log(`${items.length} haber, ${fresh.length} aday, ${candidates.length} tanesi ilgi eşiğini geçti.`);

  const picked = await writeUp(candidates, room, open, {
    // Yabancı haberin Türkçesi kaynak metinden yazılır; metin yoksa yalnız başlıktan haber uydurulmaz.
    needText: (c) => Boolean(c.foreign),
    admit: editor.admits,
    make: (c, card) => ({
      id: `${trDay(Date.now())}-${hash(c.links[0], 8)}`,
      ...toDraft(c, card, { category: c.category, ...(c.foreign ? { foreign: true } : {}), topic: c.topic }),
    }),
  });
  if (!picked.length) return console.log('Uygun haber bulunamadı.');
  await keep(picked, drafts, open);
}

async function fillGood(drafts, posts) {
  const g = settings.goodnews;
  const open = drafts.filter((d) => inPool(d) && isGood(d));
  const room = Math.min(g.pool - open.length, g.perRun);
  if (room <= 0 || goodToday(posts)) return;
  const items = await reporter.gather('goodnews', g.maxItemAgeHours);
  const recent = [...posts.filter((p) => p.kind === 'goodnews').flatMap((p) => p.items.map(ev)), ...open.map(ev)];
  const fresh = reporter.fresh(items, recent);
  const candidates = await editor.goodCandidates(fresh);
  console.log(`Güzel haber: ${items.length} haber, ${fresh.length} aday, ${candidates.length} tanesi eşiği geçti.`);
  const picked = await writeUp(candidates, room, [], {
    needText: () => true,
    admit: (c, taken) => !taken.some((p) => sameEvent(ev(p), { title: c.title })),
    make: (c, card) => ({
      id: `${trDay(Date.now())}-g${hash(c.links[0], 7)}`,
      kind: 'goodnews',
      ...toDraft(c, card, { category: 'iyihaber', topic: 'iyi' }),
    }),
  });
  if (picked.length) await keep(picked, drafts, open);
}

const goodToday = (posts) => posts.some((p) => p.kind === 'goodnews' && trDay(p.createdAt) === trDay(Date.now()) && p.status !== 'rejected');

const slim = (s) => {
  const { id, category, topic, interest, sources, originalTitle, imageSubject, headline, brief, hashtags, image, foreign } = s;
  return { id, category, topic, interest, sources, originalTitle, imageSubject, headline, brief, hashtags, image, foreign };
};

async function publishable(post, stories, posts, label) {
  post.images = await designer.slides(post, stories);
  savePost(post);
  posts.push(post);
  for (const d of stories) {
    d.postId = post.id;
    retire(d, 'used');
  }
  log('editor', 'composed', post.id, { kind: kindOf(post), items: stories.map((s) => s.id) });
  console.log(`${label} ${post.id} (${stories.length} haber)\n${stories.map((s, i) => `  ${i + 1}) ${post.kind ? '' : `[${s.topic}] `}${s.headline}`).join('\n')}`);
}

// Vakti geldiyse havuzdaki en güçlü haberlerden bir bülten derler. Vakit saatle değil aralıkla belirlenir.
async function compose(drafts, posts) {
  const b = settings.bulletin;
  if (posts.some((p) => kindOf(p) === 'bulletin' && isOpen(p))) return console.log('Yayın bekleyen bülten var.');
  if (publishedToday().length >= b.dailyCap) return console.log('Günlük sınır doldu.');
  const last = state.published.at(-1);
  if (last && Date.now() - last.at < b.minGapMinutes * 60e3) return console.log('Son yayından bu yana yeterli süre geçmedi.');
  // Yayın başarısız olduysa (ör. token süresi doldu) her turda yeni bülten derleyip havuzu ve kotayı yakma.
  if (posts.some((p) => kindOf(p) === 'bulletin' && p.status === 'failed' && Date.now() - p.createdAt < b.minGapMinutes * 60e3))
    return console.log('Son bülten yayınlanamadı; aralık dolmadan yenisi derlenmiyor.');

  const stories = editor.bulletinLineup(drafts);
  if (stories.length < b.minStories) return console.log(`Bülten için yeterli haber yok (${stories.length}/${b.minStories}).`);
  const post = {
    id: `${trDay(Date.now())}-b${hash(stories.map((s) => s.id).join(), 7)}`,
    status: 'approved',
    createdAt: Date.now(),
    // Bülten kendi kendine yeter: yayın adımı haber taslaklarını yeniden okumaz.
    items: stories.map(slim),
  };
  await publishable(post, stories, posts, 'BÜLTEN');
}

// Hikâye: her pencerede (settings.stories.windows, TSİ saat aralıkları) bir tane. Haber havuzda kalır.
async function composeStory(drafts, posts) {
  const h = trHour();
  const window = settings.stories.windows.findIndex(([a, b]) => h >= a && h < b);
  if (window < 0) return;
  const today = posts.filter((p) => kindOf(p) === 'story' && trDay(p.createdAt) === trDay(Date.now()));
  if (today.some((p) => p.window === window && p.status !== 'rejected')) return;
  const d = editor.storyPick(drafts, today);
  if (!d) return console.log('Hikâye için uygun haber yok.');

  const post = {
    id: `${trDay(Date.now())}-s${hash(d.id, 7)}`,
    kind: 'story',
    window,
    status: 'approved',
    createdAt: Date.now(),
    items: [{ id: d.id, category: d.category, topic: d.topic, sources: d.sources, originalTitle: d.originalTitle, imageSubject: d.imageSubject, headline: d.headline, image: d.image }],
  };
  post.images = await designer.storySlide(post, d);
  savePost(post);
  posts.push(post);
  d.storyId = post.id;
  saveDraft(d);
  log('editor', 'composed', post.id, { kind: 'story', items: [d.id] });
  console.log(`HİKÂYE ${post.id} [${d.topic}] ${d.headline}`);
}

// "Dünyadan güzel haberler": günde bir kaydırmalı gönderi, akşam penceresinde derlenir.
async function composeGood(drafts, posts) {
  const g = settings.goodnews;
  const h = trHour();
  if (h < g.window[0] || h >= g.window[1] || goodToday(posts)) return;
  const stories = editor.goodLineup(drafts);
  if (stories.length < g.minStories) return console.log(`Güzel haber gönderisi için yeterli haber yok (${stories.length}/${g.minStories}).`);
  const post = {
    id: `${trDay(Date.now())}-g${hash(stories.map((s) => s.id).join(), 7)}`,
    kind: 'goodnews',
    status: 'approved',
    createdAt: Date.now(),
    items: stories.map(slim),
  };
  await publishable(post, stories, posts, 'GÜZEL HABER');
}

// Aynı türden bugün kaç gönderi derlendi (reddedilen sayılmaz).
const todayOf = (posts, kind) => posts.filter((p) => p.kind === kind && trDay(p.createdAt) === trDay(Date.now()) && p.status !== 'rejected');
const inWindow = ([a, b]) => trHour() >= a && trHour() < b;
// Doğrulayıcı için taslağın kaynağı: haber metni + araştırma olguları.
const storyOf = (d) => ({ title: d.originalTitle, titleEn: d.titleEn, article: d.sourceText, sources: d.sources, links: d.links, date: d.date });

// Araştırmacı → Yorumcu → Doğrulayıcı. Geçemeyen açıklama yayınlanmaz; taslak bir daha denenmesin diye işaretlenir.
async function analyse(d, mark, fields) {
  const facts = await research(d);
  const x = await explain(d, facts);
  if (!x) return console.warn(`Yorumcu yanıt vermedi: ${d.id}`), null;
  const v = await verifyFields(fields(x), storyOf(d), factsText(facts));
  if (!v.ok) {
    console.warn(`DOĞRULANAMADI (${mark}) ${d.id}: ${v.problems.map((p) => `[${p.rule}] ${p.text}`).join('; ')}`);
    log('verifier', 'rejected', d.id, { kind: mark, problems: v.problems, model: v.model });
    if (v.model !== 'yok') {
      d[`${mark}Id`] = 'rejected';
      saveDraft(d);
    }
    return null;
  }
  return { x, facts };
}

// "Cebine dokunan" açıklayıcı: günde en çok bir; haber havuzda kalır ama bültene girmez.
async function composeExplainer(drafts, posts) {
  const e = settings.explainer;
  if (!inWindow(e.window) || todayOf(posts, 'explainer').length >= e.dailyCap) return;
  const d = editor.explainerPick(drafts);
  if (!d) return console.log('Açıklayıcı için uygun haber yok.');
  const r = await analyse(d, 'explainer', (x) => [['kapak', x.hook], ['ne değişti', x.changed], ['kimi etkiler', x.affects], ['sırada ne var', x.next], ['açıklama', x.summary]]);
  if (!r) return;
  const post = {
    id: `${trDay(Date.now())}-x${hash(d.id, 7)}`,
    kind: 'explainer',
    status: 'approved',
    createdAt: Date.now(),
    items: [slim(d)],
    analysis: r.x,
    facts: r.facts,
  };
  post.images = await designer.explainerSlides(post, d, r.x);
  savePost(post);
  posts.push(post);
  d.explainerId = post.id;
  saveDraft(d);
  log('editor', 'composed', post.id, { kind: 'explainer', items: [d.id], facts: r.facts.length });
  console.log(`AÇIKLAYICI ${post.id} ${r.x.hook}`);
}

// "Dosya": aynı olayın son 14 gündeki seyri. Metin yeni yazılmaz — her satır daha önce doğrulanıp havuza girmiş başlıktır.
async function composeDossier(drafts, posts) {
  const s = settings.dossier;
  if (!inWindow(s.window) || todayOf(posts, 'dossier').length >= s.dailyCap) return;
  const pick = editor.dossierPick(drafts, timeline);
  if (!pick) return console.log('Dosya için yeterli geçmişi olan haber yok.');
  const { d, past } = pick;
  const entries = [...past.map((p) => ({ day: p.day, headline: p.headline, source: p.source })), { day: trDay(d.createdAt), headline: d.headline, source: d.sources[0] }];
  const post = {
    id: `${trDay(Date.now())}-d${hash(d.id, 7)}`,
    kind: 'dossier',
    status: 'approved',
    createdAt: Date.now(),
    items: [slim(d)],
    entries,
  };
  post.images = await designer.dossierSlides(post, d, entries);
  savePost(post);
  posts.push(post);
  d.dossierId = post.id;
  saveDraft(d);
  log('editor', 'composed', post.id, { kind: 'dossier', items: [d.id], entries: entries.length });
  console.log(`DOSYA ${post.id} (${entries.length} gelişme) ${d.headline}`);
}

// Reels: bugünkü açıklayıcının seslendirmeli dikey videosu (günde en çok settings.reel.dailyCap).
// Video üretilemezse (edge-tts/ffmpeg yok, ağ hatası) açıklayıcı yine karusel olarak yayınlanır.
async function composeReel(drafts, posts) {
  const r = settings.reel;
  if (!r.enabled || todayOf(posts, 'reel').length >= r.dailyCap) return;
  const src = todayOf(posts, 'explainer').find((p) => !p.reelId && p._charts !== undefined);
  const d = src && drafts.find((x) => x.id === src.items[0].id);
  if (!src || !d || !hasImage(d)) return;
  const id = `${trDay(Date.now())}-v${hash(src.id, 7)}`;
  try {
    const v = await makeReel(src, id, await designer.reelFrames({ ...src, id }, d));
    const post = { id, kind: 'reel', status: 'approved', createdAt: Date.now(), from: src.id, items: src.items, analysis: src.analysis, images: [v.file], duration: v.duration, narration: v.narration };
    savePost(post);
    posts.push(post);
    log('editor', 'composed', id, { kind: 'reel', from: src.id, seconds: v.duration });
    console.log(`REELS ${id} (${v.duration} sn) ← ${src.id}`);
  } catch (e) {
    console.warn(`Reels üretilemedi (${src.id}): ${e.message}`);
    log('video', 'failed', id, { from: src.id, error: e.message.slice(0, 300) });
  }
  src.reelId = id;
  delete src._charts;
  savePost(src);
}

// YORUM adayı: Araştırmacı → Yorumcu (analiz) → Doğrulayıcı → bakış açısı taslakları (her biri görüş kipinde denetlenir)
// → Telegram ile kullanıcıya. Kullanıcı seçmeden ya da yazmadan yayın yok.
async function composeCommentary(drafts, posts) {
  const c = settings.commentary;
  if (!telegramEnabled()) return;
  if (!inWindow(c.window)) return;
  const today = posts.filter((p) => p.kind === 'commentary' && trDay(p.createdAt) === trDay(Date.now()) && !['rejected', 'expired'].includes(p.status));
  const room = Math.min(c.dailyCap - today.length, c.maxWaiting - posts.filter((p) => p.kind === 'commentary' && p.status === 'awaiting').length);
  if (room <= 0) return;
  for (const d of editor.commentaryPicks(drafts, room)) {
    d.commentaryId = 'pending';
    saveDraft(d);
    const r = await analyse(d, 'commentary', (x) => [['kapak', x.hook], ['ne oldu', x.changed], ['neden önemli', x.affects], ['sırada ne var', x.next]]);
    if (!r) continue;
    const drafted = (await perspectives(d, r.facts, r.x)) ?? [];
    const kept = [];
    for (const p of drafted) {
      const v = await verifyFields([['görüş', p.text]], storyOf(d), factsText(r.facts), { opinion: true });
      if (v.ok) kept.push(p);
      else log('verifier', 'rejected', d.id, { kind: 'perspective', angle: p.angle, problems: v.problems });
    }
    if (!kept.length) {
      console.warn(`Yorum: geçerli bakış açısı taslağı yok (${d.id}).`);
      continue;
    }
    const id = `${trDay(Date.now())}-c${hash(d.id, 7)}`;
    const bg = `data/bg/${id}.jpg`;
    copyFileSync(root + d.bg, root + bg);
    const post = {
      id, kind: 'commentary', status: 'awaiting', createdAt: Date.now(), items: [slim(d)], links: d.links, date: d.date,
      sourceText: d.sourceText, analysis: r.x, facts: r.facts, perspectives: kept, bg,
    };
    savePost(post);
    posts.push(post);
    d.commentaryId = id;
    saveDraft(d);
    await approvals.ask(post);
    log('editor', 'awaiting-approval', id, { from: d.id, perspectives: kept.length });
    console.log(`YORUM ADAYI ${id} Telegram'a gönderildi: ${d.headline}`);
  }
}

// Kullanıcının seçtiği görüşle yorum gönderisini çizer ve yayına alır.
async function finishCommentary(posts) {
  for (const p of posts.filter((p) => p.kind === 'commentary' && p.status === 'chosen' && p.opinion?.text)) {
    p.images = await designer.commentarySlides(p);
    p.status = 'approved';
    p.approvedAt = Date.now();
    savePost(p);
    log('editor', 'composed', p.id, { kind: 'commentary', opinion: p.opinion.from });
    console.log(`YORUM ${p.id} yayına alındı (${p.opinion.from}).`);
    await tgSend(`📤 <code>${p.id}</code> yayın sırasına alındı.`).catch(() => {});
  }
}

// "Rakamla": günde en çok bir tek kart; rakam ve etiketi doğrulayıcıdan geçer.
async function composeFigure(drafts, posts) {
  const f = settings.figure;
  if (!inWindow(f.window) || todayOf(posts, 'figure').length >= f.dailyCap) return;
  const d = editor.figurePick(drafts);
  if (!d) return console.log('Rakam kartı için uygun haber yok.');
  const r = await analyse(d, 'figure', (x) => [['rakam', x.figure ? `${x.figure.value} — ${x.figure.label}` : '(yok)'], ['açıklama', x.summary]]);
  if (!r) return;
  if (!r.x.figure) {
    d.figureId = 'none';
    saveDraft(d);
    return console.log(`Rakam kartı: anlamlı rakam yok (${d.id}).`);
  }
  const fact = /^A(\d+)$/.exec(r.x.figure.from);
  const source = fact ? r.facts[Number(fact[1]) - 1]?.source ?? d.sources[0] : d.sources.slice(0, 2).join(', ');
  const post = {
    id: `${trDay(Date.now())}-r${hash(d.id, 7)}`,
    kind: 'figure',
    status: 'approved',
    createdAt: Date.now(),
    items: [slim(d)],
    analysis: r.x,
    facts: r.facts,
  };
  post.images = await designer.figureSlide(post, d, r.x.figure, source);
  savePost(post);
  posts.push(post);
  d.figureId = post.id;
  saveDraft(d);
  log('editor', 'composed', post.id, { kind: 'figure', items: [d.id], figure: r.x.figure });
  console.log(`RAKAMLA ${post.id} ${r.x.figure.value} — ${r.x.figure.label}`);
}

export async function prepare() {
  if (quiet()) return console.log('Sessiz saatler: haber hazırlanmıyor.');
  const drafts = loadDrafts();
  const posts = loadPosts();
  expireOld(drafts, posts);
  prune();
  // Kullanıcının Telegram yanıtları önce işlenir: onaylanan yorum bu turda yayına hazırlanır.
  if (await approvals.poll().catch((e) => console.warn(`Telegram okunamadı: ${e.message}`))) posts.splice(0, posts.length, ...loadPosts());
  await finishCommentary(posts);
  await fillPool(drafts);
  await fillGood(drafts, posts);
  await composeStory(drafts, posts);
  // Açıklayıcı ve rakam kartı bültenden önce: haberin görseli bülten derlenince silinir.
  await composeCommentary(drafts, posts);
  await composeExplainer(drafts, posts);
  await composeReel(drafts, posts);
  await composeFigure(drafts, posts);
  await composeDossier(drafts, posts);
  await compose(drafts, posts);
  await composeGood(drafts, posts);
  saveState(); // model önbelleği yeni haber çıkmasa da saklanır
  console.log(`Model çağrıları: ${JSON.stringify(usage)}`);
}

export function approve(ids) {
  const drafts = loadDrafts().filter((d) => d.status === 'pending');
  const targets = ids.includes('all') ? drafts : drafts.filter((d) => ids.includes(d.id));
  if (!targets.length) return console.log('Eşleşen bekleyen haber yok.');
  for (const d of targets) {
    d.status = 'approved';
    saveDraft(d);
    log('human', 'approved', d.id);
    console.log(`APPROVED ${d.id} ${d.headline}`);
  }
}

// Havuzdaki haber (bekleyen ya da onaylı) ve henüz hiçbir yere gitmemiş bülten reddedilebilir.
export function reject(ids) {
  const all = ids.includes('all');
  const drafts = loadDrafts().filter((d) => inPool(d) && (all || ids.includes(d.id)));
  const posts = loadPosts().filter((p) => p.status === 'approved' && (all || ids.includes(p.id)));
  if (!drafts.length && !posts.length) return console.log('Eşleşen haber ya da bülten yok.');
  for (const d of drafts) {
    retire(d, 'rejected');
    log('human', 'rejected', d.id);
    console.log(`REJECTED ${d.id} ${d.headline}`);
  }
  for (const p of posts) {
    p.status = 'rejected';
    savePost(p);
    log('human', 'rejected', p.id);
    console.log(`REJECTED ${p.id} (bülten, ${p.items.length} haber)`);
  }
}

export function list() {
  for (const d of loadDrafts().filter(inPool)) console.log(`${d.status.padEnd(8)} ${d.id} [${d.category}/${d.topic}] ${d.headline}`);
  for (const p of loadPosts().filter(isOpen))
    console.log(`${p.status.padEnd(8)} ${p.id} ${{ story: 'hikâye', goodnews: 'güzel haber', explainer: 'açıklayıcı', figure: 'rakamla', dossier: 'dosya', reel: 'reels', commentary: 'yorum' }[kindOf(p)] ?? 'bülten'}: ${p.items.length} haber\n         public/cards/${p.images.join(', ')}`);
}
