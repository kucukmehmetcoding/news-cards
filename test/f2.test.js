import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchesPocket, explainerPick, figurePick, bulletinLineup } from '../src/agents/editor.js';
import { timeline, factsText } from '../src/agents/researcher.js';
import { explainerPages, figurePage } from '../src/lib/templates.js';
import { caption } from '../src/lib/write.js';
import { settings } from '../src/newsroom/context.js';

const base = { status: 'approved', interest: 8, sources: ['AA'], bg: 'package.json', sourceText: 'metin', category: 'ekonomi', topic: 'piyasa' };
const d = (id, headline, extra = {}) => ({ ...base, id, headline, originalTitle: headline, ...extra });

test('cebine dokunan: anahtar kelime kelime başında aranır', () => {
  assert.ok(touchesPocket(d('a', 'Motorine 2 lira indirim geldi')));
  assert.ok(touchesPocket(d('a', 'Emekli maaşları belli oldu')));
  assert.ok(!touchesPocket(d('a', 'Galatasaray deplasmanda kazandı')));
});

test('editör: açıklayıcı ve rakam kartı seçimi, açıklayıcısı olan bültene girmez', () => {
  const drafts = [d('a', 'Motorine 2 lira indirim geldi'), d('b', 'Galatasaray 3 golle kazandı'), d('c', 'Kira artışında yeni dönem', { sourceText: '' })];
  assert.equal(explainerPick(drafts).id, 'a');
  assert.equal(figurePick(drafts).id, 'a');
  drafts[0].explainerId = '2026-11-20-xabc';
  assert.equal(figurePick(drafts).id, 'b');
  assert.ok(!bulletinLineup(drafts).some((x) => x.id === 'a'));
  drafts[0].explainerId = 'rejected';
  assert.ok(bulletinLineup(drafts).some((x) => x.id === 'a'));
});

test('araştırmacı: dosya zaman çizelgesi aynı olayı bulur, olgular numaralı', () => {
  const now = d('n', 'Motorine indirim geldi', { createdAt: Date.now() });
  const past = [d('p', 'Motorine indirim bekleniyor', { createdAt: Date.now() - 86400e3, links: ['u'] }), d('q', 'Altın düştü', { createdAt: Date.now() - 3600e3 })];
  const t = timeline(now, past);
  assert.equal(t.length, 1);
  assert.match(t[0].text, /bekleniyor/);
  assert.equal(factsText([{ text: 'x', source: 'TCMB' }]), '[A1] x (TCMB)');
  assert.equal(factsText([]), '(yok)');
});

test('tasarım: boş bölüm slayt olmaz; açıklama soru + çağrı içerir', () => {
  const x = { hook: 'Motorinde indirim ne kadar?', changed: 'Motorine 2 lira indirim geldi.', affects: '', next: 'Yeni fiyat yarın geçerli.', question: 'Fark ettin mi?', summary: 'Özet metni burada.' };
  assert.equal(explainerPages(d('a', 'h'), x, settings, null).length, 3);
  assert.match(figurePage(d('a', 'h'), { value: '2 TL', label: 'indirim' }, 'AA', settings, null), /RAKAMLA/);
  const text = caption({ kind: 'explainer', analysis: x, items: [{ sources: ['AA'], hashtags: ['motorin'] }] });
  assert.match(text, /Fark ettin mi\?/);
  assert.match(text, /kaydet/);
  assert.match(text, /#cebinedokunan/);
});
