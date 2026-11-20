// Instagram kanal masası. Alt ajanlar: adapter (biçim + gönderim) ve analyst (insights).
// Zamanlayıcı, büyüme stratejisti ve topluluk alt ajanları F5'te bu masaya eklenir.
import { publish, publishStory, publishReel } from '../../../lib/instagram.js';
import { collectMetrics, summary } from '../../../lib/metrics.js';
import { caption } from '../../../lib/write.js';

export default {
  name: 'instagram',
  env: ['IG_ACCESS_TOKEN'],
  kinds: ['bulletin', 'goodnews', 'story', 'explainer', 'figure', 'dossier', 'reel'],
  adapter: {
    text: (post, kind) => (kind === 'story' ? '' : caption(post)),
    publish: (urls, text, kind) => (kind === 'story' ? publishStory(urls, text) : kind === 'reel' ? publishReel(urls[0], text) : publish(urls, text)),
  },
  analyst: { collect: collectMetrics, summary },
};
