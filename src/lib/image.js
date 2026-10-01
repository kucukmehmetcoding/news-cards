// Kart arka planı: Pollinations'ın ücretsiz, anahtarsız görsel uç noktası.
// Gemini API'de görsel üretimi ücretli olduğu için metin Gemini'den, görsel buradan gelir.
const STYLE = 'cinematic editorial photograph, moody lighting, shallow depth of field, no people, no faces, no text, no letters, no logos, no watermark';

const CATEGORY_PROMPTS = {
  turkiye: 'aerial view of a Turkish city skyline at dusk',
  dunya: 'earth globe and world map on a dark desk',
  ekonomi: 'stock market charts glowing on dark screens, coins on a table',
  spor: 'empty football stadium under floodlights at night',
};

export async function background(draft, settings) {
  if (!settings.image.enabled) return null;
  const prompt = `${draft.imagePrompt || CATEGORY_PROMPTS[draft.category]}, ${STYLE}`;
  const seed = parseInt(draft.id.slice(-8), 16) % 1e6;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1350&nologo=true&seed=${seed}`;
  for (let attempt = 1; attempt <= settings.image.retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(settings.image.timeoutSeconds * 1000) });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.startsWith('image/')) throw new Error(`${res.status} ${type}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 20000) throw new Error('görsel çok küçük');
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch (e) {
      console.warn(`Görsel üretilemedi (deneme ${attempt}): ${e.message}`);
      // Anahtarsız kullanım kotası dar: art arda isteklerde 402 dönüyor, bekleyince açılıyor.
      if (attempt < settings.image.retries) await new Promise((r) => setTimeout(r, settings.image.backoffSeconds * 1000));
    }
  }
  return null; // kart düz renk geçişli arka planla çizilir
}
