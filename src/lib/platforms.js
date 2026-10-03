import { publish as instagram, publishStory as instagramStory } from './instagram.js';
import { publish as facebook } from './facebook.js';
import { publish as threads } from './threads.js';
import { caption, shortCaption } from './write.js';

// Bir platform, anahtarları tanımlıysa etkindir. Yayın sırası bu listedeki sıradır.
// `story` tanımlı olmayan platforma hikâye gönderilmez.
export const PLATFORMS = [
  { name: 'instagram', env: ['IG_ACCESS_TOKEN'], publish: instagram, story: instagramStory, text: caption },
  { name: 'facebook', env: ['FB_PAGE_ID', 'FB_PAGE_TOKEN'], publish: facebook, text: caption },
  { name: 'threads', env: ['THREADS_ACCESS_TOKEN'], publish: threads, text: (d) => shortCaption(d, 500) },
];

export const enabled = (kind = 'bulletin') =>
  PLATFORMS.filter((p) => p.env.every((k) => process.env[k]) && (kind !== 'story' || p.story)).map((p) =>
    kind === 'story' ? { ...p, publish: p.story, text: () => '' } : p
  );
