// Yazı işlerinin ortak masası: ayarlar, kalıcı durum (data/state.json), havuz (drafts/) ve gönderiler (posts/).
// Her ajan bu modülden okur; durum tek nesnedir, kaydetme tek yerden yapılır.
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tokens } from '../lib/text.js';

export const root = new URL('../..', import.meta.url).pathname;
export const json = (p) => JSON.parse(readFileSync(root + p, 'utf8'));
export const settings = json('config/settings.json');
export const { feeds } = json('config/sources.json');

const STATE = 'data/state.json';
export const state = existsSync(root + STATE) ? json(STATE) : { seen: {}, published: [] };
// Model çıktıları önbelleği (çeviri, ilgi puanı, güzel haber puanı); kota tasarrufu için. 3 günde temizlenir.
state.cache ??= {};
for (const k of ['tr', 'rank', 'good']) state.cache[k] ??= {};
export function saveState() {
  // seen kaydı ve model önbelleği sınırsız büyümesin
  const week = Date.now() - 7 * 86400e3;
  for (const [l, t] of Object.entries(state.seen)) if (t < week) delete state.seen[l];
  const old = Date.now() - 3 * 86400e3;
  for (const c of Object.values(state.cache)) for (const [k, v] of Object.entries(c)) if ((v.t ?? v[1]) < old) delete c[k];
  writeFileSync(root + STATE, JSON.stringify(state, null, 2) + '\n');
}

// manual: her haber onay bekler. auto: en az iki kaynaklı haberler onaysız havuza girer.
export const MODE = process.env.APPROVAL_MODE === 'auto' ? 'auto' : 'manual';

const load = (dir) =>
  readdirSync(root + dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`${root}${dir}/${f}`, 'utf8')))
    .sort((a, b) => a.createdAt - b.createdAt);
const save = (dir) => (d) => writeFileSync(`${root}${dir}/${d.id}.json`, JSON.stringify(d, null, 2) + '\n');
export const loadDrafts = () => load('drafts');
export const saveDraft = save('drafts');
export const loadPosts = () => load('posts');
export const savePost = save('posts');

export const trDay = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
export const trHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }));
// Zamanlayıcı günün her saatinde çalışır; gece saatlerinde haber hazırlanmaz ve yayın yapılmaz.
export const quiet = () => trHour() < settings.activeHours[0] || trHour() >= settings.activeHours[1];
export const publishedToday = () => state.published.filter((p) => trDay(p.at) === trDay(Date.now()));
export const inPool = (d) => ['pending', 'approved'].includes(d.status);
export const isGood = (d) => d.kind === 'goodnews';
export const isOpen = (p) => ['approved', 'partial'].includes(p.status);
export const kindOf = (p) => p.kind ?? 'bulletin';
export const hasImage = (d) => d.bg && existsSync(root + d.bg);

// Aynı olayın gelişmesi ("sevk edildi" → "tutuklandı") farklı kelimelerle yazılır; jaccard bunu kaçırır.
// Kısa başlığın kelimelerinin yarısı ötekinde geçiyorsa ya da haberin öznesi aynıysa aynı olay sayılır.
export function sameEvent(a, b) {
  const [x, y] = [tokens(a.title), tokens(b.title)];
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  if (inter / (Math.min(x.size, y.size) || 1) >= 0.5) return true;
  return Boolean(a.subject && a.subject === b.subject);
}
export const ev = (d) => ({ title: d.originalTitle ?? d.title, subject: d.imageSubject || d.subject || '' });

// Havuzdan çıkan haberin arka plan dosyası artık gerekmez.
export function retire(d, status) {
  d.status = status;
  if (d.bg) rmSync(root + d.bg, { force: true });
  saveDraft(d);
}
