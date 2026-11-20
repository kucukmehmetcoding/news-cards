// Komut satırı: yazı işleri (orkestratör), yayın müdürü ve ölçüm analistine giriş.
// Ajanlar: src/agents/ — kanal masaları: src/agents/channels/ — ortak masa: src/newsroom/
import { prepare, approve, reject, list } from './newsroom/orchestrator.js';
import { publishNext } from './agents/publisher.js';
import { measure } from './agents/analyst.js';
import { growth } from './agents/growth-manager.js';

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  prepare,
  publish: publishNext,
  approve: () => approve(args),
  reject: () => reject(args),
  list,
  metrics: measure,
  growth: () => growth({ community: !args.includes('--no-community') }),
};
if (!commands[cmd]) {
  console.error('Kullanım: node src/run.js prepare | publish | approve <id|all> | reject <id|all> | list | metrics | growth [--no-community]');
  process.exit(1);
}
await commands[cmd]();
