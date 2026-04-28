import { defineConfig } from 'vitest/config';

// Vitest runs only unit tests under packages/*/test/ and packages/*/src/.
// Playwright specs (apps/**/tests, apps/**/*.test.ts, tests/integration/**)
// run via `pnpm test:e2e` / `pnpm test:integration` and MUST NOT be
// collected here — Playwright's test.describe errors out when imported by
// another runner.
export default defineConfig({
  test: {
    // Global DOM shims for linkedom (CSSStyleSheet, ElementInternals,
    // FormData, adoptedStyleSheets). See test-setup/linkedom-shims.ts.
    setupFiles: ['./test-setup/linkedom-shims.ts'],
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'bundles/*/test/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test-results/**',
      'apps/**',
      'tests/**',
    ],
  },
});
