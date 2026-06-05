// Dev-only: seed the active-project handoff file before nodemon starts.
//
// In dev (npm run dev) nodemon can't change env across restarts, so the server
// reads its data dir from ~/.dico-app/active-project (see server.ts, gated on
// SDD_DEV). This script runs ONCE per `npm run dev` and seeds that file from
// DATA_DIR (or the default sample) so a fresh session honors DATA_DIR rather
// than a stale handoff from a previous session. Mid-session project switches
// then update the handoff and trigger a nodemon restart.
//
// Run from the backend/ directory (cwd), matching the dev server's cwd.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const appDir = join(homedir(), '.dico-app');
const handoff = join(appDir, 'active-project');
const trigger = resolve(process.cwd(), '.dico-restart.json'); // nodemon-watched

// Mirror config.ts's dev default: <repo>/samples/eshop (cwd is backend/).
const dataDir = process.env.DATA_DIR || resolve(process.cwd(), '..', 'samples', 'eshop');

mkdirSync(appDir, { recursive: true });
writeFileSync(handoff, dataDir, 'utf8');
if (!existsSync(trigger)) writeFileSync(trigger, JSON.stringify({ ts: 0 }), 'utf8');

console.log(`[dev] active project seeded → ${dataDir}`);
