/**
 * Stryker config — ORACLE (command runner).
 *
 * This is the reference implementation: Stryker's built-in `command`
 * runner shells out to `pnpm test ...` for every mutant. Slow, but
 * Stryker maintains it directly so its behavior is the spec. The
 * native `@atlas/stryker-runner-node-test` plugin (see
 * `stryker.native.config.mjs`) must produce byte-identical results on
 * the same `mutate` scope + same test subset.
 *
 * Parity is verified by `scripts/stryker-parity.ts` (run via
 * `pnpm mutation:parity`). DO NOT change the `mutate` scope, `mutator`
 * config, or `testRunner` options without updating the native config
 * in lockstep — divergence breaks the parity contract.
 *
 * Spec: `C:\Users\Brice\.claude\plans\twinkly-popping-deer.md` — Stryker
 * Node-Test Runner Plugin plan, Phase 1.
 */

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  // Test runner — `command` runs the configured shell command per
  // mutant. The native plugin (see sibling config) replaces this.
  testRunner: 'command',

  commandRunner: {
    // Go through a wrapper so we can force `ATLAS_TEST_SETUP=auto`.
    // atlas-test's auto-detect checks cwd === REPO_ROOT to decide
    // whether to load `identity-crypto.ts` (the boot wire-up for
    // `setIdentityCrypto`). Stryker's sandbox cwd is NOT the repo
    // root, so without the override atlas-test falls into per-package
    // mode and the handler tests fail with "identity Crypto not
    // configured."
    command: 'node scripts/stryker-oracle-command.mjs',
  },

  // Narrow the mutate scope to exactly what `handlers.test.ts` covers
  // (verified via the test's imports). Wider scope would generate
  // NoCoverage mutants — fast to evaluate but noise in the parity
  // diff. Tight scope keeps the first run minutes, not hours.
  mutate: [
    'modules/identity/src/handlers/user-create.ts',
    'modules/identity/src/handlers/membership-create.ts',
    'modules/identity/src/handlers/invite-issue.ts',
    'modules/identity/src/handlers/invite-accept.ts',
  ],

  // Reporters — JSON for machine-readable diffing (load-bearing for
  // the parity check). HTML for human inspection. `progress` for
  // streaming feedback during long runs.
  reporters: ['json', 'html', 'progress'],

  // Output directory + per-config filenames so oracle and native
  // reports coexist without overwrite. `scripts/stryker-parity.ts`
  // reads these by name.
  htmlReporter: {
    fileName: 'reports/mutation/oracle-baseline.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/oracle-baseline.json',
  },

  // `pnpm test` cold-start on Windows can take a few seconds before
  // the test file even loads; 30s gives generous headroom without
  // letting a truly-hung test eat the entire run.
  timeoutMS: 30_000,

  // Concurrency — Stryker spawns this many test-runner subprocesses
  // in parallel. Each runs a separate `pnpm test` (cold-start). Keep
  // modest so the host doesn't thrash.
  concurrency: 2,

  // Don't try to run tests that would have no coverage — for the
  // command runner this is moot (every mutant runs the full subset)
  // but it keeps the report shape consistent with the native plugin.
  coverageAnalysis: 'off',

  // TypeScript + ESM project — use the typescript-checker plugin if
  // available, otherwise leave at default. We're not adding it as a
  // dep yet; `checkers: []` keeps Stryker from looking for one.
  checkers: [],

  // Tempdir under the workspace so reruns clean up reliably on
  // Windows (where global tmpdir cleanup can leak across runs).
  tempDirName: '.stryker-tmp/oracle',

  // Disable the `disableTypeChecks` mutator — the workspace already
  // typechecks via `pnpm typecheck`, and Stryker's heuristic-based
  // TS-disable can produce mutants that don't compile under
  // `--experimental-transform-types`.
  disableTypeChecks: false,
};
