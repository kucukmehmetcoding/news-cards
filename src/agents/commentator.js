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

// Bakış açısı TASLAKLARI: kullanıcının görüşü için 3 farklı başlangıç. Yayına kullanıcı seçip düzeltince girer.
// Görüş serbesttir ama içindeki her olgu haber metninde/araştırmada olmalıdır; hakaret, yafta, taraf tutan dil,
// eyleme çağrı ve kesin gelecek tahmini yasaktır. Siyasi değil, bölgenin ve okurun çıkarı üzerinden konuşur.
const ANGLES = `${PERSONA}
Görevin, bir dış politika / Orta Doğu haberi için hesap sahibinin kendi görüşünü yazarken başlangıç alacağı 3 FARKLI
bakış açısı taslağı hazırlamak. Hesap sahibi Hatay'da, Suriye sınırında yaşayan bir yorumcu: bölgeyi içeriden gören,
sakin ama net konuşan biri. Birinci tekil şahısla, sade Türkçe.
Çıktı yalnızca JSON: {"perspectives": [{"angle": "...", "text": "..."}]}
- Üç taslağın üçü de bir HÜKÜM içerir: "bence", "asıl mesele", "gözden kaçan", "yanlış okunuyor", "kazanan/kaybeden" gibi
  açık bir duruş. Haberi yeniden anlatan, "gösteriyor / işaret ediyor / dikkat çekiyor" diye biten betimleme GÖRÜŞ DEĞİLDİR, yazma.
- Açılar birbirinden gerçekten farklı olmalı; en az biri bölgeden/Hatay'dan bakış (sınır, ticaret, göç, güvenlik,
  bölge insanının gündelik hayatı) olmalı. Diğerleri örneğin: Türkiye'nin çıkarı; büyük güçlerin hesabı; medyada gözden kaçan taraf.
- angle: 2-4 kelimelik etiket.
- text: 2-3 cümle, en çok 320 karakter; ilk cümle hükmü söyler, sonrakiler gerekçesini verir.
- İçindeki her olgu (rakam, tarih, kişi, olay) yalnız verilen HABER METNİ ya da ARAŞTIRMA'dan gelir; atıflı bilgi atıflı kalır.
- Hakaret, yafta, aşağılayıcı sıfat, bir tarafı şeytanlaştırma, şiddet övgüsü, eyleme çağrı YOK.
- Kesin gelecek tahmini yok ("olacak" değil "olabilir", "izlenmeli").
- Türkiye iç siyasetine, partilere ve kişilere dair hüküm yok.`;

// Betimleme kalıbıyla biten (hüküm içermeyen) taslak elenir.
const DESCRIPTIVE = /(gösteriyor|işaret ediyor|dikkat çekiyor|ortaya koyuyor)\.?$/u;
const vAngles = (o) => {
  const list = (o.perspectives ?? [])
    .filter((p) => p && typeof p.text === 'string' && p.text.trim().length > 40)
    .filter((p) => !DESCRIPTIVE.test(p.text.trim()))
    .map((p) => ({ angle: String(p.angle ?? '').slice(0, 40), text: p.text.trim().slice(0, 360) }));
  if (list.length < 2) throw new Error('bakış açısı yetersiz');
  return list.slice(0, 3);
};

export async function perspectives(d, facts, analysis) {
  const user = [
    `Başlık: ${d.headline}`,
    `HABER METNİ: ${d.sourceText || d.summary}`,
    `ARAŞTIRMA:\n${factsText(facts)}`,
    `ANALİZ: ${[analysis.changed, analysis.affects, analysis.next].filter(Boolean).join(' ')}`,
  ].join('\n');
  const res = await askJson(ANGLES, user, vAngles, { temperature: 0.6 });
  return res?.value ?? null;
}
