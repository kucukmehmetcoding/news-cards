// Büyüme stratejisti: kanal başına tek seferde TEK bir A/B deneyi yürütür (karışmasın diye).
// Kollar yayın anında sırayla atanır (dengeli), sonuç olgunlaşmış ölçümle değerlendirilir. Kazanan kalıcı
// varsayılan olur ve sıradaki deney menüden başlar. Deneyler yalnız biçimle oynar — haberin içeriğine dokunmaz.
import { value, mature, mean } from './score.js';

// Deney menüsü: düğme → kollar. apply(caption, arm) açıklama metnini dönüştürür.
export const KNOBS = {
  cta: {
    label: 'Açıklama sonu çağrısı',
    kinds: ['bulletin', 'goodnews'], // diğer türlerin açıklamasında zaten çağrı var
    arms: {
      kaydet: 'Sonra bakmak için kaydet, lazım olacak birine gönder.',
      soru: 'Sen ne düşünüyorsun? Yorumlara yaz.',
    },
    apply: (text, arm, knob) => insertBeforeTags(text, knob.arms[arm]),
  },
  tags: {
    label: 'Etiket sayısı',
    kinds: ['bulletin', 'goodnews', 'explainer', 'figure', 'dossier', 'reel'],
    arms: { az: 3, cok: 8 },
    apply: (text, arm, knob) => limitTags(text, knob.arms[arm]),
  },
};
export const MENU = ['cta', 'tags'];

const TAG_LINE = /\n\n((?:#[\p{L}\p{N}_]+\s?)+)$/u;
function insertBeforeTags(text, line) {
  const m = text.match(TAG_LINE);
  return m ? `${text.slice(0, m.index)}\n\n${line}\n\n${m[1]}` : `${text}\n\n${line}`;
}
function limitTags(text, n) {
  const m = text.match(TAG_LINE);
  if (!m) return text;
  return `${text.slice(0, m.index)}\n\n${m[1].trim().split(/\s+/).slice(0, n).join(' ')}`;
}

// state: data/growth/<kanal>.json → { defaults: {knob: arm}, active: {...} | null, history: [...] }
export function ensureActive(state, now = Date.now()) {
  if (state.active) return state;
  const done = new Set(state.history.map((h) => h.knob));
  const knob = MENU.find((k) => !done.has(k)) ?? MENU[state.history.length % MENU.length];
  state.active = { id: `${knob}-${new Date(now).toISOString().slice(0, 10)}`, knob, arms: Object.keys(KNOBS[knob].arms), kinds: KNOBS[knob].kinds, start: now, assigned: {} };
  return state;
}

// Yayın anında: gönderiye kol atar ve dönüştürülmüş açıklamayı verir. Deney dışı türde varsayılanlar uygulanır.
export function shape(state, post, kind, text) {
  let out = text;
  for (const [knob, arm] of Object.entries(state.defaults ?? {}))
    if (KNOBS[knob]?.kinds.includes(kind) && state.active?.knob !== knob) out = KNOBS[knob].apply(out, arm, KNOBS[knob]);
  const a = state.active;
  if (!a || !a.kinds.includes(kind)) return { text: out };
  let arm = a.assigned[post.id];
  if (!arm) {
    const counts = a.arms.map((x) => Object.values(a.assigned).filter((y) => y === x).length);
    arm = a.arms[counts.indexOf(Math.min(...counts))];
    a.assigned[post.id] = arm;
  }
  return { text: KNOBS[a.knob].apply(out, arm, KNOBS[a.knob]), experiment: { id: a.id, knob: a.knob, arm } };
}

// Değerlendirme: her kolda en az `minPerArm` olgun gönderi varsa karar. Fark %20'den azsa "fark yok":
// mevcut varsayılan korunur. Karar verilince deney geçmişe yazılır.
export function evaluate(state, media, { minPerArm = 5, maxDays = 21 } = {}) {
  const a = state.active;
  if (!a) return null;
  const rows = mature(Object.entries(a.assigned).map(([id, arm]) => media[id] && { ...media[id], arm }).filter(Boolean));
  const stats = Object.fromEntries(a.arms.map((arm) => {
    const v = rows.filter((r) => r.arm === arm).map(value).filter((x) => x !== null);
    return [arm, { n: v.length, score: v.length ? Math.round(mean(v) * 10) / 10 : null }];
  }));
  const enough = a.arms.every((arm) => stats[arm].n >= minPerArm);
  const expired = Date.now() - a.start > maxDays * 86400e3;
  if (!enough && !expired) return { id: a.id, knob: a.knob, stats, decided: false };
  const [first, second] = [...a.arms].sort((x, y) => (stats[y].score ?? -1) - (stats[x].score ?? -1));
  const clear = enough && stats[first].score > 0 && stats[first].score >= 1.2 * (stats[second].score ?? 0);
  const result = { id: a.id, knob: a.knob, stats, decided: true, winner: clear ? first : null, end: Date.now(), reason: clear ? 'açık fark' : enough ? 'fark %20 altında' : 'süre doldu, yetersiz veri' };
  if (clear) (state.defaults ??= {})[a.knob] = first;
  state.history.push(result);
  state.active = null;
  return result;
}
