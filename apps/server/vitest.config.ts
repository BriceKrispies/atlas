import { defineConfig } from 'vitest/config';

// Local override so apps/server tests are collected. The repo-root
// vitest.config.ts excludes `apps/**` because Playwright specs live
// under apps/admin etc. — but apps/server is a Node service whose
// unit tests use vitest. This config narrows the include/exclude so
// `pnpm --filter @atlas/server test` finds them.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
