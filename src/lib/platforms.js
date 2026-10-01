import { publish as instagram } from './instagram.js';
import { publish as facebook } from './facebook.js';
import { publish as threads } from './threads.js';
import { caption, shortCaption } from './write.js';

// Bir platform, anahtarları tanımlıysa etkindir. Yayın sırası bu listedeki sıradır.
export const PLATFORMS = [
  { name: 'instagram', env: ['IG_ACCESS_TOKEN'], publish: instagram, text: caption },
  { name: 'facebook', env: ['FB_PAGE_ID', 'FB_PAGE_TOKEN'], publish: facebook, text: caption },
  { name: 'threads', env: ['THREADS_ACCESS_TOKEN'], publish: threads, text: (d) => shortCaption(d, 500) },
];

export const enabled = () => PLATFORMS.filter((p) => p.env.every((k) => process.env[k]));
