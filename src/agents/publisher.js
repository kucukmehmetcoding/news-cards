// Yayın müdürü: hazır gönderiyi etkin kanal masalarına dağıtır, kanal başına deneme sayısını ve durumu tutar.
// Kanala özgü biçim ve gönderim kanal masasının adapter'ındadır (src/agents/channels/).
import { enabled } from './channels/index.js';
import { settings, state, saveState, savePost, loadPosts, kindOf, ev, quiet } from '../newsroom/context.js';
import { log } from '../newsroom/desk.js';
import { expireOld } from './editor-housekeeping.js';

async function publishOne(next) {
  const kind = kindOf(next);
  const base = process.env.IMAGE_BASE_URL;
  const channels = enabled(kind);
  if (!base || !channels.length) throw new Error('IMAGE_BASE_URL ve en az bir platformun anahtarları tanımlı olmalı.');
  if ((next.images?.length ?? 0) < (['story', 'figure'].includes(kind) ? 1 : 2)) throw new Error(`${next.id}: slayt sayısı eksik.`);
  const urls = next.images.map((f) => `${base.replace(/\/$/, '')}/${f}`);

  next.posted ??= {};
  next.attempts ??= {};
  for (const c of channels) {
    if (next.posted[c.name] || (next.attempts[c.name] ?? 0) >= settings.maxPublishAttempts) continue;
    try {
      next.posted[c.name] = await c.adapter.publish(urls, c.adapter.text(next, kind), kind);
      console.log(`YAYINLANDI ${c.name} ${kind} ${next.id} → ${next.posted[c.name]}`);
      log(`channel:${c.name}`, 'published', next.id, { kind, mediaId: next.posted[c.name] });
    } catch (e) {
      next.attempts[c.name] = (next.attempts[c.name] ?? 0) + 1;
      console.error(`HATA ${c.name} ${kind} ${next.id} (deneme ${next.attempts[c.name]}): ${e.message}`);
      log(`channel:${c.name}`, 'failed', next.id, { kind, attempt: next.attempts[c.name], error: e.message.slice(0, 300) });
      process.exitCode = 1;
    }
    savePost(next); // her kanaldan sonra kaydet: yarıda kesilirse aynı yere iki kez gönderilmez
  }

  const anyPosted = Object.keys(next.posted).length > 0;
  const open = channels.some((c) => !next.posted[c.name] && (next.attempts[c.name] ?? 0) < settings.maxPublishAttempts);
  // Bülten sınırı ve aralığı yalnız bültenlerle hesaplanır; hikâye kaydı `posts/` dosyasında kalır.
  if (kind === 'bulletin' && anyPosted && !state.published.some((p) => p.id === next.id)) {
    state.published.push({ id: next.id, at: Date.now(), stories: next.items.map((s) => ({ topic: s.topic, ...ev(s) })) });
    state.published = state.published.slice(-200);
    saveState();
  }
  next.status = open ? (anyPosted ? 'partial' : 'approved') : anyPosted ? 'published' : 'failed';
  savePost(next);
}

// Her türden (bülten, hikâye, güzel haber, açıklayıcı, rakam kartı) yayın bekleyen birer gönderi yayınlanır; yarım kalan önce tamamlanır.
export async function publishNext() {
  if (quiet()) return console.log('Sessiz saatler: yayın yapılmıyor.');
  const posts = loadPosts();
  expireOld([], posts);
  let any = false;
  for (const kind of ['bulletin', 'story', 'goodnews', 'explainer', 'figure', 'dossier']) {
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
