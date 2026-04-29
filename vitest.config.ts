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

export default defineConfig({
  resolve: {
    alias: {
      '@atlas/platform-core': r('./packages/platform-core/src/index.ts'),
      '@atlas/schemas': r('./packages/schemas/src/index.ts'),
      '@atlas/ports': r('./packages/ports/src/index.ts'),
      '@atlas/contract-tests': r('./packages/contract-tests/src/index.ts'),
      '@atlas/adapters-idb': r('./packages/adapters-idb/src/index.ts'),
      '@atlas/adapters-node': r('./packages/adapters-node/src/index.ts'),
      '@atlas/adapters-policy-stub': r('./packages/adapters-policy-stub/src/index.ts'),
      '@atlas/ingress': r('./packages/ingress/src/index.ts'),
      '@atlas/modules-catalog': r('./packages/modules-catalog/src/index.ts'),
    },
  },
  test: {
    // Global DOM shims for linkedom (CSSStyleSheet, ElementInternals,
    // FormData, adoptedStyleSheets). See test-setup/linkedom-shims.ts.
    setupFiles: ['./test-setup/linkedom-shims.ts'],
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'packages/*/tests/**/*.test.ts',
      'bundles/*/test/**/*.test.ts',
      'tests/parity/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test-results/**',
      'apps/**',
      'tests/integration/**',
      'tests/blackbox/**',
    ],
  },
});
