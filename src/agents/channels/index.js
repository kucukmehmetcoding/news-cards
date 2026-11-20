// Kanal masaları. Her kanal kendi klasöründe, aynı sözleşmeyle:
//   name, env (gerekli anahtarlar), kinds (kabul ettiği gönderi türleri),
//   adapter { text(post, kind), publish(urls, text, kind) }   — biçim + gönderim
//   analyst? { collect, summary }                             — kanal ölçümü
// F5'te eklenecek alt ajanlar: scheduler, growth, community. Yayın sırası bu listedeki sıradır.
import instagram from './instagram/index.js';
import facebook from './facebook/index.js';
import threads from './threads/index.js';

export const CHANNELS = [instagram, facebook, threads];

export const enabled = (kind = 'bulletin') => CHANNELS.filter((c) => c.env.every((k) => process.env[k]) && c.kinds.includes(kind));
