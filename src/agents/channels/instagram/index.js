// Instagram kanal masası. Alt ajanlar: adapter (biçim + gönderim), analyst (insights), growth (zamanlayıcı +
// büyüme stratejisti, durum: data/growth/instagram.json) ve community (yorum özeti + yanıt taslağı; göndermez).
import { publish, publishStory, publishReel, comments } from '../../../lib/instagram.js';
import { collectMetrics, summary } from '../../../lib/metrics.js';
import { caption } from '../../../lib/write.js';

export default {
  name: 'instagram',
  env: ['IG_ACCESS_TOKEN'],
  kinds: ['bulletin', 'goodnews', 'story', 'explainer', 'figure', 'dossier', 'commentary', 'reel'],
  adapter: {
    text: (post, kind) => (kind === 'story' ? '' : caption(post)),
    publish: (urls, text, kind) => (kind === 'story' ? publishStory(urls, text) : kind === 'reel' ? publishReel(urls[0], text) : publish(urls, text)),
  },
  analyst: { collect: collectMetrics, summary, file: 'data/metrics.json' },
  growth: { experiments: true, schedule: true },
  community: { comments },
};
