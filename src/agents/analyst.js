// Ölçüm analisti: analyst alt ajanı olan her etkin kanal masasından istatistik toplar.
// Şimdilik yalnız Instagram ölçülür; sonuç data/metrics.json'a (Instagram) yazılır.
import { writeFileSync, existsSync } from 'node:fs';
import { CHANNELS } from './channels/index.js';
import { root, json, loadPosts } from '../newsroom/context.js';

export async function measure() {
  for (const c of CHANNELS.filter((c) => c.analyst && c.env.every((k) => process.env[k]))) {
    const file = c.name === 'instagram' ? 'data/metrics.json' : `data/metrics-${c.name}.json`;
    const m = await c.analyst.collect(loadPosts(), existsSync(root + file) ? json(file) : {});
    writeFileSync(root + file, JSON.stringify(m, null, 1) + '\n');
    const text = c.analyst.summary(m);
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n', { flag: 'a' });
  }
}
