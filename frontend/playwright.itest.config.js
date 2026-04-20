import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  testMatch: '**/*.itest.js',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: process.env.TEST_RESULTS_DIR || './test-results-integration' }],
    ['list'],
  ],

  use: {
    baseURL: 'http://localhost:5199',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'integration',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No webServer — the entrypoint script handles starting all services
});
