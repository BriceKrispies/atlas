/**
 * Stryker `TestRunner` implementation backed by `node --test`.
 *
 * Spawns `node --test --test-reporter=tap` per dryRun/mutantRun call,
 * pipes its stdout through `createTapParser`, maps events to Stryker's
 * result shapes via `makeTestId`.
 *
 * `reloadEnvironment: true` — Node ESM can't unload modules; each
 * mutant gets a fresh subprocess. Slower than runtime activation but
 * mandatory for static mutants in TS-via-`--experimental-transform-types`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import type {
  DryRunOptions,
  DryRunResult,
  MutantRunOptions,
  MutantRunResult,
  TestResult,
  TestRunner,
  TestRunnerCapabilities,
} from '@stryker-mutator/api/test-runner';
import { DryRunStatus, MutantRunStatus, TestStatus } from '@stryker-mutator/api/test-runner';

import { createTapParser, type TapTestEvent } from './tap-parser.ts';
import { discoverTestFiles } from './sandbox-glob.ts';
import { makeTestId } from './test-id.ts';

/**
 * Test-file selection and setup-file injection are configured via env
 * vars rather than Stryker's plugin DI for simplicity at this phase.
 * Both are `;`-separated path lists. Paths may be absolute or
 * cwd-relative; relative resolves against `process.cwd()`.
 *
 * - `ATLAS_STRYKER_TEST_FILES` — overrides discovery. Empty/unset
 *   falls back to `discoverTestFiles(cwd)`.
 * - `ATLAS_STRYKER_SETUP_FILES` — `--import`ed before tests run.
 *   Empty/unset means no setup.
 */
const TEST_FILES_ENV = 'ATLAS_STRYKER_TEST_FILES';
const SETUP_FILES_ENV = 'ATLAS_STRYKER_SETUP_FILES';

function readEnvPathList(name: string): readonly string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) return [];
  return raw
    .split(';')
    .map(function (s) {
      return s.trim();
    })
    .filter(function (s) {
      return s.length > 0;
    })
    .map(function (p) {
      return isAbsolute(p) ? p : resolve(process.cwd(), p);
    });
}

function resolveTestFiles(fromOptions: readonly string[] | undefined): readonly string[] {
  if (fromOptions !== undefined && fromOptions.length > 0) return fromOptions;
  const fromEnv = readEnvPathList(TEST_FILES_ENV);
  if (fromEnv.length > 0) return fromEnv;
  // Last-resort fallback: discover from cwd. Cwd-relative paths so the
  // spawn command stays manageable.
  return discoverTestFiles(process.cwd()).map(function (rel) {
    return resolve(process.cwd(), rel);
  });
}

function resolveSetupFiles(): readonly string[] {
  const setupFiles = readEnvPathList(SETUP_FILES_ENV);
  // Validate existence — a missing setup file silently means the
  // runner spawns without setup, masking bugs. Fail loudly.
  for (const p of setupFiles) {
    if (!existsSync(p)) {
      throw new Error(
        `${SETUP_FILES_ENV} references a non-existent file: ${p}`,
      );
    }
  }
  return setupFiles;
}

interface RunOutcome {
  tests: TestResult[];
  error: string | null;
}

export class NodeTestRunner implements TestRunner {
  capabilities(): TestRunnerCapabilities {
    return { reloadEnvironment: true };
  }

  async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    const files = resolveTestFiles(options.testFiles);
    if (files.length === 0) {
      return {
        status: DryRunStatus.Error,
        errorMessage: `NodeTestRunner.dryRun: no test files. Set ${TEST_FILES_ENV} env var or DryRunOptions.testFiles, or place *.test.ts files under cwd.`,
      };
    }
    const outcome = await this.runFiles(files, undefined, options.timeout);
    if (outcome.error !== null) {
      return { status: DryRunStatus.Error, errorMessage: outcome.error };
    }
    return { status: DryRunStatus.Complete, tests: outcome.tests };
  }

  async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    // Per-mutant test selection: always run the configured test
    // files (parity-significant — must mirror the command runner's
    // "run the whole subset per mutant" behavior). testFilter
    // narrows further to specific test IDs within those files.
    // sandboxFileName is informational; we don't run it directly
    // unless it's also in the test-file set.
    const files = resolveTestFiles(undefined);
    // CRITICAL: tell the instrumented file which mutant is "active"
    // via the env var Stryker's instrumenter compiled into the SUT.
    // Without this, the SUT runs its ORIGINAL branch for every
    // mutant, every test passes, every mutant Survives — the bug
    // the first native run hit. Convention name +
    // `command-test-runner.js:62` use this exact env var.
    const extraEnv: Record<string, string> = {
      __STRYKER_ACTIVE_MUTANT__: options.activeMutant.id,
    };
    const outcome = await this.runFiles(
      files,
      options.testFilter,
      options.timeout,
      extraEnv,
    );
    if (outcome.error !== null) {
      return { status: MutantRunStatus.Error, errorMessage: outcome.error };
    }
    const failed = outcome.tests.filter(function (t) {
      return t.status === TestStatus.Failed;
    });
    if (failed.length === 0) {
      return {
        status: MutantRunStatus.Survived,
        nrOfTests: outcome.tests.length,
      };
    }
    return {
      status: MutantRunStatus.Killed,
      killedBy: failed.map(function (t) {
        return t.id;
      }),
      failureMessage: failed[0]?.failureMessage ?? '',
      nrOfTests: outcome.tests.length,
    };
  }

  async dispose(): Promise<void> {
    // No-op for the spawn-per-call shape — each subprocess exits on
    // its own.
  }

  /**
   * Spawn `node --test --test-reporter=tap <files...>` and collect
   * structured test results from the TAP stream. Per-test filtering
   * uses `--test-name-pattern` built from the requested test IDs'
   * `itName` segment.
   */
  private async runFiles(
    files: readonly string[],
    testFilter: readonly string[] | undefined,
    timeoutMs: number,
    extraEnv: Record<string, string> = {},
  ): Promise<RunOutcome> {
    const setupFiles = resolveSetupFiles();
    return new Promise<RunOutcome>(function (resolveOutcome) {
      const args = [
        '--no-warnings',
        '--experimental-transform-types',
      ];
      // `--import` flags for setup files (e.g. identity-crypto wire).
      // Must precede `--test`.
      for (const setup of setupFiles) {
        args.push('--import', pathToFileURL(setup).href);
      }
      args.push('--test', '--test-reporter=tap');
      if (testFilter !== undefined && testFilter.length > 0) {
        const pattern = buildTestNamePattern(testFilter);
        if (pattern.length > 0) {
          args.push(`--test-name-pattern=${pattern}`);
        }
      }
      for (const f of files) args.push(f);

      // CRITICAL: strip `NODE_TEST_*` env vars before spawning.
      //
      // When the plugin's tests run via `atlas-test` (itself `node --test`),
      // the parent sets `NODE_TEST_CONTEXT` and `NODE_TEST_WORKER_ID` to
      // coordinate its own subtest workers. If those env vars leak into our
      // spawned child, node:test treats the child as an "already in a test
      // run" worker and silently skips normal test discovery — child exits
      // 0 with NO stdout output. The Stryker production case (spawned by
      // `stryker run`, NOT inside `node --test`) doesn't have this leak,
      // but Atlas's own test harness does, so the integration tests would
      // pass in CI and fail under `pnpm test`. Filter defensively.
      const childEnv = { ...process.env, ...extraEnv };
      for (const k of Object.keys(childEnv)) {
        if (k.startsWith('NODE_TEST_')) delete childEnv[k];
      }
      const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const parser = createTapParser();
      const stdoutLines = createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });
      stdoutLines.on('line', function (line: string) {
        parser.feed(line);
      });

      let stderrBuf = '';
      child.stderr.on('data', function (chunk: Buffer | string) {
        stderrBuf += typeof chunk === 'string' ? chunk : chunk.toString();
      });

      const timer = setTimeout(function () {
        child.kill('SIGKILL');
      }, timeoutMs);

      // Race trap: `child.on('close')` fires when the subprocess
      // exits, which can precede readline's flush of buffered stdout
      // lines into our parser. If we drain on child-close alone we
      // miss the tail of the TAP output (often the ENTIRE output if
      // the test ran fast). Gate on BOTH child-close AND readline-
      // close before draining.
      let childClosed = false;
      let readlineClosed = false;
      let exitCode: number | null = null;
      function maybeFinish(): void {
        if (!childClosed || !readlineClosed) return;
        clearTimeout(timer);
        const events = parser.drain();
        const tests = mapEventsToTestResults(events, files);
        if (events.length === 0 && exitCode !== 0) {
          resolveOutcome({
            tests,
            error: `node --test exited ${exitCode} with no TAP output. stderr:\n${stderrBuf.slice(0, 4000)}`,
          });
          return;
        }
        resolveOutcome({ tests, error: null });
      }

      child.on('error', function (err: Error) {
        clearTimeout(timer);
        resolveOutcome({
          tests: [],
          error: `spawn failed: ${err.message}`,
        });
      });

      child.on('close', function (code: number | null) {
        childClosed = true;
        exitCode = code;
        maybeFinish();
      });

      stdoutLines.on('close', function () {
        readlineClosed = true;
        maybeFinish();
      });
    });
  }
}

function mapEventsToTestResults(
  events: readonly TapTestEvent[],
  files: readonly string[],
): TestResult[] {
  const out: TestResult[] = [];
  for (const ev of events) {
    if (ev.kind !== 'test') continue;
    // Leaf tests have at least 1 name segment AND aren't intermediate
    // suite events. node:test emits an ok for each describe wrapper —
    // we skip those by checking whether a deeper test exists.
    // Heuristic: any test event whose `name` is a prefix of another
    // test event's `name` is a suite, not a leaf.
    if (isSuiteName(ev, events)) continue;
    const describePath = ev.name.slice(0, -1);
    const itName = ev.name[ev.name.length - 1] ?? '';
    const filePath = inferFile(files);
    out.push({
      id: makeTestId({ filePath, describePath, itName }),
      name: ev.name.join(' > '),
      status: tapStatusToTestStatus(ev.status),
      timeSpentMs: ev.durationMs ?? 0,
      ...(ev.failure !== null
        ? {
            failureMessage:
              ev.failure.message +
              (ev.failure.stack !== null ? `\n${ev.failure.stack}` : ''),
          }
        : {}),
    });
  }
  return out;
}

function isSuiteName(
  candidate: TapTestEvent,
  all: readonly TapTestEvent[],
): boolean {
  const cn = candidate.name;
  for (const other of all) {
    if (other === candidate) continue;
    if (other.name.length <= cn.length) continue;
    let prefix = true;
    for (let i = 0; i < cn.length; i++) {
      if (other.name[i] !== cn[i]) {
        prefix = false;
        break;
      }
    }
    if (prefix) return true;
  }
  return false;
}

function tapStatusToTestStatus(s: 'pass' | 'fail' | 'skip'): TestStatus {
  switch (s) {
    case 'pass':
      return TestStatus.Success;
    case 'fail':
      return TestStatus.Failed;
    case 'skip':
      return TestStatus.Skipped;
  }
}

function inferFile(files: readonly string[]): string {
  // For the single-file dryRun/mutantRun case this is trivial. For
  // multi-file dryRun we'd need TAP-comment hints or per-file scoping
  // to attribute tests correctly. Punt for now; the parity check
  // surfaces any divergence.
  const first = files[0] ?? '';
  // Always relative-to-cwd POSIX path for stable IDs across platforms.
  const rel = relative(process.cwd(), resolve(first));
  return rel.split(sep).join('/');
}

function buildTestNamePattern(testIds: readonly string[]): string {
  // node:test's `--test-name-pattern` matches against test names. The
  // safest is to OR together regex-escaped `itName` segments from
  // each test ID.
  const names = new Set<string>();
  for (const id of testIds) {
    const parts = id.split('::');
    const itName = parts[parts.length - 1];
    if (itName !== undefined && itName.length > 0) names.add(itName);
  }
  if (names.size === 0) return '';
  const escaped = Array.from(names).map(function (n) {
    return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return `^(${escaped.join('|')})$`;
}
