import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admits, bulletinLineup, storyPick, goodLineup } from '../src/agents/editor.js';
import { enabled, CHANNELS } from '../src/agents/channels/index.js';
import { sameEvent, settings } from '../src/newsroom/context.js';

const d = (id, topic, interest, extra = {}) => ({ id, topic, interest, status: 'approved', sources: ['a'], originalTitle: { a: 'Galatasaray deplasmanda kazandı', b: 'Altın fiyatları sert düştü', c: 'Zincirleme kazada yaralılar var', d: 'Ateşkes görüşmesi başladı', e: 'Yeni gezegen keşfedildi', g: 'Balina nüfusu arttı' }[id] ?? id, ...extra });
// hasImage dosya ister; testte görsel kontrolünü atlatmak için var olan bir dosya kullanılır
const img = { bg: 'package.json' };

test('aynı olay: ortak kelime oranı ya da özne', () => {
  assert.ok(sameEvent({ title: 'Merkez Bankası faizi sabit tuttu' }, { title: 'Merkez Bankası faizi yüzde 40 sabit tuttu' }));
  assert.ok(!sameEvent({ title: 'Galatasaray kazandı' }, { title: 'Altın fiyatı düştü' }));
  assert.ok(sameEvent({ title: 'x', subject: 'Merz' }, { title: 'y', subject: 'Merz' }));
});

test('editör: konu sınırı ve yabancı basın payı', () => {
  const max = settings.bulletin.maxPerTopic;
  const taken = Array.from({ length: max }, (_, i) => d(`s${i}`, 'savas', 5));
  assert.equal(admits({ topic: 'savas', title: 'yepyeni konu' }, taken), false);
  assert.equal(admits({ topic: 'spor', title: 'yepyeni konu' }, taken), true);
  const foreign = Array.from({ length: settings.foreign.maxPerBulletin }, (_, i) => d(`f${i}`, `t${i}`, 5, { foreign: true }));
  assert.equal(admits({ topic: 'spor', foreign: true, title: 'başka' }, foreign), false);
});

test('editör: bülten dizilimi güçlüden zayıfa, onaysız ve görselsiz yok', () => {
  const drafts = [
    d('a', 'spor', 5, img), d('b', 'piyasa', 9, img), d('c', 'kriz', 7, img),
    d('d', 'savas', 10, { status: 'pending', ...img }), d('e', 'merak', 8), d('g', 'iyi', 10, { kind: 'goodnews', ...img }),
  ];
  assert.deepEqual(bulletinLineup(drafts).map((x) => x.id), ['b', 'c', 'a']);
  assert.equal(storyPick(drafts, []).id, 'b');
  assert.equal(storyPick([{ ...drafts[1], storyId: 'x' }, drafts[2]], []).id, 'c');
  assert.deepEqual(goodLineup(drafts).map((x) => x.id), ['g']);
});

test('kanal masaları: anahtarı olmayan kanal kapalı, hikâye yalnız destekleyene', () => {
  for (const c of CHANNELS) for (const k of c.env) delete process.env[k];
  assert.equal(enabled('bulletin').length, 0);
  process.env.IG_ACCESS_TOKEN = 'x';
  process.env.THREADS_ACCESS_TOKEN = 'x';
  assert.deepEqual(enabled('bulletin').map((c) => c.name), ['instagram', 'threads']);
  assert.deepEqual(enabled('story').map((c) => c.name), ['instagram']);
  for (const c of CHANNELS) assert.equal(typeof c.adapter.publish, 'function');
});
