import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, due } from '../src/agents/growth/scheduler.js';
import { shape, evaluate, ensureActive, KNOBS } from '../src/agents/growth/experiments.js';
import { value } from '../src/agents/growth/score.js';
import { digest } from '../src/agents/growth/community.js';

const H = 3600e3;
// İstanbul saati h olan, `daysAgo` gün önceki zaman damgası
const at = (h, daysAgo) => { const d = new Date(Date.now() - daysAgo * 86400e3); d.setUTCHours(h - 3, 0, 0, 0); return d.getTime(); };

test('zamanlayıcı: yeterli örnekli en iyi dilim; gündem türü bekletilmez, 5 saatten fazla bekletilmez', () => {
  const rows = [...Array(5)].flatMap((_, i) => [
    { kind: 'bulletin', at: at(19, i + 2), reach: 900 },
    { kind: 'bulletin', at: at(13, i + 2), reach: 300 },
  ]);
  const p = plan(rows);
  assert.deepEqual(p.best, [18]);
  assert.equal(due('bulletin', p, 13, Date.now()), true);
  assert.equal(due('explainer', p, 13, Date.now()), false);
  assert.equal(due('explainer', p, 19, Date.now()), true);
  assert.equal(due('explainer', p, 13, Date.now() - 6 * H), true);
  assert.equal(due('explainer', plan([]), 13, Date.now()), true);
});

test('strateji: kollar dengeli atanır, metne uygulanır; açık farkta kazanan varsayılan olur', () => {
  const g = ensureActive({ defaults: {}, active: null, history: [] });
  assert.equal(g.active.knob, 'cta');
  const text = 'Gündemden 3 başlık\n\n1) x\n\n#a #b #c #d';
  const a = shape(g, { id: 'p1' }, 'bulletin', text);
  const b = shape(g, { id: 'p2' }, 'bulletin', text);
  assert.notEqual(a.experiment.arm, b.experiment.arm);
  assert.match(a.text, new RegExp(KNOBS.cta.arms[a.experiment.arm].slice(0, 10)));
  assert.match(a.text, /#a #b #c #d$/);
  assert.equal(shape(g, { id: 'p3' }, 'story', text).experiment, undefined);

  const media = {};
  for (let i = 0; i < 12; i++) {
    const id = `m${i}`;
    const arm = i % 2 ? 'soru' : 'kaydet';
    g.active.assigned[id] = arm;
    media[id] = { at: Date.now() - 48 * H, reach: 1000, saved: arm === 'kaydet' ? 20 : 5, shares: 2, likes: 10 };
  }
  const r = evaluate(g, media);
  assert.equal(r.winner, 'kaydet');
  assert.equal(g.defaults.cta, 'kaydet');
  assert.equal(g.active, null);
  ensureActive(g);
  assert.equal(g.active.knob, 'tags');
  // varsayılan cta artık her bültende uygulanır, tags deneyi de sürer
  const c = shape(g, { id: 'p9' }, 'bulletin', text);
  assert.match(c.text, /kaydet/);
  assert.equal(c.experiment.knob, 'tags');
});

test('puan: kaydet/paylaş beğeniden ağır; erişimsiz satır puansız', () => {
  assert.ok(value({ reach: 100, saved: 1 }) > value({ reach: 100, likes: 1 }));
  assert.equal(value({ reach: 0 }), null);
});

test('topluluk: izin yoksa hata raporlanır, yanıt gönderilmez', async () => {
  const d = await digest([{ id: 'p', cover: 'c', mediaId: '1' }], async () => { throw new Error('(#10) izin yok'); });
  assert.match(d.error, /izin/);
  assert.deepEqual(await digest([], async () => []), { comments: 0, themes: [], corrections: [], replies: [] });
});
