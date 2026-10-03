// Ücretsiz dil modeli katmanı: önce Gemini (GEMINI_API_KEY), sonra FreeLLMAPI ağ geçidi
// (FREELLMAPI_URL + FREELLMAPI_API_KEY, OpenAI uyumlu). FreeLLMAPI yerelde çalıştığı için
// yalnızca aynı makineden yapılan çalıştırmalarda erişilebilir; GitHub Actions'ta Gemini kullanılır.
export const PERSONA =
  'Sen kıdemli bir haber analisti ve sosyal medya yöneticisisin: gündemi tartar, neyin ilgi göreceğini bilir, ama doğrulanmamış ya da abartılı tek bir ifade yayınlamazsın.';

// İki sıra: yazım (kart metni) en iyi modelle başlar; toplu işler (çeviri, puanlama) kotası geniş hafif modelle.
const MODELS = {
  write: [process.env.GEMINI_MODEL, 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  bulk: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-flash'],
};
// Kota (429) ya da yoğunluk (503) veren model bu çalıştırmada bir daha denenmez: her çağrıda aynı hatayı
// beklemek hem süre hem kota yakar. Sıra bir sonraki modele, en sonda FreeLLMAPI'ye geçer.
const down = new Set();
export const usage = {};

async function gemini(model, system, user, temperature) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    if ([429, 503].includes(res.status)) down.add(model);
    throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  }
  return (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

async function freellmapi(system, user, temperature) {
  const res = await fetch(`${process.env.FREELLMAPI_URL.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.FREELLMAPI_API_KEY ?? ''}` },
    body: JSON.stringify({
      model: process.env.FREELLMAPI_MODEL || 'auto',
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(Number(process.env.FREELLMAPI_TIMEOUT_SECONDS ?? 120) * 1000),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).choices?.[0]?.message?.content ?? '';
}

export const llmAvailable = () => Boolean(process.env.GEMINI_API_KEY || process.env.FREELLMAPI_URL);

// Modelden JSON ister; `validate` geçersiz çıktıda hata fırlatır ve sıradaki model denenir.
export async function askJson(system, user, validate, { temperature = 0.2, open = '{', close = '}', tier = 'write' } = {}) {
  const models = [...new Set(MODELS[tier].filter(Boolean))].filter((m) => !down.has(m));
  const backends = [
    ...(process.env.GEMINI_API_KEY ? models.map((m) => [m, () => gemini(m, system, user, temperature)]) : []),
    ...(process.env.FREELLMAPI_URL ? [['freellmapi', () => freellmapi(system, user, temperature)]] : []),
  ];
  for (const [name, call] of backends) {
    try {
      const raw = await call();
      usage[name] = (usage[name] ?? 0) + 1;
      const parsed = JSON.parse(raw.slice(raw.indexOf(open), raw.lastIndexOf(close) + 1));
      return { value: validate(parsed), model: name };
    } catch (e) {
      console.warn(`Model başarısız (${name}): ${e.message}`);
    }
  }
  return null;
}
