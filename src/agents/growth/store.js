// Kanal büyüme durumu: data/growth/<kanal>.json — zamanlama planı, deneyler, varsayılanlar, topluluk özeti.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { root } from '../../newsroom/context.js';

const file = (name) => `${root}data/growth/${name}.json`;
export const load = (name) =>
  existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : { defaults: {}, active: null, history: [], schedule: null };
export function save(name, state) {
  mkdirSync(`${root}data/growth`, { recursive: true });
  writeFileSync(file(name), JSON.stringify(state, null, 1) + '\n');
}
