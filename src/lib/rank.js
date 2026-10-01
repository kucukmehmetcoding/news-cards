// Haber adaylarına 0-10 arası "ilgi puanı" verir. Hedef: savaş/çatışma, kriz/afet,
// piyasa/borsa ve spor gibi yüksek ilgi gören başlıklar. Puan yalnızca SEÇİMİ etkiler;
// kart metni yine kaynaktaki bilgiyle, abartısız yazılır.
const norm = (s) => s.toLocaleLowerCase('tr-TR');

// Anahtar kelime kelime BAŞINDA aranır ("zam" → "zammı" tutar, "zaman" için "zam$" yazılır);
// sonu "$" olan kelime yalnızca tam eşleşir.
const matches = (padded, w) => (w.endsWith('$') ? padded.includes(` ${w.slice(0, -1)} `) : padded.includes(` ${w}`));

function keywordScore(title, topics) {
  const padded = ` ${norm(title).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()} `;
  let best = null;
  let hits = 0;
  for (const [topic, { weight, words }] of Object.entries(topics)) {
    const n = words.filter((w) => matches(padded, w)).length;
    if (!n) continue;
    hits += n;
    if (!best || weight > best.weight) best = { topic, weight };
  }
  if (!best) return { interest: 2, topic: 'diger' };
  return { interest: Math.min(10, best.weight + Math.min(2, (hits - 1) * 0.5)), topic: best.topic };
}

const SYSTEM = `Türkiye'deki bir haber hesabının editörüsün. Her başlığa, geniş kitlenin ilgisini ne kadar çekeceğine göre 0-10 puan ver.
Yüksek puan (8-10): savaş, saldırı, askeri gerilim; büyük kaza, afet, can kaybı; siyasi/ekonomik kriz; borsa, döviz, altın, faiz, zam gibi cebe dokunan piyasa haberleri; büyük kulüpler, milli takım, derbi, transfer, ceza gibi spor gündemi.
Orta (5-7): önemli ama acil olmayan gelişmeler, resmî kararlar.
Düşük (0-4): kutlama/anma mesajı, tören, rutin ziyaret, tanıtım, yaşam/magazin dolgu haberleri.
topic değerleri: savas, kriz, piyasa, spor, diger.
category değerleri (kartın üstündeki etiket): turkiye (Türkiye içi gündem), dunya (yurt dışı), ekonomi, spor.
Çıktı yalnızca JSON dizi: [{"i": 0, "score": 8, "topic": "piyasa", "category": "ekonomi"}, ...] — her başlık için bir öğe.`;

const MODELS = [process.env.GEMINI_MODEL, 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].filter(Boolean);

async function geminiScores(titles) {
  for (const model of MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: titles.map((t, i) => `${i}. ${t}`).join('\n') }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`${model} ${res.status}`);
      const raw = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
      const out = new Map();
      for (const r of arr)
        if (Number.isInteger(r.i) && typeof r.score === 'number') out.set(r.i, { interest: Math.max(0, Math.min(10, r.score)), topic: String(r.topic ?? 'diger'), category: r.category });
      if (out.size < titles.length / 2) throw new Error(`${model} eksik puan`);
      return out;
    } catch (e) {
      console.warn(`Puanlama başarısız: ${e.message}`);
    }
  }
  return null;
}

export async function rank(candidates, settings) {
  const { topics, llmShortlist } = settings.interest;
  for (const c of candidates) {
    Object.assign(c, keywordScore(c.title, topics));
    if (c.topic === 'spor') c.category = 'spor';
    if (c.topic === 'piyasa') c.category = 'ekonomi';
  }
  if (process.env.GEMINI_API_KEY && candidates.length) {
    // Tüm adayları göndermek yerine ön puanı en yüksek olanlar editöre sorulur.
    const shortlist = [...candidates].sort((a, b) => b.interest + b.sources.length - (a.interest + a.sources.length)).slice(0, llmShortlist);
    const scores = await geminiScores(shortlist.map((c) => c.title));
    if (scores)
      shortlist.forEach((c, i) => {
        if (!scores.has(i)) return;
        const { category, ...s } = scores.get(i);
        Object.assign(c, s, { scoredBy: 'gemini' });
        if (settings.categories[category]) c.category = category; // etiket haberin içeriğine göre düzeltilir
      });
  }
  return candidates;
}
