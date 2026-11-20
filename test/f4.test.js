import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narration } from '../src/agents/video.js';
import { explainerPages } from '../src/lib/templates.js';
import { caption } from '../src/lib/write.js';
import { settings } from '../src/newsroom/context.js';

const x = { hook: 'Dolar neden yükseliyor?', changed: 'Dolar bugün 50,49 oldu.', affects: '', next: 'Karar perşembe.', question: 'Ne düşünüyorsun?', summary: 'Özet.' };
const d = { category: 'ekonomi', sources: ['AA'], headline: 'h' };

test('reels: anlatım slayt sırasıyla, boş bölüm yok, grafik cümlesi veriden', () => {
  const lines = narration({ analysis: x, charts: [{ name: 'Dolar/TL', first: 49.6, last: 50.49 }] });
  assert.deepEqual(lines, ['Dolar neden yükseliyor?', 'Dolar/TL son 30 günde 49,60 liradan 50,49 liraya yükseldi.', 'Dolar bugün 50,49 oldu.', 'Karar perşembe.']);
  const pages = explainerPages(d, x, settings, null, [{ title: 'T', svg: '<svg/>', source: 'TCMB' }]);
  assert.equal(pages.length, lines.length);
});

test('reels kareleri karusel yönergesi taşımaz; açıklama sentetik sesi belirtir', () => {
  const video = explainerPages(d, x, settings, null, [], { video: true }).join('');
  assert.doesNotMatch(video, /KAYDIR|LAZIM OLUR/);
  assert.match(explainerPages(d, x, settings, null).join(''), /KAYDIR/);
  const text = caption({ kind: 'reel', analysis: x, items: [{ sources: ['AA'], hashtags: [] }] });
  assert.match(text, /Seslendirme yapay zekâ ile üretilmiştir/);
});
