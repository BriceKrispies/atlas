import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Vitest runs only unit tests under packages/*/test/ and packages/*/src/.
// Playwright specs (apps/**/tests, apps/**/*.test.ts, tests/integration/**)
// run via `pnpm test:e2e` / `pnpm test:integration` and MUST NOT be
// collected here — Playwright's test.describe errors out when imported by
// another runner.
//
// Workspace-package aliases are provided so tests outside any pnpm package
// (e.g. tests/parity/) can resolve @atlas/* imports the same way pnpm-linked
// packages do at test time.
const r = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

// Pin the project root to the config-file directory so glob patterns in
// `test.include` (e.g. `modules/*/test/**`) always resolve from the repo
// root, regardless of where vitest is invoked from. Without this,
// `pnpm --filter @atlas/X test` (which cd's into the workspace package)
// would resolve globs relative to that package and silently match zero
// files — exiting with "No test files found".
const ROOT = r('.');

export default defineConfig({
  root: ROOT,
  resolve: {
    alias: {
      '@atlas/platform-core/spec-validate': r('./packages/platform-core/src/spec-validate/index.ts'),
      '@atlas/platform-core': r('./packages/platform-core/src/index.ts'),
      '@atlas/schemas': r('./packages/schemas/src/index.ts'),
      '@atlas/ports': r('./ports/src/index.ts'),
      '@atlas/contract-tests': r('./packages/contract-tests/src/index.ts'),
      '@atlas/adapter-idb': r('./adapters/idb/src/index.ts'),
      '@atlas/adapter-node': r('./adapters/node/src/index.ts'),
      '@atlas/adapter-policy-stub': r('./adapters/policy-stub/src/index.ts'),
      '@atlas/adapter-policy-cedar': r('./adapters/policy-cedar/src/index.ts'),
      '@atlas/ingress': r('./packages/ingress/src/index.ts'),
      '@atlas/catalog': r('./modules/catalog/src/index.ts'),
      '@atlas/authz': r('./modules/authz/src/index.ts'),
      '@atlas/content-pages': r(
        './modules/content-pages/src/index.ts',
      ),
      '@atlas/metrics': r('./packages/metrics/src/index.ts'),
      '@atlas/wasm-host': r('./packages/wasm-host/src/index.ts'),
      '@atlas/identity': r('./modules/identity/src/index.ts'),
    },
  },
  test: {
    // Global DOM shims for linkedom (CSSStyleSheet, ElementInternals,
    // FormData, adoptedStyleSheets). See test-setup/linkedom-shims.ts.
    // identity-crypto wires the identity module's Crypto resolver to a
    // node-backed impl so tests that call into identity don't need to
    // remember to set it themselves (closes ADR 0008 leak #1 ergonomically).
    setupFiles: [
      './test-setup/linkedom-shims.ts',
      './test-setup/identity-crypto.ts',
    ],
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'packages/*/tests/**/*.test.ts',
      'modules/*/test/**/*.test.ts',
      'modules/*/src/**/*.test.ts',
      'adapters/*/test/**/*.test.ts',
      'adapters/*/src/**/*.test.ts',
      'ports/test/**/*.test.ts',
      'ports/src/**/*.test.ts',
      'bundles/*/test/**/*.test.ts',
      'tests/parity/**/*.test.ts',
      // apps/projection-worker is a node-only worker — Vitest tests only,
      // no Playwright specs to conflict with.
      'apps/projection-worker/test/**/*.test.ts',
      'apps/projection-worker/src/**/*.test.ts',
      // apps/atlasctl is a node-only CLI — Vitest only, same pattern.
      'apps/atlasctl/test/**/*.test.ts',
      'apps/atlasctl/src/**/*.test.ts',
      // apps/server is a Node-only Hono service — Vitest only, no Playwright specs.
      'apps/server/test/**/*.test.ts',
      'apps/server/src/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test-results/**',
      // Frontend / server / sandbox apps host Playwright specs (test.describe
      // from @playwright/test) which Vitest must not collect — they crash on
      // import. Listed individually instead of `apps/**` so apps that are
      // legitimately Vitest-only (projection-worker) can opt in via include.
      'apps/admin/**',
      'apps/authoring/**',
      'apps/sandbox/**',
      'apps/sim/**',
      'apps/control-plane/**',
      'tests/integration/**',
      'tests/blackbox/**',
    ],
    // Coverage is report-only for now: surfaced in CI as an LCOV artifact
    // and printed locally via `pnpm coverage`. No thresholds are gated yet
    // — gather a baseline first, then introduce per-module floors.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'modules/*/src/**/*.ts',
        'adapters/*/src/**/*.ts',
        'ports/src/**/*.ts',
        'packages/*/src/**/*.ts',
        'apps/server/src/**/*.ts',
        'apps/projection-worker/src/**/*.ts',
        'apps/atlasctl/src/**/*.ts',
      ],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/test/**',
        '**/tests/**',
        '**/index.ts',
        '**/types.ts',
        '**/generated/**',
      ],
    },
  },
});
