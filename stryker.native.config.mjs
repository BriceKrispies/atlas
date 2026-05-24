/**
 * Stryker config — NATIVE (`@atlas/stryker-runner-node-test`).
 *
 * Identity-module mutation campaign: mutates EVERY handler in
 * `modules/identity/src/handlers/` and runs the WHOLE identity unit
 * suite (`test/unit/*.test.ts` + `test/handlers.test.ts`) against each
 * mutant. This is the "is our test suite theater?" measurement scoped to
 * a real module — far higher signal than the original 4-handler subset,
 * and bounded to a test set that's self-contained (identity-crypto setup
 * only; no DB / DOM / wasm-host), so the dry run stays green and fast.
 *
 * NOTE: this NO LONGER mirrors `stryker.oracle.config.mjs`'s pinned
 * one-file subset, so `scripts/stryker-parity.ts` (mutation:parity) will
 * diverge — the oracle is still scoped to `handlers.test.ts`. The parity
 * harness and this adequacy campaign are different things now; treat the
 * parity check as stale until the oracle is re-pointed (or retired).
 *
 * Test-file selection + setup injection go through env vars the runner
 * plugin reads (`;`-separated, cwd-relative, resolved into the sandbox).
 */
import { readdirSync } from 'node:fs';

// CRITICAL: paths are RELATIVE-TO-CWD, not absolute. Stryker copies the
// workspace into a sandbox (`.stryker-tmp/native/sandbox-XXX/`) and spawns
// its test-runner workers with cwd = sandbox. The plugin resolves relative
// entries against that cwd, so a test's `'../src/index.ts'` import and a
// cwd-relative setup file load the SAME sandbox module instance. Absolute
// real-repo paths would load two instances ⇒ "identity Crypto not configured".

// Test files: the full identity unit suite. Enumerated (not discovered)
// so the campaign stays scoped to identity — discovery would pull the
// whole repo (incl. wasm-host worker tests that OOM under one-process load).
//
// EXCLUDED: saml-acs.test.ts and webauthn.test.ts hold throwing-TODO
// placeholder tests (`throw new Error('TODO: implement this test')`) for
// crypto-bearing branches that are covered by integration / Layer-3 e2e
// instead. They're red by design, and Stryker aborts the campaign on ANY
// failing test in the initial run — so they can't be in the set. Their
// handlers (saml-acs.ts, webauthn-*.ts) consequently surface as
// NoCoverage mutants: honest signal that they carry no green unit suite.
const UNIT_DIR = 'modules/identity/test/unit';
const RED_BY_DESIGN = new Set(['saml-acs.test.ts', 'webauthn.test.ts']);
const TEST_FILES = [
  'modules/identity/test/handlers.test.ts',
  ...readdirSync(UNIT_DIR)
    .filter((f) => f.endsWith('.test.ts') && !RED_BY_DESIGN.has(f))
    .map((f) => `${UNIT_DIR}/${f}`),
];
process.env['ATLAS_STRYKER_TEST_FILES'] = TEST_FILES.join(';');

// Setup: identity Crypto wired onto the SANDBOX identity instance
// (sandbox-path variant of test-setup/identity-crypto.ts). The identity
// unit tests need no DOM, so linkedom-shims is intentionally omitted.
process.env['ATLAS_STRYKER_SETUP_FILES'] = 'scripts/stryker-oracle-setup.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'node-test',
  plugins: ['@atlas/stryker-runner-node-test'],

  // Every handler in the identity module (glob). Registry/index files are
  // included but generate few/low-value mutants. Handlers with no unit
  // test surface as NoCoverage mutants — that's the signal we want.
  mutate: ['modules/identity/src/handlers/*.ts'],

  reporters: ['json', 'html', 'progress'],
  htmlReporter: {
    fileName: 'reports/mutation/native-latest.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/native-latest.json',
  },

  timeoutMS: 30_000,
  concurrency: 2,

  coverageAnalysis: 'off',
  checkers: [],
  tempDirName: '.stryker-tmp/native',
  disableTypeChecks: false,
};
