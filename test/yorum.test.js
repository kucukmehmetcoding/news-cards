import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentaryRank } from '../src/agents/editor.js';
import { message } from '../src/newsroom/approvals.js';
import { commentaryPages } from '../src/lib/templates.js';
import { caption } from '../src/lib/write.js';
import { settings } from '../src/newsroom/context.js';

const post = {
  id: 'p1', kind: 'commentary',
  items: [{ headline: 'Şam ile Ankara sınır kapısını görüştü', sources: ['AA'], hashtags: ['suriye'], category: 'dunya' }],
  analysis: { hook: 'Hatay ne kazanır?', changed: 'Heyetler görüştü.', affects: '', next: '', summary: 'Özet.', question: 'Açılmalı mı?' },
  perspectives: [{ angle: 'Hatay', text: 'Bence <b>esnaf</b> kazanır.' }],
  opinion: { text: 'Bence esnaf kazanır.', from: 'taslak 1' },
};

test('yorum adayı: Orta Doğu ve Suriye öne, iç gündem aday değil', () => {
  const d = (headline, extra = {}) => ({ headline, originalTitle: headline, interest: 7, category: 'turkiye', topic: 'diger', ...extra });
  assert.ok(commentaryRank(d("Suriye'de yeni hükümet kuruldu")) > commentaryRank(d('Ukrayna ateşkes görüşmesi', { category: 'dunya' })));
  assert.equal(commentaryRank(d('Konya’da trafik kazası')), 0);
});

test('Telegram mesajı HTML kaçışlı; yorum slaytı imzalı ve etiketli; açıklama kişisel değerlendirme der', () => {
  assert.match(message(post), /&lt;b&gt;esnaf/);
  const pages = commentaryPages(post.items[0], post.analysis, post.opinion.text, settings, null, 'Mehmet Küçük · Yorum').join('');
  assert.match(pages, /YORUM/);
  assert.match(pages, /Kişisel değerlendirmedir/);
  const text = caption(post);
  assert.match(text, /Yorum: Bence esnaf kazanır\./);
  assert.match(text, /kişisel değerlendirmesidir/);
});
