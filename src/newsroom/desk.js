// Masa defteri: her haberin ve gönderinin yaşam döngüsü — hangi ajan, ne zaman, ne yaptı.
// Günlük tek JSONL dosyası (data/desk/<gün>.jsonl); satır = { at, id, agent, step, ...ayrıntı }.
// Ölçüm ve büyüme ajanları "hangi karar hangi sonucu verdi" sorusunu buradan yanıtlar. 14 günden eskisi silinir.
import { appendFileSync, mkdirSync, readdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { root, trDay } from './context.js';

const DIR = 'data/desk';

export function log(agent, step, id, detail = {}) {
  mkdirSync(root + DIR, { recursive: true });
  const line = JSON.stringify({ at: Date.now(), id, agent, step, ...detail });
  appendFileSync(`${root}${DIR}/${trDay(Date.now())}.jsonl`, line + '\n');
}

export function history(id, days = 14) {
  if (!existsSync(root + DIR)) return [];
  return readdirSync(root + DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .slice(-days)
    .flatMap((f) => readFileSync(`${root}${DIR}/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
    .filter((e) => e.id === id);
}

export function prune(days = 14) {
  if (!existsSync(root + DIR)) return;
  const keep = trDay(Date.now() - days * 86400e3);
  for (const f of readdirSync(root + DIR)) if (f.endsWith('.jsonl') && f.slice(0, 10) < keep) rmSync(`${root}${DIR}/${f}`);
}
