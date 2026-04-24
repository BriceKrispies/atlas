import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps',
  testMatch: '**/*.test.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  ...(process.env['CI'] ? { workers: 1 } : {}),
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:5199',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm --filter @atlas/admin dev --port 5199',
    port: 5199,
    reuseExistingServer: !process.env['CI'],
    env: {
      VITE_BACKEND: 'http',
      VITE_API_URL: 'http://localhost:9999',
    },
  },
});
