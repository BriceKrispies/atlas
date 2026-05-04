import { spawnSync } from 'node:child_process';

// Positional args: [screenshotMode] [idbSnapshotMode]
//   screenshotMode  → BDD_SCREENSHOT_MODE  (default: 'on-failure')
//   idbSnapshotMode → BDD_IDB_SNAPSHOT     (default: 'on-failure')
//
// `pnpm bdd`        → on-failure / on-failure   (cheapest)
// `pnpm bdd:debug`  → on-failure / always       (full IDB attached every run)
// `pnpm bdd:all`    → always / always           (every step screenshotted + IDB)
const screenshotMode = process.argv[2] ?? 'on-failure';
const idbSnapshotMode = process.argv[3] ?? 'on-failure';
const env = {
  ...process.env,
  BDD_SCREENSHOT_MODE: screenshotMode,
  BDD_IDB_SNAPSHOT: idbSnapshotMode,
};
const shell = process.platform === 'win32';

const gen = spawnSync(
  'pnpm',
  ['exec', 'bddgen', '--config', 'playwright.bdd.config.ts'],
  { stdio: 'inherit', env, shell },
);
if (gen.status !== 0) process.exit(gen.status ?? 1);

const run = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '--config', 'playwright.bdd.config.ts'],
  { stdio: 'inherit', env, shell },
);
process.exit(run.status ?? 1);
