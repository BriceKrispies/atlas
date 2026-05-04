import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  // Feature files are the behavioral spec — they live under specs/domains/.
  // We list capabilities explicitly (rather than globbing all of
  // specs/domains/**) because most of those .feature files are authored
  // as aspirational specs without backing step definitions. As a
  // capability's steps land, add its directory here. Aspirational features
  // remain in the repo as specs; they just don't get run by BDD until
  // wired up.
  //
  // The legacy tests/bdd/features/ glob covers the example-domain wiring
  // smoke test until it's migrated or deleted.
  features: [
    'specs/domains/authoring/features/content-pages/**/*.feature',
    'specs/domains/catalog/features/family-publish/**/*.feature',
    'tests/bdd/features/**/*.feature',
  ],
  steps: ['tests/bdd/steps/**/*.ts', 'tests/bdd/support/**/*.ts'],
  outputDir: '.features-gen/bdd',
});

export default defineConfig({
  testDir,
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  ...(process.env['CI'] ? { workers: 1 } : {}),

  outputDir: 'tests/bdd/screenshots',

  reporter: [
    ['html', { outputFolder: 'tests/bdd/report', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: 'http://localhost:5182',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  // Boots `apps/sim` for the duration of the BDD run. VITE_BDD=true tells
  // `apps/sim/src/main.ts` to mount `window.__atlas_debug` (the probe
  // surface). Production builds of the harness leave it undefined.
  webServer: {
    command: 'pnpm --filter @atlas/sim dev --port 5182',
    port: 5182,
    reuseExistingServer: !process.env['CI'],
    env: { VITE_BDD: 'true' },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
