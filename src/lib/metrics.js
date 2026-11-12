// Ölçüm (Analist rolü): yayınlanan her Instagram gönderisinin istatistiği ve hesap düzeyinde takipçi / takipçi-dışı erişim.
// Kaynak: IG Graph API insights (izin: instagram_business_manage_insights). Sonuç data/metrics.json'a yazılır.
const BASE = `https://graph.instagram.com${process.env.IG_API_VERSION ? '/' + process.env.IG_API_VERSION : ''}`;

async function get(path, params) {
  const url = new URL(`${BASE}/${path}`);
  url.search = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`${path}: ${JSON.stringify(json.error ?? res.status)}`);
  return json;
}

// Gönderi türüne göre geçerli metrikler (hikâye 24 saat sonra kaybolur; yalnız ilk gün ölçülebilir).
const MEDIA = {
  bulletin: 'views,reach,saved,shares,likes,comments,total_interactions,follows,profile_visits',
  goodnews: 'views,reach,saved,shares,likes,comments,total_interactions,follows,profile_visits',
  reel: 'views,reach,saved,shares,likes,comments,total_interactions,ig_reels_avg_watch_time',
  story: 'views,reach,shares,total_interactions,replies,navigation',
};

async function mediaInsights(id, kind) {
  // Bir metrik desteklenmezse tüm istek düşer; o durumda metrikler tek tek denenir.
  try {
    const { data } = await get(`${id}/insights`, { metric: MEDIA[kind] ?? MEDIA.bulletin });
    return Object.fromEntries(data.map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? null]));
  } catch {
    const out = {};
    for (const metric of (MEDIA[kind] ?? MEDIA.bulletin).split(',')) {
      try {
        const { data } = await get(`${id}/insights`, { metric });
        out[metric] = data[0]?.values?.[0]?.value ?? data[0]?.total_value?.value ?? null;
      } catch {
        out[metric] = null;
      }
    }
    return out;
  }
}

// Son 24 saatte takipçi ve takipçi-dışı erişim: büyümenin asıl göstergesi.
async function accountDay() {
  const user = process.env.IG_USER_ID || 'me';
  const out = {};
  try {
    const { data } = await get(`${user}/insights`, { metric: 'reach', period: 'day', metric_type: 'total_value', breakdown: 'follow_type' });
    for (const r of data[0]?.total_value?.breakdowns?.[0]?.results ?? []) out[`reach_${r.dimension_values[0].toLowerCase()}`] = r.value;
  } catch (e) {
    out.reach_error = e.message.slice(0, 160);
  }
  for (const metric of ['views', 'accounts_engaged', 'total_interactions', 'saves', 'shares', 'follows_and_unfollows']) {
    try {
      const { data } = await get(`${user}/insights`, { metric, period: 'day', metric_type: 'total_value' });
      out[metric] = data[0]?.total_value?.value ?? null;
    } catch {
      out[metric] = null;
    }
  }
  try {
    out.followers = (await get(user, { fields: 'followers_count' })).followers_count;
  } catch {}
  return out;
}

// posts: posts/*.json; previous: önceki metrics.json. Son `days` gündeki gönderiler yenilenir.
export async function collectMetrics(posts, previous = {}, days = 14) {
  const media = { ...(previous.media ?? {}) };
  const since = Date.now() - days * 86400e3;
  for (const p of posts.filter((p) => p.posted?.instagram && p.createdAt > since)) {
    const kind = p.kind ?? 'bulletin';
    // Hikâye 24 saatten sonra ölçülemez; ilk ölçüm saklanır.
    if (kind === 'story' && media[p.id] && Date.now() - p.createdAt > 86400e3) continue;
    try {
      media[p.id] = {
        kind,
        at: p.createdAt,
        igId: p.posted.instagram,
        topics: p.items.map((i) => i.topic),
        cover: p.items[0]?.headline,
        ...(await mediaInsights(p.posted.instagram, kind)),
        measuredAt: Date.now(),
      };
    } catch (e) {
      console.warn(`Ölçülemedi ${p.id}: ${e.message}`);
    }
  }
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  const account = { ...(previous.account ?? {}), [day]: await accountDay() };
  return { updatedAt: Date.now(), account, media };
}

// Haftalık özet: tür başına ortalama erişim, kaydetme, paylaşım; takipçi-dışı erişim payı.
export function summary(m, days = 7) {
  const since = Date.now() - days * 86400e3;
  const rows = Object.values(m.media).filter((r) => r.at > since);
  const by = {};
  for (const r of rows) {
    const k = (by[r.kind] ??= { n: 0, reach: 0, saved: 0, shares: 0, interactions: 0 });
    k.n++;
    k.reach += r.reach ?? 0;
    k.saved += r.saved ?? 0;
    k.shares += r.shares ?? 0;
    k.interactions += r.total_interactions ?? 0;
  }
  const lines = [`## Son ${days} gün`, '', '| Tür | Adet | Ort. erişim | Kaydetme | Paylaşım | Etkileşim/gönderi |', '|---|---|---|---|---|---|'];
  for (const [k, v] of Object.entries(by))
    lines.push(`| ${k} | ${v.n} | ${Math.round(v.reach / v.n)} | ${v.saved} | ${v.shares} | ${(v.interactions / v.n).toFixed(1)} |`);
  const acc = Object.entries(m.account).slice(-days).map(([, a]) => a);
  const f = acc.reduce((s, a) => s + (a.reach_follower ?? 0), 0);
  const nf = acc.reduce((s, a) => s + (a.reach_non_follower ?? 0), 0);
  if (f + nf) lines.push('', `Takipçi-dışı erişim payı: %${((100 * nf) / (f + nf)).toFixed(1)} (hedef %10+)`);
  const fol = acc.map((a) => a.followers).filter(Boolean);
  if (fol.length > 1) lines.push(`Takipçi: ${fol[0]} → ${fol.at(-1)} (${fol.at(-1) - fol[0] >= 0 ? '+' : ''}${fol.at(-1) - fol[0]})`);
  return lines.join('\n');
}
