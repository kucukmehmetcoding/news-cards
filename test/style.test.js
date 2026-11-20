import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hardChecks } from '../src/lib/verify.js';
import { admits, bulletinLineup } from '../src/agents/editor.js';
import { caption } from '../src/lib/write.js';
import { settings } from '../src/newsroom/context.js';

const card = (text) => ({ headline: text, brief: '', summary: 'Türkçe karakterli uzunca bir özet metni burada yer alıyor, şöyle ki.' });

test('yasak kelimeler Türkçe harfle başlasa da yakalanır; kelime içinde yakalanmaz', () => {
  assert.ok(hardChecks(card('Şok gelişme yaşandı'), {}).some((p) => /abartı/.test(p.text)));
  assert.ok(hardChecks(card('Son dakika: toplantı başladı'), {}).some((p) => /abartı/.test(p.text)));
  assert.ok(!hardChecks(card('Şokladı değil, şoklama işlemi yapıldı'), {}).some((p) => /abartı/.test(p.text)));
});

test('kriz/savaş havuzun ve bültenin en çok yarısı', () => {
  const half = Math.floor(settings.mix.crisisMax * settings.pool.max);
  const taken = Array.from({ length: half }, (_, i) => ({ topic: i % 2 ? 'savas' : 'kriz', title: `x${i}`, originalTitle: `olay ${i} farklı ${i}` }));
  assert.equal(admits({ topic: 'savas', title: 'yepyeni bir başlık' }, taken), false);
  assert.equal(admits({ topic: 'piyasa', title: 'yepyeni bir başlık' }, taken), true);
  const mk = (id, topic, interest) => ({ id, topic, interest, status: 'approved', sources: ['a'], bg: 'package.json', originalTitle: `${id} benzersiz ${id}${id}` });
  const lineup = bulletinLineup([mk('a', 'savas', 10), mk('b', 'kriz', 9), mk('c', 'savas', 9), mk('d', 'piyasa', 5), mk('e', 'spor', 5)]);
  assert.ok(lineup.filter((s) => ['savas', 'kriz'].includes(s.topic)).length <= Math.floor(settings.bulletin.stories * settings.mix.crisisMax));
});

test('açıklama: kanca ilk satır, en çok 5 niş etiket, genel etiket yok; düzeltme açık', () => {
  const post = { kind: 'commentary', items: [{ headline: "İran'dan uyarı", sources: ['IRNA'], hashtags: ['iran', 'hürmüz'] }], analysis: { hook: 'İran ne demek istiyor?', summary: 'Özet.', question: 'Ne düşünüyorsun?' }, opinion: { text: 'Bence…' } };
  const text = caption(post);
  assert.ok(text.startsWith('İran ne demek istiyor?'));
  const tags = text.match(/#\S+/g);
  assert.ok(tags.length <= 5);
  assert.ok(tags.includes('#hatay') && tags.includes('#iran'));
  assert.ok(!tags.includes('#haber') && !tags.includes('#gündem'));
  const fix = caption({ kind: 'correction', correction: 'Doğrusu şu.', items: [{ headline: 'Yanlış başlık' }] });
  assert.match(fix, /^DÜZELTME: Daha önce "Yanlış başlık"/);
});
