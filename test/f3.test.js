import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCountry, locatorSvg } from '../src/lib/geo.js';
import { lineChartSvg } from '../src/lib/chart.js';
import { dossierPick } from '../src/agents/editor.js';
import { timeline } from '../src/agents/researcher.js';
import { caption } from '../src/lib/write.js';

test('harita: ülke tam kelimeyle bulunur, Türkiye/uydurma yok', () => {
  assert.equal(detectCountry("Fas'ta deprem"), 'Morocco');
  assert.equal(detectCountry('Fasulye fiyatı arttı'), null);
  assert.equal(detectCountry('Ankara’da toplantı'), null);
  assert.match(locatorSvg('Iran'), /^<svg/);
  assert.equal(locatorSvg('Atlantis'), '');
});

test('grafik: en az iki nokta, son değer işaretli', () => {
  assert.equal(lineChartSvg([{ date: '2026-11-20', value: 1 }]), '');
  const svg = lineChartSvg([{ date: '2026-11-19', value: 50.1 }, { date: '2026-11-20', value: 50.5 }]);
  assert.match(svg, /polyline/);
  assert.match(svg, /20\.11/);
});

test('dosya: en az iki geçmiş gelişmesi olan haber seçilir; açıklama tarihli', () => {
  const day = 86400e3;
  const mk = (id, headline, ago, extra = {}) => ({ id, headline, originalTitle: headline, createdAt: Date.now() - ago, status: 'used', sources: ['AA'], interest: 8, bg: 'package.json', ...extra });
  const drafts = [
    mk('a', 'Hürmüz Boğazı gemi trafiği denetlenecek', 6 * day),
    mk('b', 'Hürmüz Boğazı gemi trafiği durduruldu', 3 * day),
    mk('c', 'Hürmüz Boğazı gemi trafiği yeniden açıldı', 0, { status: 'approved' }),
    mk('e', 'Altın fiyatı düştü', 0, { status: 'approved' }),
  ];
  const pick = dossierPick(drafts, timeline);
  assert.equal(pick.d.id, 'c');
  assert.equal(pick.past.length, 2);
  const entries = [...pick.past, { day: '2026-11-20', headline: pick.d.headline, source: 'AA' }];
  const text = caption({ kind: 'dossier', entries, items: [{ headline: pick.d.headline, hashtags: [] }] });
  assert.match(text, /^Dosya: /);
  assert.match(text, /#dosya/);
});
