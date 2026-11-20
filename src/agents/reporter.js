// Muhabir: kaynakları tarar, yabancı başlıkları Türkçeye çevirir, aynı olayı kümeler ve
// daha önce görülmüş ya da yakın zamanda işlenmiş olayları eler. Seçim yapmaz; aday listesi verir.
import { collect, cluster } from '../lib/feeds.js';
import { translateTitles } from '../lib/foreign.js';
import { feeds, settings, state, sameEvent } from '../newsroom/context.js';
import { keepRegional } from './researcher.js';

// kind: 'news' (gündem) | 'goodnews'
export async function gather(kind, maxAgeHours) {
  const sources = feeds.filter((f) => (kind === 'goodnews' ? f.kind === 'goodnews' : f.kind !== 'goodnews'));
  const collected = await collect(sources, maxAgeHours);
  collected.failed.forEach((f) => console.warn(`Kaynak okunamadı: ${f}`));
  // Duruşu belli akışlar (taraf/bölge yayınları) "kim ne diyor" araştırması için ayrıca saklanır.
  if (kind !== 'goodnews') keepRegional(collected.items);
  // Yabancı başlıklar Türkçeye çevrilir; böylece Türk basınındaki aynı olayla aynı kümeye düşer.
  return translateTitles(collected.items, settings.foreign.maxTitles, state.cache.tr);
}

// recent: aynı olayın yeni bağlantıyla geri gelmesine karşı karşılaştırılacak {title, subject} listesi.
export const fresh = (items, recent) =>
  cluster(items, settings.clusterThreshold)
    .filter((c) => !c.links.some((l) => state.seen[l]))
    .filter((c) => !recent.some((r) => sameEvent(r, { title: c.title })));
