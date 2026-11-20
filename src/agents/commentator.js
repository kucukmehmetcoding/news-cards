// Analist/Yorumcu: haberi "ne değişti / kimi etkiler / sırada ne var" diye açar ve öne çıkan rakamı bulur.
// Yorum = bağlam ve sonuç; görüş, tavsiye ya da tahmin DEĞİL. Yalnız haber metni ve araştırmacının
// numaralı olgularıyla çalışır. Çıktı her zaman Doğrulayıcı'dan geçer.
import { askJson, PERSONA } from '../lib/llm.js';
import { factsText } from './researcher.js';

const SYSTEM = `${PERSONA}
Görevin bir haberi sıradan okur için açıklamak: "Ne değişti, kimi nasıl etkiler, sırada ne var".
Yalnızca verilen HABER METNİ ve numaralı ARAŞTIRMA olgularını kullan. Bilgi ekleme, tahmin etme, tavsiye verme
("şunu alın/satın", "kaçırmayın" yok), görüş bildirme. Bilmediğin alanı boş bırak; boş alan, uydurulmuş alandan iyidir.
Çıktı yalnızca JSON:
{"hook": "...", "changed": "...", "affects": "...", "next": "...", "figure": {"value": "...", "label": "...", "from": "haber|A1"} | null, "question": "...", "summary": "..."}
- hook: kapak cümlesi, en çok 90 karakter, merak uyandırır ama abartısız ve doğru; soru olabilir.
- changed: ne değişti/oldu, 1-2 cümle, en çok 220 karakter, somut (rakam, tarih, kurum).
- affects: bu kimi, nasıl etkiliyor (cebine, işine, gündelik hayatına), en çok 220 karakter. Kaynakta dayanağı yoksa boş dize.
- next: sırada ne var — YALNIZ kaynakta açıkça geçen bir sonraki adım (yürürlük tarihi, toplantı, karar günü); yoksa boş dize.
- figure: haberdeki ya da araştırmadaki en anlamlı tek rakam. value kısa ("6,50 TL", "%3,2", "1.000"), label en çok 80 karakter
  ve rakamın neyi gösterdiğini tam söyler. from: rakamın geldiği yer. Anlamlı rakam yoksa null.
- question: okura sorulacak tek kısa soru (yorum çağrısı), en çok 100 karakter, taraf tutmaz.
- summary: paylaşım açıklaması, 2-4 cümle, en çok 600 karakter, nötr.
Türkçe yaz, emoji ve büyük harfle bağırma yok. Kip: gerçekleşmemiş olay "-acak/-ecek" ile.`;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function validate(o) {
  const out = {
    hook: str(o.hook, 110),
    changed: str(o.changed, 260),
    affects: str(o.affects, 260),
    next: str(o.next, 260),
    question: str(o.question, 120),
    summary: str(o.summary, 700),
    figure:
      o.figure && typeof o.figure.value === 'string' && /\d/.test(o.figure.value) && typeof o.figure.label === 'string'
        ? { value: o.figure.value.trim().slice(0, 16), label: o.figure.label.trim().slice(0, 100), from: str(o.figure.from, 10) || 'haber' }
        : null,
  };
  if (out.hook.length < 10 || out.changed.length < 20 || out.summary.length < 60) throw new Error('eksik açıklayıcı');
  return out;
}

// d: havuzdaki taslak (sourceText dahil); facts: araştırmacı çıktısı.
export async function explain(d, facts) {
  const user = [
    `Bugün: ${new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'full' })}`,
    `Başlık: ${d.headline}`,
    `HABER METNİ: ${d.sourceText || d.summary}`,
    `ARAŞTIRMA:\n${factsText(facts)}`,
  ].join('\n');
  const res = await askJson(SYSTEM, user, validate);
  return res ? { ...res.value, writer: res.model } : null;
}
