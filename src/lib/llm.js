// Dil modeli katmanı: önce Claude (ANTHROPIC_API_KEY; ucuz model, varsayılan Haiku 5.5), yanıt vermezse
// Gemini ücretsiz katman (GEMINI_API_KEY). Kullanıcı kararı 2026-11-20: FreeLLMAPI kaldırıldı.
import Anthropic from '@anthropic-ai/sdk';

export const PERSONA =
  'Sen kıdemli bir haber analisti ve sosyal medya yöneticisisin: gündemi tartar, neyin ilgi göreceğini bilir, ama doğrulanmamış ya da abartılı tek bir ifade yayınlamazsın.';

// Model adları tahmin edilmez: hesabın erişebildiği modeller çalıştırma başında API'den listelenir
// (eski modeller yeni hesaplara kapatılabiliyor). İki sıra kurulur: yazım (kart metni) en yeni "flash" ile başlar,
// toplu işler (çeviri, puanlama) kotası geniş "flash-lite" ile.
const FALLBACK = ['gemini-3.5-flash', 'gemini-2.5-flash'];
let models = null;

const version = (m) => Number(m.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
const stable = (m) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(m);

async function geminiModels() {
  if (models) return models;
  let names = FALLBACK;
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(20000),
    });
    const list = (await res.json()).models ?? [];
    const usable = list
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter(stable);
    if (usable.length) names = usable;
  } catch (e) {
    console.warn(`Gemini model listesi alınamadı: ${e.message}`);
  }
  const byVersion = (a, b) => version(b) - version(a);
  const flash = names.filter((m) => !m.endsWith('-lite')).sort(byVersion);
  const lite = names.filter((m) => m.endsWith('-lite')).sort(byVersion);
  models = { write: [process.env.GEMINI_MODEL, ...flash, ...lite], bulk: [...lite, ...flash] };
  console.log(`Gemini modelleri — yazım: ${models.write.filter(Boolean).join(', ')} | toplu: ${models.bulk.join(', ')}`);
  return models;
}
// Kota (429), yoğunluk (503) ya da erişim (404) hatası veren model bu çalıştırmada bir daha denenmez: her çağrıda aynı hatayı
// beklemek hem süre hem kota yakar. Sıra bir sonraki modele, en sonda FreeLLMAPI'ye geçer.
const down = new Set();
export const usage = {};

// `image`: data URL (base64). Görüntü verilirse istek çok modlu olur; flash modelleri görüntü kabul eder.
const splitDataUrl = (u) => {
  const m = u.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) throw new Error('görüntü data URL değil');
  return { mime: m[1], data: m[2] };
};

async function gemini(model, system, user, temperature, image) {
  const parts = [{ text: user }];
  if (image) {
    const { mime, data } = splitDataUrl(image);
    parts.push({ inline_data: { mime_type: mime, data } });
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    if ([404, 429, 503].includes(res.status)) down.add(model);
    throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  }
  return (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

// Claude: JSON görevleri kısa ve kurallı; düşünme derinliği `low` yeterli (Haiku 5.5'te sıcaklık parametresi gönderilmez).
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
let anthropic = null;
async function claude(system, user, image) {
  anthropic ??= new Anthropic({ timeout: 120000, maxRetries: 2 });
  const content = image
    ? [{ type: 'image', source: { type: 'base64', media_type: splitDataUrl(image).mime, data: splitDataUrl(image).data } }, { type: 'text', text: user }]
    : user;
  const res = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    output_config: { effort: process.env.CLAUDE_EFFORT || 'low' },
    system,
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason === 'refusal') throw new Error(`reddetti (${res.stop_details?.category ?? '?'})`);
  if (res.stop_reason === 'max_tokens') throw new Error('çıktı sınırı aşıldı');
  usage.tokens = (usage.tokens ?? 0) + res.usage.input_tokens + res.usage.output_tokens;
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export const llmAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);

// Modelden JSON ister; `validate` geçersiz çıktıda hata fırlatır ve sıradaki model denenir.
export async function askJson(system, user, validate, { temperature = 0.2, open = '{', close = '}', tier = 'write', image } = {}) {
  const order = process.env.GEMINI_API_KEY ? (await geminiModels())[tier] : [];
  const backends = [
    ...(process.env.ANTHROPIC_API_KEY && !down.has('claude') ? [[CLAUDE_MODEL, () => claude(system, user, image)]] : []),
    ...[...new Set(order.filter(Boolean))].filter((m) => !down.has(m)).map((m) => [m, () => gemini(m, system, user, temperature, image)]),
  ];
  for (const [name, call] of backends) {
    try {
      const raw = await call();
      usage[name] = (usage[name] ?? 0) + 1;
      const parsed = JSON.parse(raw.slice(raw.indexOf(open), raw.lastIndexOf(close) + 1));
      return { value: validate(parsed), model: name };
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.NotFoundError) down.add('claude');
      console.warn(`Model başarısız (${name}): ${e.message}`);
    }
  }
  return null;
}

// Görüntü denetimi: fotoğraf + soru → JSON. Toplu-iş kademesi (hafif model) yeterli.
export const askVision = (system, user, image, validate) => askJson(system, user, validate, { temperature: 0, tier: 'bulk', image });
