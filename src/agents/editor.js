// Gündem editörü: adayları puanlar, konu karmasını korur, hangi haberin havuza / bültene / hikâyeye
// gireceğine karar verir. Metin yazmaz, görsel bulmaz — yalnız seçer.
import { rank } from '../lib/rank.js';
import { scoreGood } from '../lib/foreign.js';
import { settings, state, MODE, sameEvent, ev, isGood, hasImage } from '../newsroom/context.js';
import { detectCountry } from '../lib/geo.js';

// Otomatik modda tek kaynaklı haber girmez; yalnız yabancı basında geçen haber güvenilir kuruluştansa girebilir.
// Taraf yayın organları (devlet ajansı, örgüt medyası) kaynak sayısına KATILMAZ: olay ancak taraf olmayan
// kaynaklarla doğrulanır; taraf yayınları yalnız "kim ne diyor" için kullanılır.
const independent = (c) => c.sources.filter((s) => !(c.partySources ?? []).includes(s));
const trustworthy = (c) =>
  MODE === 'manual' || independent(c).length >= settings.minSourcesForAuto || (c.foreign && independent(c).some((s) => settings.foreign.trusted.includes(s)));

// İlgi puanı belirleyici; çok kaynaklı ve o gün az işlenmiş konular öne gelir.
export async function candidates(fresh, usedToday) {
  const score = (c) => c.interest * 10 + c.sources.length * 4 - (usedToday[c.topic] ?? 0) * 6;
  return (await rank(fresh.filter(trustworthy), settings, state.cache.rank))
    // Ana konular dışındaki haberler ancak çok yüksek puanla girer.
    .filter((c) => c.interest >= (c.topic === 'diger' ? settings.interest.minInterestOther : settings.interest.minInterest))
    .sort((a, b) => score(b) - score(a) || b.date - a.date);
}

export async function goodCandidates(fresh) {
  return (await scoreGood(fresh, state.cache.good)).filter((c) => c.interest >= settings.goodnews.minScore).sort((a, b) => b.interest - a.interest);
}

// Havuza alınabilir mi? (konu yığılması, yabancı basın payı, aynı olay)
// Kriz/savaş payı (docs/STYLE.md §5): havuzun ve bültenin en çok yarısı.
const crisis = (x) => settings.mix.crisisTopics.includes(x.topic);
const crisisFull = (list, size) => list.filter(crisis).length + 1 > Math.max(1, Math.floor(settings.mix.crisisMax * size));

export function admits(c, taken) {
  if (crisis(c) && crisisFull(taken, settings.pool.max)) return false;
  if (taken.filter((p) => p.topic === c.topic).length >= settings.bulletin.maxPerTopic) return false;
  if (c.foreign && taken.filter((p) => p.foreign).length >= settings.foreign.maxPerBulletin) return false;
  return !taken.some((p) => sameEvent(ev(p), { title: c.title }));
}

const strongest = (x, y) => y.interest - x.interest || y.sources.length - x.sources.length;

// Bülten: onaylı, görselli en güçlü haberler; konu ve yabancı basın sınırlı, aynı olay iki kez yok.
export function bulletinLineup(drafts) {
  const b = settings.bulletin;
  const stories = [];
  // Açıklayıcısı yayına hazırlanan haber bültende tekrar edilmez.
  for (const d of drafts.filter((d) => d.status === 'approved' && !isGood(d) && hasImage(d) && !/-x/.test(d.explainerId ?? '')).sort(strongest)) {
    if (stories.length === b.stories) break;
    if (stories.filter((s) => s.topic === d.topic).length >= b.maxPerTopic) continue;
    if (crisis(d) && crisisFull(stories, b.stories)) continue;
    if (d.foreign && stories.filter((s) => s.foreign).length >= settings.foreign.maxPerBulletin) continue;
    if (stories.some((s) => sameEvent(ev(s), ev(d)))) continue;
    stories.push(d);
  }
  return stories;
}

// Hikâye: daha önce hikâye olmamış, bugünkü hikâyelerle aynı olay olmayan en güçlü haber.
export const storyPick = (drafts, todayStories) =>
  drafts
    .filter((d) => d.status === 'approved' && !isGood(d) && !d.storyId && hasImage(d))
    .filter((d) => !todayStories.some((p) => sameEvent(ev(p.items[0]), ev(d))))
    .sort(strongest)[0];

export function goodLineup(drafts) {
  const stories = [];
  for (const d of drafts.filter((d) => d.status === 'approved' && isGood(d) && hasImage(d)).sort((x, y) => y.interest - x.interest)) {
    if (stories.length === settings.goodnews.stories) break;
    if (!stories.some((s) => sameEvent(ev(s), ev(d)))) stories.push(d);
  }
  return stories;
}

// "Cebine dokunan": okurun parasına/gündelik hayatına dokunan, kaynak metni saklı, onaylı haber.
const norm = (s) => ` ${s.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
export const touchesPocket = (d) => settings.explainer.keywords.some((k) => norm(`${d.headline} ${d.originalTitle}`).includes(` ${k}`));

export const explainerPick = (drafts) =>
  drafts
    .filter((d) => d.status === 'approved' && !isGood(d) && hasImage(d) && d.sourceText && !d.explainerId)
    .filter((d) => d.interest >= settings.explainer.minInterest && touchesPocket(d))
    .sort(strongest)[0];

// "Dosya": aynı olayın son günlerde en az iki önceki gelişmesi olan güçlü haber.
export const dossierPick = (drafts, timelineOf) =>
  drafts
    .filter((d) => d.status === 'approved' && !isGood(d) && hasImage(d) && !d.dossierId && d.interest >= settings.dossier.minInterest)
    .map((d) => ({ d, past: timelineOf(d, drafts) }))
    .filter((x) => x.past.length >= settings.dossier.minPast)
    .sort((a, b) => b.past.length - a.past.length || strongest(a.d, b.d))[0];

// Yorum adayları: dış politika ve Orta Doğu. Orta Doğu ülkesi geçen haber öne alınır (Hatay'dan bakışın en güçlü olduğu alan).
const MIDEAST = new Set(['Iran', 'Iraq', 'Syria', 'Israel', 'Palestine', 'Lebanon', 'Jordan', 'Egypt', 'Saudi Arabia', 'Yemen', 'Qatar', 'United Arab Emirates', 'Libya']);
export function commentaryRank(d) {
  const text = `${d.headline} ${d.originalTitle}`;
  const country = detectCountry(text);
  const kw = norm(text);
  const foreign = ['dunya', 'dunyabasini'].includes(d.category) || d.topic === 'savas' || settings.commentary.keywords.some((k) => kw.includes(` ${k}`));
  if (!foreign) return 0;
  return d.interest + (MIDEAST.has(country) ? 3 : 0) + (country === 'Syria' ? 2 : 0);
}
export const commentaryPicks = (drafts, n) =>
  drafts
    .filter((d) => d.status === 'approved' && !isGood(d) && hasImage(d) && d.sourceText && !d.commentaryId)
    .map((d) => ({ d, score: commentaryRank(d) }))
    .filter((x) => x.score >= settings.commentary.minScore)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.d)
    .reduce((acc, d) => (acc.length < n && !acc.some((a) => sameEvent(ev(a), ev(d))) ? [...acc, d] : acc), []);

// "Rakamla": metninde rakam geçen, daha önce rakam kartı olmamış en güçlü haber (rakamı Yorumcu seçer).
export const figurePick = (drafts) =>
  drafts
    .filter((d) => d.status === 'approved' && !isGood(d) && hasImage(d) && d.sourceText && !d.figureId && !d.explainerId)
    .filter((d) => d.interest >= settings.figure.minInterest && /\d/.test(`${d.headline} ${(d.details ?? []).join(' ')}`))
    .sort(strongest)[0];
