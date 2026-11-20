// Facebook Sayfası kanal masası (FB_PAGE_ID + FB_PAGE_TOKEN tanımlıysa etkin). Hikâye gönderilmez.
import { publish } from '../../../lib/facebook.js';
import { caption } from '../../../lib/write.js';

export default {
  name: 'facebook',
  env: ['FB_PAGE_ID', 'FB_PAGE_TOKEN'],
  kinds: ['bulletin', 'goodnews'],
  adapter: { text: (post) => caption(post), publish: (urls, text) => publish(urls, text) },
};
