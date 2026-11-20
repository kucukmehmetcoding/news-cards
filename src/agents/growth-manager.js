// Büyüme Müdürü: her kanal masasının büyüme alt ajanlarını sırayla çalıştırır ve tek bir rapor çıkarır.
//   Kanal analisti (ölçüm dosyası) → Zamanlayıcı (en iyi saat dilimi) → Büyüme stratejisti (deneyi değerlendir / yenisini aç)
//   → Topluluk (son 3 günün yorum özeti + yanıt taslakları; GÖNDERMEZ)
// Çıktı: data/growth/<kanal>.json (durum), data/growth/report.md (insan için), GITHUB_STEP_SUMMARY.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { CHANNELS } from './channels/index.js';
import { root, json, settings, loadPosts } from '../newsroom/context.js';
import { log } from '../newsroom/desk.js';
import * as store from './growth/store.js';
import { plan } from './growth/scheduler.js';
import { evaluate, ensureActive, KNOBS } from './growth/experiments.js';
import { digest } from './growth/community.js';
import { send as tgSend, telegramEnabled, escapeHtml } from '../lib/telegram.js';

const pct = (a, b) => (b ? `${Math.round((100 * (a - b)) / b)}%` : '—');

export async function growth({ community = true } = {}) {
  const lines = [`# Büyüme raporu — ${new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'long' })}`];
  for (const c of CHANNELS.filter((c) => c.growth && c.analyst)) {
    const m = existsSync(root + c.analyst.file) ? json(c.analyst.file) : { media: {} };
    const rows = Object.values(m.media ?? {});
    const g = store.load(c.name);
    lines.push('', `## ${c.name}`);

    g.schedule = plan(rows, { activeHours: settings.activeHours });
    const slots = Object.entries(g.schedule.bySlot).sort((a, b) => a[0] - b[0]).map(([s, v]) => `${s}:00 → ${v.reach} (n=${v.n})`);
    lines.push(`**Zamanlayıcı** (${g.schedule.n} olgun gönderi, medyan erişim): ${slots.join(' · ') || 'veri yok'}`);
    lines.push(g.schedule.best.length ? `En iyi dilim: ${g.schedule.best.map((s) => `${s}:00-${s + g.schedule.slot}:00`).join(', ')} — açıklayıcı/rakam/dosya/reels bu dilime bekletilir.` : 'Yeterli veri yok: bekletme yapılmıyor.');

    const r = evaluate(g, m.media ?? {});
    if (r?.decided) {
      lines.push(`**Deney bitti** — ${KNOBS[r.knob].label}: ${Object.entries(r.stats).map(([a, s]) => `${a} ${s.score ?? '—'} (n=${s.n})`).join(' / ')} → ${r.winner ? `kazanan **${r.winner}**, varsayılan yapıldı` : r.reason}`);
      log(`growth:${c.name}`, 'experiment-decided', r.id, r);
    } else if (r) {
      lines.push(`**Süren deney** — ${KNOBS[r.knob].label}: ${Object.entries(r.stats).map(([a, s]) => `${a} ${s.score ?? '—'} (n=${s.n})`).join(' / ')}`);
    }
    ensureActive(g);
    if (!r || r.decided) lines.push(`**Yeni deney**: ${KNOBS[g.active.knob].label} (${g.active.arms.join(' / ')}), türler: ${g.active.kinds.join(', ')}`);
    if (Object.keys(g.defaults).length) lines.push(`Varsayılanlar: ${Object.entries(g.defaults).map(([k, v]) => `${KNOBS[k]?.label ?? k} = ${v}`).join(', ')}`);

    // Hesap düzeyi: takipçi-dışı erişim payı ve takipçi eğrisi (son 7 gün / önceki 7 gün)
    const acc = Object.values(m.account ?? {});
    const share = (xs) => {
      const f = xs.reduce((s, a) => s + (a.reach_follower ?? 0), 0);
      const nf = xs.reduce((s, a) => s + (a.reach_non_follower ?? 0), 0);
      return f + nf ? (100 * nf) / (f + nf) : null;
    };
    const [now, before] = [share(acc.slice(-7)), share(acc.slice(-14, -7))];
    if (now !== null) lines.push(`Takipçi-dışı erişim payı: %${now.toFixed(1)}${before !== null ? ` (önceki hafta %${before.toFixed(1)})` : ''} — hedef %15+ (docs/STYLE.md §8)`);
    const fol = acc.map((a) => a.followers).filter(Boolean);
    if (fol.length > 1) lines.push(`Takipçi: ${fol.at(-8) ?? fol[0]} → ${fol.at(-1)} (${pct(fol.at(-1), fol.at(-8) ?? fol[0])})`);

    if (community && c.community) {
      const recent = loadPosts()
        .filter((p) => p.posted?.[c.name] && Date.now() - p.createdAt < 3 * 86400e3 && p.kind !== 'story')
        .map((p) => ({ id: p.id, cover: p.items[0]?.headline, mediaId: p.posted[c.name] }));
      const d = recent.length ? await digest(recent, c.community.comments) : { comments: 0 };
      g.community = { at: Date.now(), ...d };
      if (d.error) lines.push(`**Topluluk**: yorumlar okunamadı (${d.error}) — izin: instagram_business_manage_comments`);
      else {
        lines.push(`**Topluluk** (${d.comments} yorum): ${d.themes?.join('; ') || 'öne çıkan konu yok'}`);
        for (const x of d.corrections ?? []) lines.push(`- ⚠ Okur düzeltmesi (doğrula): ${x}`);
        // Okurun hataya işaret ettiği yorumlar hemen Mehmet'e: doğruysa /duzelt ile açık düzeltme yayınlanır.
        if (d.corrections?.length && telegramEnabled())
          await tgSend(`⚠️ <b>Okurlar olası bir hataya işaret ediyor</b>\n${d.corrections.map((x) => `• ${escapeHtml(x)}`).join('\n')}\n\nDoğruysa: <code>/duzelt GÖNDERİ-KİMLİĞİ doğrusu</code>`).catch(() => {});
        for (const x of d.replies ?? []) lines.push(`- Yanıt taslağı → "${x.comment.slice(0, 80)}": ${x.reply}`);
      }
    }
    store.save(c.name, g);
  }
  const text = lines.join('\n');
  mkdirSync(`${root}data/growth`, { recursive: true });
  writeFileSync(`${root}data/growth/report.md`, text + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n', { flag: 'a' });
  console.log(text);
}
