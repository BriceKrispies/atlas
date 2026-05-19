#!/usr/bin/env node --experimental-transform-types
/**
 * Atlas overseer — mechanical chokepoint check runner.
 *
 * Each check watches a fixed file:line surface where an Atlas invariant
 * (I1, I9, I10, I12, I18, …) lives. Drift = the chokepoint shape changed
 * outside an approved spec. The runner exits non-zero on any FAIL.
 *
 * Invoke:
 *   pnpm overseer:check              # summary
 *   pnpm overseer:check --verbose    # + offending file:line evidence
 *
 * Companion: .claude/agents/overseer.md — the agent runs this script,
 * adds judgment-only checks (I2/I3/I5 ordering), and files drift tickets.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

type CheckStatus = 'pass' | 'fail' | 'skip';

interface CheckResult {
  id: string;
  invariant: string;
  status: CheckStatus;
  summary: string;
  evidence: string[];
  note?: string;
}

type Check = () => CheckResult;

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const VERBOSE = process.argv.includes('--verbose');

const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.turbo',
  'coverage',
  'playwright-report',
  '.next',
  'tsdist',
]);

function* walk(dir: string, exts: string[]): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full, exts);
    else if (e.isFile() && exts.some(function (x) { return e.name.endsWith(x); })) yield full;
  }
}

function rel(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join('/');
}

function readLines(file: string): string[] {
  return readFileSync(file, 'utf8').split('\n');
}

function isTestFile(path: string): boolean {
  return /(\.test\.|\.spec\.|[\\/]test[\\/]|[\\/]tests[\\/])/.test(path);
}

function grepFile(
  file: string,
  pattern: RegExp,
): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  const lines = readLines(file);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (!text) continue;
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (pattern.test(text)) hits.push({ line: i + 1, text: trimmed });
  }
  return hits;
}

function pass(id: string, invariant: string, summary: string): CheckResult {
  return { id, invariant, status: 'pass', summary, evidence: [] };
}

function fail(
  id: string,
  invariant: string,
  summary: string,
  evidence: string[],
): CheckResult {
  return { id, invariant, status: 'fail', summary, evidence };
}

function skip(
  id: string,
  invariant: string,
  summary: string,
  note: string,
): CheckResult {
  return { id, invariant, status: 'skip', summary, evidence: [], note };
}

// I1: only apps/server/ may import an HTTP server framework.
const HTTP_SERVER_PATTERN =
  /from\s+['"](hono|@hono\/node-server|express|fastify|koa|@fastify)['"]|http\.createServer\(|https\.createServer\(/;

const i1SingleIngress: Check = function () {
  const appsDir = join(REPO_ROOT, 'apps');
  const offenders: string[] = [];
  for (const file of walk(appsDir, ['.ts', '.tsx'])) {
    if (isTestFile(file)) continue;
    const relPath = rel(file);
    if (relPath.startsWith('apps/server/')) continue;
    const hits = grepFile(file, HTTP_SERVER_PATTERN);
    for (const h of hits) offenders.push(`${relPath}:${h.line}  ${h.text}`);
  }
  if (offenders.length === 0)
    return pass(
      'i1-single-ingress',
      'I1',
      'only apps/server/ imports an HTTP server framework',
    );
  return fail(
    'i1-single-ingress',
    'I1',
    `${offenders.length} non-server app(s) import an HTTP server framework`,
    offenders,
  );
};

// I1 (modules half): no module mounts HTTP. Inbound only — outbound fetch is I15.
const MODULE_HTTP_PATTERN =
  /from\s+['"](hono|@hono\/node-server|express|fastify|koa)['"]|http\.createServer\(|https\.createServer\(/;

const i1ModulesNoHttp: Check = function () {
  const modulesDir = join(REPO_ROOT, 'modules');
  const offenders: string[] = [];
  for (const file of walk(modulesDir, ['.ts'])) {
    if (isTestFile(file)) continue;
    const hits = grepFile(file, MODULE_HTTP_PATTERN);
    for (const h of hits) offenders.push(`${rel(file)}:${h.line}  ${h.text}`);
  }
  if (offenders.length === 0)
    return pass('i1-modules-no-http', 'I1', 'no /modules file mounts HTTP');
  return fail(
    'i1-modules-no-http',
    'I1',
    `${offenders.length} module file(s) mount HTTP`,
    offenders,
  );
};

// I12: every modules/<x>/src/dispatch.ts has a sibling modules/<x>/test/dispatch.test.ts.
const i12DispatchTestsExist: Check = function () {
  const modulesDir = join(REPO_ROOT, 'modules');
  const offenders: string[] = [];
  let checked = 0;
  let modules: string[] = [];
  try {
    modules = readdirSync(modulesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !EXCLUDE_DIRS.has(e.name))
      .map((e) => e.name);
  } catch {
    return skip('i12-dispatch-tests-exist', 'I12', 'no /modules directory', '');
  }
  for (const mod of modules) {
    const dispatchSrc = join(modulesDir, mod, 'src', 'dispatch.ts');
    if (!existsSync(dispatchSrc)) continue;
    checked++;
    const dispatchTest = join(modulesDir, mod, 'test', 'dispatch.test.ts');
    if (!existsSync(dispatchTest)) {
      offenders.push(
        `modules/${mod}/src/dispatch.ts  (missing sibling test/dispatch.test.ts)`,
      );
    }
  }
  if (offenders.length === 0)
    return pass(
      'i12-dispatch-tests-exist',
      'I12',
      `every module dispatcher has a rebuild test (${checked} checked)`,
    );
  return fail(
    'i12-dispatch-tests-exist',
    'I12',
    `${offenders.length}/${checked} module dispatcher(s) missing rebuild test`,
    offenders,
  );
};

// I10/I12 worker-mirror parity: WORKER_DISPATCHER_CHAIN_NAMES ⊆ REQUEST_DISPATCHER_CHAIN_NAMES,
// with order preserved.
const CHAIN_ARRAY_PATTERN =
  /(REQUEST_DISPATCHER_CHAIN_NAMES|WORKER_DISPATCHER_CHAIN_NAMES):\s*ReadonlyArray<string>\s*=\s*\[([^\]]+)\]/s;

function parseChain(file: string, name: string): string[] | null {
  const src = readFileSync(file, 'utf8');
  const m = src.match(CHAIN_ARRAY_PATTERN);
  if (!m || !m[0].includes(name)) return null;
  const body = m[2] ?? '';
  return body
    .split(',')
    .map(function (s) { return s.trim().replace(/^['"`]|['"`]$/g, ''); })
    .filter(function (s) { return s.length > 0; });
}

const dispatcherChainMirror: Check = function () {
  const stateFile = join(
    REPO_ROOT,
    'apps',
    'server',
    'src',
    'middleware',
    'state.ts',
  );
  const workerFile = join(
    REPO_ROOT,
    'apps',
    'projection-worker',
    'src',
    'tenant-loop.ts',
  );
  if (!existsSync(stateFile) || !existsSync(workerFile)) {
    return skip(
      'dispatcher-chain-mirror',
      'I10/I12',
      'chain source file(s) missing',
      `state.ts=${existsSync(stateFile)} tenant-loop.ts=${existsSync(workerFile)}`,
    );
  }
  const request = parseChain(stateFile, 'REQUEST_DISPATCHER_CHAIN_NAMES');
  const worker = parseChain(workerFile, 'WORKER_DISPATCHER_CHAIN_NAMES');
  if (!request || !worker) {
    return fail(
      'dispatcher-chain-mirror',
      'I10/I12',
      'could not parse one or both chain constants',
      [
        `apps/server/src/middleware/state.ts  REQUEST_DISPATCHER_CHAIN_NAMES=${request ? 'parsed' : 'MISSING'}`,
        `apps/projection-worker/src/tenant-loop.ts  WORKER_DISPATCHER_CHAIN_NAMES=${worker ? 'parsed' : 'MISSING'}`,
      ],
    );
  }
  // Worker chain must be a prefix of the request chain (same names, same order, possibly shorter).
  const drift: string[] = [];
  for (let i = 0; i < worker.length; i++) {
    if (request[i] !== worker[i]) {
      drift.push(
        `position ${i}: worker='${worker[i]}' request='${request[i] ?? '(none)'}'`,
      );
    }
  }
  if (drift.length === 0)
    return pass(
      'dispatcher-chain-mirror',
      'I10/I12',
      `worker chain is a prefix of request chain (worker=${worker.length}, request=${request.length})`,
    );
  return fail(
    'dispatcher-chain-mirror',
    'I10/I12',
    'worker chain diverges from request chain',
    [
      `request: [${request.join(', ')}]`,
      `worker:  [${worker.join(', ')}]`,
      ...drift,
    ],
  );
};

// UI bar: only AtlasElement/AtlasSurface may be the base class in packages/design and apps/*.
// packages/core/src/component.ts is allowlisted (defines AtlasElement extends HTMLElement).
const FORBIDDEN_BASE_PATTERN =
  /class\s+\w+\s+extends\s+(HTMLElement|LitElement)\b/;

const atlasElementOnly: Check = function () {
  const offenders: string[] = [];
  const roots = [
    join(REPO_ROOT, 'packages', 'design', 'src'),
    join(REPO_ROOT, 'packages', 'widgets', 'src'),
    join(REPO_ROOT, 'apps'),
  ];
  for (const root of roots) {
    for (const file of walk(root, ['.ts', '.tsx'])) {
      if (isTestFile(file)) continue;
      const relPath = rel(file);
      // Allowlist: the AtlasElement primitive itself.
      if (relPath === 'packages/core/src/component.ts') continue;
      const hits = grepFile(file, FORBIDDEN_BASE_PATTERN);
      for (const h of hits) offenders.push(`${relPath}:${h.line}  ${h.text}`);
    }
  }
  if (offenders.length === 0)
    return pass(
      'atlas-element-only',
      'UI bar',
      'no UI class extends HTMLElement / LitElement outside packages/core/src/component.ts',
    );
  return fail(
    'atlas-element-only',
    'UI bar',
    `${offenders.length} UI class(es) bypass AtlasElement`,
    offenders,
  );
};

// I7: every query file in modules/*/src/queries/ must reference tenantId.
const i7QueryTenantGuard: Check = function () {
  const modulesDir = join(REPO_ROOT, 'modules');
  const offenders: string[] = [];
  let checked = 0;
  for (const file of walk(modulesDir, ['.ts'])) {
    if (isTestFile(file)) continue;
    const relPath = rel(file);
    if (!/^modules\/[^/]+\/src\/queries\//.test(relPath)) continue;
    checked++;
    const src = readFileSync(file, 'utf8');
    if (!/\btenantId\b/.test(src)) {
      offenders.push(`${relPath}  (no tenantId reference)`);
    }
  }
  if (checked === 0)
    return skip(
      'i7-query-tenant-guard',
      'I7',
      'no module query files found',
      '',
    );
  if (offenders.length === 0)
    return pass(
      'i7-query-tenant-guard',
      'I7',
      `every module query file references tenantId (${checked} checked)`,
    );
  return fail(
    'i7-query-tenant-guard',
    'I7',
    `${offenders.length}/${checked} query file(s) missing tenantId`,
    offenders,
  );
};

// I9: heuristic — every cache.set/cache.get call site must be in a file that imports
// buildCacheKey OR has tenantId in scope. This is a SKIP-with-note for now: the
// runtime guard at packages/platform-core/src/cache-key.ts:266 is the load-bearing
// enforcement. The agent reasons about call-site escape hatches.
const i9CacheKeyTenant: Check = function () {
  const guardFile = join(
    REPO_ROOT,
    'packages',
    'platform-core',
    'src',
    'cache-key.ts',
  );
  if (!existsSync(guardFile))
    return fail(
      'i9-cache-key-tenant',
      'I9',
      'runtime guard file missing',
      ['packages/platform-core/src/cache-key.ts'],
    );
  const src = readFileSync(guardFile, 'utf8');
  if (!/validateCacheArtifact/.test(src) || !/I9/.test(src))
    return fail(
      'i9-cache-key-tenant',
      'I9',
      'runtime guard (validateCacheArtifact + I9 error code) not detected in cache-key.ts',
      [`packages/platform-core/src/cache-key.ts`],
    );
  return skip(
    'i9-cache-key-tenant',
    'I9',
    'runtime guard present in cache-key.ts; call-site coverage delegated to agent',
    'validateCacheArtifact throws CacheError(..., "I9") on missing tenant tag. Mechanical call-site sweep is a known gap — overseer agent handles it.',
  );
};

// I10: every modules/*/src/events.ts must declare cacheInvalidationTags on its event shape.
// Modules that emit events from handlers (catalog, content-pages) handle the field there;
// the check looks for the field in BOTH events.ts and the handlers/ files.
const i10CacheInvalidationTags: Check = function () {
  const modulesDir = join(REPO_ROOT, 'modules');
  const offenders: string[] = [];
  let modules: string[] = [];
  try {
    modules = readdirSync(modulesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !EXCLUDE_DIRS.has(e.name))
      .map((e) => e.name);
  } catch {
    return skip('i10-cache-invalidation-tags', 'I10', 'no /modules directory', '');
  }
  let checked = 0;
  for (const mod of modules) {
    // Look at both events.ts (if present) and handlers/*.ts.
    const candidates: string[] = [];
    const eventsFile = join(modulesDir, mod, 'src', 'events.ts');
    if (existsSync(eventsFile)) candidates.push(eventsFile);
    const handlersDir = join(modulesDir, mod, 'src', 'handlers');
    if (existsSync(handlersDir)) {
      for (const file of walk(handlersDir, ['.ts'])) {
        if (!isTestFile(file)) candidates.push(file);
      }
    }
    if (candidates.length === 0) continue;
    checked++;
    const anyMention = candidates.some((c) =>
      /cacheInvalidationTags/.test(readFileSync(c, 'utf8')),
    );
    if (!anyMention) {
      offenders.push(
        `modules/${mod}/  (no cacheInvalidationTags reference in events.ts or handlers/)`,
      );
    }
  }
  if (offenders.length === 0)
    return pass(
      'i10-cache-invalidation-tags',
      'I10',
      `every event-emitting module references cacheInvalidationTags (${checked} checked)`,
    );
  return fail(
    'i10-cache-invalidation-tags',
    'I10',
    `${offenders.length}/${checked} module(s) appear to emit events without cacheInvalidationTags`,
    offenders,
  );
};

// I18: the AtlasSurface base contract must write data-state. Subclasses inherit
// the state-machine plumbing from the base; what matters is that the base still
// owns the data-state attribute write. If a refactor removes the contract from
// the base, every surface silently loses its machine-readable state — that's
// the chokepoint to watch. Per-subclass state coverage is judgment territory
// (agent reasons about it; subclass that visibly bypasses the base goes to
// architect).
const i18SurfacesHaveState: Check = function () {
  const componentFile = join(
    REPO_ROOT,
    'packages',
    'core',
    'src',
    'component.ts',
  );
  if (!existsSync(componentFile))
    return fail(
      'i18-surfaces-have-state',
      'I18',
      'AtlasSurface base file missing',
      ['packages/core/src/component.ts'],
    );
  const src = readFileSync(componentFile, 'utf8');
  const hasSurfaceClass = /class\s+AtlasSurface\b/.test(src);
  const hasSetState = /setState\s*\(\s*state:\s*SurfaceState\b/.test(src);
  const writesDataState = /setAttribute\(\s*['"]data-state['"]/.test(src);
  const problems: string[] = [];
  if (!hasSurfaceClass)
    problems.push('packages/core/src/component.ts  (class AtlasSurface not found)');
  if (!hasSetState)
    problems.push(
      'packages/core/src/component.ts  (setState(state: SurfaceState) method not found)',
    );
  if (!writesDataState)
    problems.push(
      'packages/core/src/component.ts  (setAttribute("data-state", …) write missing)',
    );
  if (problems.length === 0) {
    // Spot-check: count AtlasSurface subclasses so the summary is informative.
    let subclassCount = 0;
    const roots = [
      join(REPO_ROOT, 'packages'),
      join(REPO_ROOT, 'apps'),
      join(REPO_ROOT, 'bundles'),
    ];
    const subclassPattern = /class\s+\w+\s+extends\s+AtlasSurface\b/;
    for (const root of roots) {
      for (const file of walk(root, ['.ts', '.tsx'])) {
        if (isTestFile(file)) continue;
        if (subclassPattern.test(readFileSync(file, 'utf8'))) subclassCount++;
      }
    }
    return pass(
      'i18-surfaces-have-state',
      'I18',
      `AtlasSurface base writes data-state; ${subclassCount} subclass(es) inherit the contract`,
    );
  }
  return fail(
    'i18-surfaces-have-state',
    'I18',
    'AtlasSurface base contract incomplete — subclasses would silently lose state',
    problems,
  );
};

// Logging: every modules/*/src/dispatch.ts MUST call `ctx.logger.<level>`
// at least once. Dispatchers are the seam where events fan out to
// projections; an unlit dispatcher means flipping its module to debug
// produces nothing. The check is structural — it does not assert
// runtime behavior, only that the file contains the call site so a new
// module cannot ship a silent dispatcher.
//
// Pairs with `specs/crosscut/logging.md` ▸ Tooling. The ESLint /
// Semgrep `no-console` rules govern the FORBIDDEN side (raw
// `console.*`); this check governs the REQUIRED side (the structured
// logger is actually used at the chokepoint).
const LOGGER_CALL_PATTERN = /ctx\.logger\??\.(debug|info|warn|error|fatal)\(/;
const DISPATCH_FILE_PATTERN = /[\\/]dispatch\.ts$/;

const iLoggingDispatchSpeaks: Check = function () {
  const modulesDir = join(REPO_ROOT, 'modules');
  const dispatchers: string[] = [];
  const silent: string[] = [];
  for (const file of walk(modulesDir, ['.ts'])) {
    if (isTestFile(file)) continue;
    if (!DISPATCH_FILE_PATTERN.test(file)) continue;
    dispatchers.push(rel(file));
    const hits = grepFile(file, LOGGER_CALL_PATTERN);
    if (hits.length === 0) silent.push(rel(file));
  }
  if (dispatchers.length === 0) {
    return skip(
      'logging-dispatch-speaks',
      'LOGGING',
      'no modules/*/src/dispatch.ts files discovered',
      'add a module under /modules with a dispatch.ts to enable this check',
    );
  }
  if (silent.length === 0)
    return pass(
      'logging-dispatch-speaks',
      'LOGGING',
      `${dispatchers.length} dispatcher(s) reference ctx.logger`,
    );
  return fail(
    'logging-dispatch-speaks',
    'LOGGING',
    `${silent.length} dispatcher(s) emit no structured logs — flipping the module to debug shows nothing`,
    silent.map((f) => `${f}  (no ctx.logger.<level>(…) call found)`),
  );
};

const CHECKS: Check[] = [
  i1SingleIngress,
  i1ModulesNoHttp,
  i12DispatchTestsExist,
  dispatcherChainMirror,
  atlasElementOnly,
  i7QueryTenantGuard,
  i9CacheKeyTenant,
  i10CacheInvalidationTags,
  i18SurfacesHaveState,
  iLoggingDispatchSpeaks,
];

function statusBadge(s: CheckStatus): string {
  if (s === 'pass') return 'PASS';
  if (s === 'fail') return 'FAIL';
  return 'SKIP';
}

function pad(s: string, n: number): string {
  return s + ' '.repeat(Math.max(0, n - s.length));
}

function main(): number {
  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    try {
      results.push(check());
    } catch (err) {
      results.push(
        fail(check.name || 'unknown', '?', 'check threw', [
          err instanceof Error ? err.message : String(err),
        ]),
      );
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  process.stdout.write(`overseer-check ${today}\n`);
  process.stdout.write('─'.repeat(64) + '\n');

  for (const r of results) {
    process.stdout.write(
      `${pad(r.id, 30)} ${pad(r.invariant, 8)} ${statusBadge(r.status)}  ${r.summary}\n`,
    );
    if (r.status === 'skip' && r.note) {
      process.stdout.write(`  note: ${r.note}\n`);
    }
    if (VERBOSE && r.evidence.length > 0) {
      for (const e of r.evidence) process.stdout.write(`    ${e}\n`);
    }
  }

  const failed = results.filter(function (r) { return r.status === 'fail'; }).length;
  const skipped = results.filter(function (r) { return r.status === 'skip'; }).length;
  process.stdout.write('─'.repeat(64) + '\n');
  if (failed === 0) {
    process.stdout.write(
      `Result: PASS — ${results.length - skipped - failed} check(s) green, ${skipped} skipped.\n`,
    );
    return 0;
  }
  process.stdout.write(
    `Result: FAIL — ${failed} check(s) failing, ${skipped} skipped.\n`,
  );
  if (!VERBOSE) {
    process.stdout.write('Re-run with --verbose for file:line evidence.\n');
  }
  return 1;
}

process.exit(main());
