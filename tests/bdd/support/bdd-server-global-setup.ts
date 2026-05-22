/**
 * Global setup for `pnpm bdd:server` — builds the admin SPA into
 * `dist/admin/` so apps/server's `adminSpaRoutes` (mounted in
 * `apps/server/src/main.ts`) can serve `index.html` + `/assets/*`
 * same-origin with the API.
 *
 * Why `globalSetup` rather than a Playwright `webServer` entry:
 *
 *   - A `webServer` entry expects a long-running listener satisfying a
 *     port/URL probe. `vite build` is a one-shot that exits when done;
 *     there's no port to probe. Trying to model it as a webServer
 *     (`port: …, command: 'vite build'`) hangs Playwright until the
 *     timeout because the probe never gets a response.
 *   - `globalSetup` runs BEFORE every `webServer` entry, so apps/server
 *     starts with `dist/admin/` already populated. Exactly the order
 *     we need.
 *
 * Structural extraction for the §11 retro at
 * `tickets/kernel-extraction/admin-spa-serve-static.md`.
 *
 * Same-origin contract: the build sets `VITE_BACKEND=http` and
 * `VITE_API_URL=''` so `httpBackend.query()` / `.mutate()` issue
 * relative URLs (`/api/v1/...`), which the browser resolves against
 * the origin that served `index.html` — i.e. `http://acme.localhost:3000`.
 * No cross-origin reality, no CORS gap, no kernel touch on the
 * Hono cors middleware front.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-friendly __dirname. Playwright loads `globalSetup` modules under
// Node's ESM loader, so the classic `__dirname` is not defined; derive
// it from `import.meta.url` for the same effect.
const HERE = dirname(fileURLToPath(import.meta.url));

export default async function globalSetup(): Promise<void> {
  const repoRoot = resolve(HERE, '../../..');
  const indexHtml = resolve(repoRoot, 'dist/admin/index.html');
  if (process.env['SKIP_ADMIN_BUILD'] === '1' && existsSync(indexHtml)) {
    // Local-dev hatch: rebuilds are expensive (~30s) and break the
    // think-iterate-rerun loop. Skip if explicitly opted out and the
    // build is already present.
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[bdd-server-global-setup] building admin SPA → dist/admin');
  const result = spawnSync('pnpm', ['safe', '--filter', '@atlas/admin', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      VITE_BACKEND: 'http',
      // Empty API URL → httpBackend issues relative /api/v1 paths.
      // Browser resolves them against the document's origin, which is
      // whatever apps/server served the SPA from. Same-origin by
      // construction.
      VITE_API_URL: '',
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `[bdd-server-global-setup] admin SPA build failed with exit code ${result.status}`,
    );
  }
  if (!existsSync(indexHtml)) {
    throw new Error(
      `[bdd-server-global-setup] build completed but ${indexHtml} not found`,
    );
  }
  // eslint-disable-next-line no-console
  console.log('[bdd-server-global-setup] admin SPA build complete');
}
