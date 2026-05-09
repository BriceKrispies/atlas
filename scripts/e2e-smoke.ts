/**
 * End-to-end smoke driver for Atlas.
 *
 * Boots the local dev stack, submits a real ContentPages.Page.Create
 * intent through the full pipeline, fetches the captured log records
 * from the server's in-memory ring sink, pretty-prints the chronological
 * trace to stdout, and asserts that every expected boundary event fired
 * with the correct correlationId. Then verifies the side effect via
 * GET /api/v1/pages/:pageId.
 *
 * Used both as a developer demo (`pnpm e2e:smoke`) and as a CI smoke
 * test. Exits 0 on all-green; 1 on any assertion fail (after printing
 * the captured trace so the operator can see what *did* happen).
 *
 * Env:
 *   CONTROL_PLANE_DB_URL   defaults to local Podman Postgres
 *   INGRESS_PORT           defaults to 3100 (off the dev-server default)
 *   ATLAS_E2E_KEEP_RUNNING when 'true', leaves the spawned server up on
 *                          exit so the operator can poke at /docs etc.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

// ────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────

const DB_URL =
  process.env['CONTROL_PLANE_DB_URL'] ??
  'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';

const PORT = Number.parseInt(process.env['INGRESS_PORT'] ?? '3100', 10);
const BASE = `http://localhost:${PORT}`;
const TENANT_ID = 'dev-tenant';
const ADMIN_PRINCIPAL = `user:tester:${TENANT_ID}:admin`;
const KEEP_RUNNING = process.env['ATLAS_E2E_KEEP_RUNNING'] === 'true';

const REQUIRED_EVENT_NAMES = [
  'Request.Received',
  'Authn.Resolved',
  'Intent.Submitted',
  'Intent.Accepted',
  'Request.Completed',
] as const;

interface LogRecord {
  timestamp: string;
  level: string;
  message: string;
  eventName?: string;
  correlationId: string;
  tenantId?: string;
  principalId?: string;
  durationMs?: number;
  properties?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────
// Tiny coloured-output helpers (no third-party deps)
// ────────────────────────────────────────────────────────────────────

const COLOR = process.stdout.isTTY;
const c = {
  dim: (s: string) => (COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (COLOR ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (COLOR ? `\x1b[36m${s}\x1b[0m` : s),
  bold: (s: string) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
};

function header(title: string): void {
  console.log('');
  console.log(c.bold(c.cyan(`━━━ ${title} ━━━`)));
}

function ok(msg: string): void {
  console.log(`  ${c.green('✓')} ${msg}`);
}

function fail(msg: string): never {
  console.log(`  ${c.red('✗')} ${msg}`);
  throw new Error(msg);
}

// ────────────────────────────────────────────────────────────────────
// Database precheck + tenant bootstrap
// ────────────────────────────────────────────────────────────────────

async function ensureDbReachable(): Promise<void> {
  header('DB precheck');
  const sql = postgres(DB_URL, { max: 1, connect_timeout: 5, idle_timeout: 0 });
  try {
    const rows = await sql<Array<{ db: string }>>`SELECT current_database() as db`;
    ok(`connected to ${rows[0]?.db}`);
  } catch (e) {
    console.error(c.red(`  DB unreachable: ${(e as Error).message}`));
    console.error(`  Run \`make db-up\` and try again.`);
    throw e;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function ensureTenantRow(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1, idle_timeout: 0 });
  try {
    await sql`
      INSERT INTO control_plane.tenants (tenant_id, name)
      VALUES (${TENANT_ID}, ${'Smoke Dev'})
      ON CONFLICT (tenant_id) DO NOTHING
    `;
    ok(`tenant '${TENANT_ID}' present in control_plane.tenants`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

// ────────────────────────────────────────────────────────────────────
// Server lifecycle
// ────────────────────────────────────────────────────────────────────

interface ServerHandle {
  child: ChildProcess;
  bootLines: LogRecord[];
}

function spawnServer(): ServerHandle {
  header('Spawning apps/server');
  console.log(`  port ${PORT}, LOG_LEVEL=debug, WORKER_MODE=inline, POLICY_ENGINE=stub`);

  const child = spawn(
    'pnpm',
    ['--filter', '@atlas/server', 'start'],
    {
      env: {
        ...process.env,
        CONTROL_PLANE_DB_URL: DB_URL,
        TEST_AUTH_ENABLED: 'true',
        POLICY_ENGINE: 'stub',
        WORKER_MODE: 'inline',
        INGRESS_PORT: String(PORT),
        LOG_LEVEL: 'debug',
        // Ensure the run is fully self-contained for this smoke; don't
        // pick up a developer's dotted dev defaults.
        TENANT_ID: TENANT_ID,
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const bootLines: LogRecord[] = [];
  child.stdout?.setEncoding('utf-8');
  child.stderr?.setEncoding('utf-8');

  let buffer = '';
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as LogRecord;
        bootLines.push(parsed);
      } catch {
        // Non-JSON output — pnpm framing, tsx banners, etc. Echo dim.
        console.log(c.dim(`    [server stdout] ${line}`));
      }
    }
  });
  child.stderr?.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      const t = line.trim();
      if (t) console.log(c.dim(`    [server stderr] ${t}`));
    }
  });

  return { child, bootLines };
}

async function waitForReady(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) {
        ok(`server healthy in ${Date.now() - start}ms`);
        return;
      }
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not become ready in ${timeoutMs}ms: ${lastErr}`);
}

async function stopServer(handle: ServerHandle): Promise<void> {
  if (KEEP_RUNNING) {
    console.log(
      c.yellow(`\n  ATLAS_E2E_KEEP_RUNNING=true — leaving server alive at ${BASE}`),
    );
    handle.child.unref();
    return;
  }
  header('Tearing down server');
  if (handle.child.pid !== undefined) {
    if (process.platform === 'win32') {
      // tsx + pnpm spawn a tree of processes via cmd.exe; SIGTERM to the
      // shell alone won't reach the actual node process. taskkill /T
      // walks the tree.
      const { spawnSync } = await import('node:child_process');
      spawnSync('taskkill', ['/PID', String(handle.child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      handle.child.kill('SIGTERM');
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  ok('server stopped');
}

// ────────────────────────────────────────────────────────────────────
// Intent submission + log fetch
// ────────────────────────────────────────────────────────────────────

interface SubmitResult {
  pageId: string;
  correlationId: string;
  response: { eventId?: string };
}

async function submitIntent(): Promise<SubmitResult> {
  header('Submit intent');
  const correlationId = randomUUID();
  const idempotencyKey = randomUUID();
  const eventId = randomUUID();
  const pageId = `smoke-page-${Date.now().toString(36)}`;

  const envelope = {
    eventId,
    eventType: 'ContentPages.PageCreated',
    schemaId: 'content_pages.page.create.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: TENANT_ID,
    correlationId,
    idempotencyKey,
    payload: {
      actionId: 'ContentPages.Page.Create',
      resourceType: 'Page',
      pageId,
      title: 'Smoke Page',
      slug: pageId,
    },
  };

  console.log(`  correlationId  ${c.cyan(correlationId)}`);
  console.log(`  pageId         ${c.cyan(pageId)}`);

  const r = await fetch(`${BASE}/api/v1/intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      'X-Debug-Principal': ADMIN_PRINCIPAL,
    },
    body: JSON.stringify(envelope),
  });

  const body = (await r.json().catch(() => ({}))) as { eventId?: string };
  if (r.status !== 202) {
    fail(`expected 202, got ${r.status}: ${JSON.stringify(body)}`);
  }
  ok(`intent accepted (status 202, eventId=${body.eventId ?? '?'})`);

  return { pageId, correlationId, response: body };
}

async function fetchTrace(correlationId: string): Promise<LogRecord[]> {
  // Ring sink is async-flushed; give it one beat to drain so the
  // Request.Completed line for THIS request is visible.
  await new Promise((r) => setTimeout(r, 100));
  const url = `${BASE}/api/v1/admin/logging/correlation/${encodeURIComponent(correlationId)}/recent?limit=200`;
  const r = await fetch(url, {
    headers: { 'X-Debug-Principal': ADMIN_PRINCIPAL },
  });
  if (!r.ok) {
    fail(`trace fetch failed: ${r.status} ${await r.text()}`);
  }
  const body = (await r.json()) as { events: LogRecord[] };
  // Ring sink returns most-recent-first; flip to chronological for
  // human reading + the monotonic-timestamp assertion.
  return [...body.events].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
}

// ────────────────────────────────────────────────────────────────────
// Pretty-print + assertions
// ────────────────────────────────────────────────────────────────────

function printTrace(records: LogRecord[]): void {
  header(`Captured trace (${records.length} records)`);
  for (const r of records) {
    const ts = r.timestamp.slice(11, 23);
    const level = r.level.toUpperCase().padEnd(5);
    const event = (r.eventName ?? '-').padEnd(20);
    const dur =
      typeof r.durationMs === 'number'
        ? c.dim(` (${r.durationMs.toFixed(1)}ms)`)
        : '';
    const props = r.properties
      ? ' ' + c.dim(formatProps(r.properties))
      : '';
    console.log(`  ${c.dim(ts)}  ${colorLevel(level, r.level)}  ${event}${dur}${props}`);
  }
}

function colorLevel(s: string, lvl: string): string {
  switch (lvl) {
    case 'debug':
      return c.dim(s);
    case 'info':
      return c.green(s);
    case 'warn':
      return c.yellow(s);
    case 'error':
    case 'fatal':
      return c.red(s);
    default:
      return s;
  }
}

function formatProps(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    parts.push(`${k}=${s}`);
  }
  return parts.join(' ');
}

function assertTrace(records: LogRecord[], correlationId: string): void {
  header('Assertions');

  // 1. Non-empty trace
  if (records.length === 0) {
    fail('no log records captured for this correlationId');
  }
  ok(`${records.length} log records captured`);

  // 2. Correlation propagation
  const wrongCorr = records.filter((r) => r.correlationId !== correlationId);
  if (wrongCorr.length > 0) {
    fail(`${wrongCorr.length} records have wrong correlationId`);
  }
  ok('every record carries the request correlationId');

  // 3. Required boundary event names
  const seen = new Set(records.map((r) => r.eventName).filter((s): s is string => !!s));
  const missing = REQUIRED_EVENT_NAMES.filter((n) => !seen.has(n));
  if (missing.length > 0) {
    fail(`missing expected boundary events: ${missing.join(', ')}`);
  }
  ok(`all required boundary events present: ${REQUIRED_EVENT_NAMES.join(', ')}`);

  // 4. Timestamps monotonic-ish (drift up to a few ms is fine on Windows)
  let prev = 0;
  let outOfOrder = 0;
  for (const r of records) {
    const t = Date.parse(r.timestamp);
    if (t < prev) outOfOrder++;
    prev = t;
  }
  if (outOfOrder > 0) {
    console.log(
      c.yellow(`  ! ${outOfOrder} records timestamp-out-of-order (likely sub-ms drift)`),
    );
  } else {
    ok('timestamps monotonic');
  }
}

async function verifyPageReadable(pageId: string): Promise<void> {
  header('Verify side effect');
  const r = await fetch(`${BASE}/api/v1/pages/${encodeURIComponent(pageId)}`, {
    headers: { 'X-Debug-Principal': ADMIN_PRINCIPAL },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    fail(`GET page failed: ${r.status} ${text}`);
  }
  const body = (await r.json()) as { title?: string; slug?: string };
  if (body.title !== 'Smoke Page') {
    fail(`unexpected page title: ${JSON.stringify(body)}`);
  }
  ok(`page reachable and projection populated: title='${body.title}'`);
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(c.bold(`Atlas E2E smoke — ${new Date().toISOString()}`));

  await ensureDbReachable();
  await ensureTenantRow();

  const handle = spawnServer();
  let exitCode = 0;
  try {
    await waitForReady();
    const submit = await submitIntent();
    const trace = await fetchTrace(submit.correlationId);
    printTrace(trace);
    assertTrace(trace, submit.correlationId);
    await verifyPageReadable(submit.pageId);
    console.log('');
    console.log(c.green(c.bold('✓ smoke OK')));
  } catch (e) {
    exitCode = 1;
    console.log('');
    console.log(c.red(c.bold(`✗ smoke FAILED: ${(e as Error).message}`)));
  } finally {
    await stopServer(handle);
  }

  process.exit(exitCode);
}

void main();
