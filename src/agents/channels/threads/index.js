// Threads kanal masası (THREADS_ACCESS_TOKEN tanımlıysa etkin). Metin sınırı 500 karakter; hikâye yok.
import { publish } from '../../../lib/threads.js';
import { shortCaption } from '../../../lib/write.js';

export default {
  name: 'threads',
  env: ['THREADS_ACCESS_TOKEN'],
  kinds: ['bulletin', 'goodnews', 'explainer', 'figure', 'dossier', 'commentary'],
  adapter: { text: (post) => shortCaption(post, 500), publish: (urls, text) => publish(urls, text) },
};
