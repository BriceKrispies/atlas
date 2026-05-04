/**
 * dev-async — boots the Atlas stack in async-worker mode for end-to-end
 * smoke testing of the worker migration.
 *
 *   server  (apps/server)              WORKER_MODE=async, port 3000
 *   worker  (apps/projection-worker)   drains events past the per-tenant cursor
 *   admin   (apps/admin)               port 5199, talks to the server via HTTP
 *
 * Click "Create page" in admin → 202 returns immediately → the worker
 * rebuilds the page-list projection out-of-band → the SSE broadcast hits
 * `PagesListPage` (which subscribes to `Tenant:<id>`) → the surface
 * refetches and re-renders. If you see the new page appear without
 * reloading the browser, the closed loop is working.
 *
 * Prerequisites:
 *   1. Postgres up:        make db-up
 *   2. Migrations applied: make db-migrate
 *   3. Tenant seeded:      make db-seed       (so the worker has someone to subscribe to)
 *
 * Stop with Ctrl+C — all three child processes are killed.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import postgres from 'postgres';

const SERVER_PORT = 3000;
const ADMIN_PORT = 5199;
const DEFAULT_DB_URL =
  'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';

const dbUrl = process.env['CONTROL_PLANE_DB_URL'] ?? DEFAULT_DB_URL;
const shell = process.platform === 'win32';

interface ProcEntry {
  name: string;
  child: ChildProcess;
}
const procs: ProcEntry[] = [];
let shuttingDown = false;

function prefix(name: string, color: number, chunk: Buffer | string): string {
  const text = typeof chunk === 'string' ? chunk : chunk.toString();
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => `\x1b[${color}m[${name.padEnd(6)}]\x1b[0m ${line}\n`)
    .join('');
}

function spawnProc(
  name: string,
  color: number,
  command: string,
  args: ReadonlyArray<string>,
  env: Record<string, string>,
): void {
  const child = spawn(command, [...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    shell,
  });
  child.stdout?.on('data', (b: Buffer) => process.stdout.write(prefix(name, color, b)));
  child.stderr?.on('data', (b: Buffer) => process.stderr.write(prefix(name, color, b)));
  child.on('exit', (code) => {
    if (shuttingDown) return;
    process.stderr.write(prefix(name, color, `exited with code ${code} — shutting down stack\n`));
    shutdown();
  });
  procs.push({ name, child });
}

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { name, child } of procs) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore — process may have already exited
      }
      process.stderr.write(`[stack ] sent SIGTERM to ${name}\n`);
    }
  }
  setTimeout(() => {
    for (const { child } of procs) {
      if (!child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }
    process.exit(0);
  }, 2_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Typecheck precheck. `tsx watch` doesn't typecheck — it just transforms
// and executes — so without this the stack would fork three processes and
// then crash at runtime on the first import resolution failure. We'd
// rather fail fast at compile time with a clear TS2307 (or similar)
// before any process boots.
console.log('=== Atlas async dev stack — typecheck precheck ===');
const tsResult = spawnSync('pnpm', ['typecheck'], {
  stdio: 'inherit',
  shell,
});
if (tsResult.status !== 0) {
  console.error('');
  console.error('Typecheck failed — aborting before any process boots.');
  console.error('Fix the errors above, then re-run `pnpm dev:async`.');
  process.exit(tsResult.status ?? 1);
}
console.log('typecheck OK\n');

// DB precheck. The two top reasons `dev:async` fails to launch are:
//
//   (1) Port collision — another postgres on the dev machine is shadowing
//       the container's host-port mapping. Symptom: TCP connects, auth
//       fails for `atlas_platform` because the role only exists in the
//       container.
//   (2) Container init misfire — the container started without
//       POSTGRES_USER/PASSWORD env vars (e.g. an ad-hoc `podman compose
//       up` outside the Makefile env exports), so the role was never
//       created on first init.
//
// Both surface as `password authentication failed` from three children
// at once. Catching it here once is much friendlier.
console.log('=== Atlas async dev stack — DB precheck ===');
console.log(`  ${dbUrl}`);
try {
  const sql = postgres(dbUrl, { max: 1, connect_timeout: 5, idle_timeout: 0 });
  try {
    const rows = await sql<Array<{ current_user: string; current_database: string }>>`
      SELECT current_user::text AS current_user, current_database()::text AS current_database
    `;
    const row = rows[0];
    console.log(
      `  connected as ${row?.current_user} on ${row?.current_database}\n`,
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('');
  console.error(`DB precheck failed: ${msg}`);
  console.error('');
  console.error('Common causes — see PORTS.md for the full diagnostic guide:');
  console.error('  • A native postgres on the host is shadowing the container');
  console.error('    (`netstat -ano | findstr :15433` on Windows;');
  console.error('     `lsof -nP -iTCP:15433 -sTCP:LISTEN` on macOS/Linux).');
  console.error('  • The container was started without POSTGRES_USER/PASSWORD');
  console.error('    env vars; run `make db-reset` to re-init with creds.');
  console.error('  • Container not up; run `make db-up`.');
  process.exit(1);
}

console.log('=== Atlas async dev stack ===');
console.log(`  server               http://localhost:${SERVER_PORT}`);
console.log(`  admin                http://localhost:${ADMIN_PORT}`);
console.log(`  projection-worker    (background, no port)`);
console.log('');
console.log(`CONTROL_PLANE_DB_URL = ${dbUrl}`);
console.log('');
console.log('Prereqs: make db-up && make db-migrate && make db-seed');
console.log('Ctrl+C to stop all three processes.');
console.log('');

// Server — async dispatch mode. Test-auth lets the admin app submit intents
// via X-Debug-Principal without a real OIDC provider.
spawnProc('server', 36, 'pnpm', ['--filter', '@atlas/server', 'dev'], {
  WORKER_MODE: 'async',
  CONTROL_PLANE_DB_URL: dbUrl,
  TEST_AUTH_ENABLED: 'true',
  INGRESS_PORT: String(SERVER_PORT),
});

// Worker — drains events from each tenant's WorkerSource and runs the
// dispatcher chain (catalog + content-pages + cacheTagDispatcher) in
// shadow mode. Set WORKER_MODE=live in the worker's env to exit shadow
// mode (Phase 3 cut-over completion).
spawnProc('worker', 35, 'pnpm', ['--filter', '@atlas/projection-worker', 'dev'], {
  CONTROL_PLANE_DB_URL: dbUrl,
  WORKER_MODE: 'shadow',
  WORKER_MODULE_ID: 'projection-default',
});

// Admin — Vite dev server. VITE_BACKEND=http points it at the live server
// instead of the mock backend.
spawnProc(
  'admin',
  33,
  'pnpm',
  ['--filter', '@atlas/admin', 'dev', '--port', String(ADMIN_PORT)],
  {
    VITE_BACKEND: 'http',
    VITE_API_URL: `http://localhost:${SERVER_PORT}`,
  },
);
