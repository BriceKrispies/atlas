/**
 * BDD config for `@server`-tagged scenarios that drive the real
 * `apps/server` stack (Postgres + smtp4dev + Node + Hono) instead of
 * the IndexedDB `apps/sim` harness.
 *
 * Sibling to `playwright.bdd.config.ts`. The sim config is the default
 * (`pnpm bdd`) and runs every non-`@server` scenario in
 * `tests/bdd/features/`. This config is opt-in (`pnpm bdd:server`) and
 * runs ONLY the tenancy server-stack scenarios at
 * `tests/bdd/features/tenancy/**`. Scenarios in this set are tagged
 * `@server` to keep the existing `@sim`-tagged hooks
 * (`tests/bdd/support/hooks.ts`) from firing.
 *
 * `webServer` orchestrates the full stack:
 *
 *   1. `make db-up` brings up the control-plane Postgres on `:15433` AND
 *      runs both control-plane + tenant migrations. The command exits
 *      after the DB is healthy; Playwright then probes port 15433.
 *   2. `pnpm smtp:up` brings up smtp4dev: SMTP on `:1025`, web UI + REST
 *      `/api/Messages` on `:5080`. Playwright probes `:5080`.
 *   3. `pnpm --filter @atlas/server dev` boots Hono on `:3000` with the
 *      canonical dev env (test-auth on, mailer pointed at smtp4dev,
 *      cookies relaxed for cross-subdomain redirect, COOKIE_DOMAIN set
 *      so the session cookie crosses `<slug>.localhost` boundaries).
 *
 * The Chromium `--host-resolver-rules` arg below is the Windows fix
 * documented in `tests/integration/public-signup.itest.ts`'s header:
 * Linux glibc + macOS auto-resolve `*.localhost` to 127.0.0.1, Windows
 * does not. Without this flag the magic-link redirect to
 * `<slug>.localhost:3000` would time out on Windows. The flag is benign
 * on Linux/macOS.
 *
 * Spec: specs/domains/tenancy/capabilities/public-signup/README.md
 */
import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: ['tests/bdd/features/tenancy/**/*.feature'],
  steps: ['tests/bdd/steps/tenancy/**/*.ts', 'tests/bdd/support/**/*.ts'],
  outputDir: '.features-gen/bdd-server',
});

const CONTROL_PLANE_DB_URL =
  process.env['CONTROL_PLANE_DB_URL'] ??
  'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';

export default defineConfig({
  testDir,
  fullyParallel: false, // server-stack scenarios share a control-plane DB
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,

  outputDir: 'tests/bdd/screenshots-server',

  reporter: [
    ['html', { outputFolder: 'tests/bdd/report-server', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    extraHTTPHeaders: {
      // Hint to the server that this is an automated harness. The server
      // doesn't gate on this today; it just makes harness traffic easier
      // to grep out of log streams.
      'X-Atlas-Test-Harness': 'bdd-server',
    },
  },

  webServer: [
    {
      // Brings up Postgres + runs migrations + seeds dev rows. Idempotent.
      command: process.platform === 'win32' ? 'make db-up' : 'make db-up',
      port: 15433,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm smtp:up',
      // smtp4dev's web UI port — also serves the REST `/api/Messages`
      // endpoint the BDD assertions poll. SMTP itself is on :1025 but
      // Playwright's webServer probe doesn't distinguish.
      port: 5080,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @atlas/server dev',
      port: 3000,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      // Force the dev-friendly + smtp4dev-wired config. Anything the
      // user has in their shell env that conflicts gets overridden here
      // so the harness is reproducible.
      env: {
        CONTROL_PLANE_DB_URL,
        TEST_AUTH_ENABLED: 'true',
        MAILER_MODE: 'smtp',
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1025',
        SMTP_FROM: 'noreply@atlas.local',
        TENANT_APEX: 'localhost',
        INSECURE_COOKIES: 'true',
        COOKIE_DOMAIN: '.localhost',
        PUBLIC_BASE_URL: 'http://localhost:3000',
        INGRESS_PORT: '3000',
        POLICY_ENGINE: 'stub',
        WORKER_MODE: 'inline',
        ATLAS_ENVIRONMENT: 'test',
      },
    },
  ],

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Windows fix — Linux/macOS resolve *.localhost natively; Windows
        // does not. Benign on the other two. See file header.
        launchOptions: {
          args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
        },
      },
    },
  ],
});
