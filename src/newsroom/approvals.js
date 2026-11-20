// Görüş onayı (Telegram): yorum adayı kullanıcıya gider; kullanıcı bir taslağı seçer, kendi görüşünü yanıt olarak
// yazar ya da reddeder. Sunucu yok — hat her turda yanıtları çeker. Onaylanan görüş olmadan YORUM yayınlanmaz.
import { send, updates, ack, clearButtons, escapeHtml as h, telegramEnabled } from '../lib/telegram.js';
import { verifyFields } from '../lib/verify.js';
import { factsText } from '../agents/researcher.js';
import { state, saveState, loadPosts, savePost } from './context.js';
import { log } from './desk.js';

export function message(post) {
  const x = post.analysis;
  const s = post.items[0];
  return [
    ...(process.env.DRY_RUN ? ['🧪 <b>DENEME</b> — seçimin işlenecek ama YAYINLANMAYACAK'] : []),
    `🗞 <b>YORUM ADAYI</b> · <code>${post.id}</code>`,
    `<b>${h(s.headline)}</b>`,
    `Kaynak: ${h(s.sources.slice(0, 3).join(', '))}`,
    '',
    `<b>Kapak:</b> ${h(x.hook)}`,
    `<b>Ne oldu:</b> ${h(x.changed)}`,
    x.affects && `<b>Neden önemli:</b> ${h(x.affects)}`,
    x.next && `<b>Sırada:</b> ${h(x.next)}`,
    ...((post.voices ?? []).length ? ['', '<b>Kim ne diyor</b>', ...post.voices.map((v) => `• ${h(v.source)} <i>(${h(v.stance)})</i>: ${h(v.title)}`)] : []),
    '',
    '<b>Görüş taslakları</b>',
    ...post.perspectives.map((p, i) => `${i + 1}) <i>${h(p.angle)}</i> — ${h(p.text)}`),
    '',
    'Bir taslağı seç ya da bu mesaja <b>yanıt</b> olarak kendi görüşünü yaz (2-3 cümle).',
  ]
    .filter((l) => l !== false && l !== undefined && l !== '')
    .join('\n');
}

const buttons = (post) => [
  post.perspectives.map((_, i) => ({ text: `${i + 1}`, data: `c|${post.id}|${i}` })),
  [{ text: 'Reddet', data: `c|${post.id}|x` }],
];

export async function ask(post) {
  post.telegram = { messageId: await send(message(post), buttons(post)), sentAt: Date.now() };
  savePost(post);
}

const story = (p) => ({ title: p.items[0].originalTitle, article: p.sourceText, sources: p.items[0].sources, links: p.links ?? [], date: p.date });

// Yanıtları işler. Dönüş: değişen gönderi sayısı.
export async function poll() {
  if (!telegramEnabled()) return 0;
  state.telegram ??= { offset: 0 };
  const { events, offset } = await updates(state.telegram.offset);
  state.telegram.offset = offset;
  saveState();
  if (!events.length) return 0;
  const posts = loadPosts();
  const waiting = (id) => posts.find((p) => p.id === id && ['awaiting', 'flagged'].includes(p.status));
  let changed = 0;
  for (const e of events) {
    if (e.type === 'button') {
      const [tag, id, choice] = e.data.split('|');
      const p = waiting(id);
      if (tag !== 'c' || !p) {
        await ack(e.callbackId, 'Bu aday artık beklemede değil.');
        continue;
      }
      await clearButtons(e.messageId);
      if (choice === 'x') {
        p.status = 'rejected';
        await ack(e.callbackId, 'Reddedildi');
        log('human', 'rejected', p.id, { via: 'telegram' });
      } else if (choice === 'f') {
        p.status = 'chosen'; // kullanıcı uyarıya rağmen kendi metnini yayınlattı
        await ack(e.callbackId, 'Yayına hazırlanıyor');
        log('human', 'approved', p.id, { via: 'telegram', override: true });
      } else {
        const pick = p.perspectives[Number(choice)];
        p.opinion = { text: pick.text, from: `taslak ${Number(choice) + 1}` };
        p.status = 'chosen';
        await ack(e.callbackId, `Taslak ${Number(choice) + 1} seçildi`);
        log('human', 'approved', p.id, { via: 'telegram', draft: Number(choice) + 1 });
      }
      savePost(p);
      changed++;
    } else if (e.type === 'text' && e.replyTo) {
      const p = posts.find((x) => x.telegram?.messageId === e.replyTo && ['awaiting', 'flagged'].includes(x.status));
      if (!p) continue;
      const text = e.text.trim().slice(0, 420);
      p.opinion = { text, from: 'kullanıcı' };
      // Kullanıcının kendi görüşü: yalnız olgu çelişkisi ve dil denetlenir; sorun varsa uyarılır, karar onundur.
      const v = await verifyFields([['görüş', text]], story(p), factsText(p.facts ?? []), { opinion: true });
      if (v.ok || v.model === 'yok') {
        p.status = 'chosen';
        await send(`✅ <code>${p.id}</code> görüşün alındı, yayına hazırlanıyor.`);
        log('human', 'approved', p.id, { via: 'telegram', own: true });
      } else {
        p.status = 'flagged';
        const problems = v.problems.map((x) => `• ${h(x.text)}`).join('\n');
        await send(`⚠️ <code>${p.id}</code> görüşünde denetimin işaretledikleri:\n${problems}\n\nDüzeltmek için ana mesaja yeniden yanıt yaz ya da:`, [
          [{ text: 'Yine de yayınla', data: `c|${p.id}|f` }, { text: 'İptal', data: `c|${p.id}|x` }],
        ]);
        log('verifier', 'flagged', p.id, { problems: v.problems });
      }
      savePost(p);
      changed++;
    }
  }
  return changed;
}
