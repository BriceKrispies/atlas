/**
 * Admin SPA static-serve route group — same-origin SPA + API.
 *
 * Structural extraction for the §11 retro at
 * `tickets/archive/kernel-extraction/admin-spa-cors-for-i20-bdd.md`
 * (the predecessor finding; architect archives that predecessor after
 * gating this slice — the new retro at
 * `tickets/kernel-extraction/admin-spa-serve-static.md` documents the
 * extraction landing).
 *
 * The previous I20 BDD demonstration assumed Vite-served admin SPA on
 * one port and Hono apps/server on `:3000` could fetch each other. The
 * browser refuses that without CORS — and apps/server ships no CORS
 * middleware. Option (b) from the predecessor retro §3: serve the admin
 * SPA's built artefacts from apps/server, eliminating the cross-origin
 * reality in both the BDD path and prod.
 *
 * Mount: at the root, AFTER every `/api/*`, `/oauth/*`, `/saml/*`,
 * `/scim/*`, `/healthz`, `/readyz`, `/metrics`, `/signup`, `/docs`
 * route group. Hono dispatches routes in mount order — adding this
 * group last lets the API routes take precedence and the SPA absorbs
 * everything else with a hash-route SPA fallback.
 *
 * Build artefact location: `apps/admin/vite.config.ts` sets
 * `build.outDir = '../../dist/admin'`, so artefacts land at
 * `<repo>/dist/admin/` (relative to the repo root). apps/server's CWD
 * when running `pnpm --filter @atlas/server dev` is `apps/server/`,
 * so `serveStatic`'s `root` (relative to CWD) is `../../dist/admin`.
 *
 * SPA fallback model: for every GET that is NOT an API / auth-protocol
 * surface, `serveStatic` first attempts a file match against
 * `dist/admin/<path>`; on a miss the `onNotFound` hook rewrites to
 * `index.html` so client-side hash routing (`#/users`, `#/login`, …)
 * resolves. Hash routes never reach the server — the browser strips
 * the fragment — so the SPA-fallback only needs to catch deep path
 * loads (which the admin shell doesn't use today, but we want robust
 * if someone bookmarks `/users` directly).
 *
 * If `dist/admin/index.html` does not exist (admin build hasn't run),
 * the SPA route returns 503 with a clear message so the operator
 * understands the failure category — same shape as `/readyz`'s
 * unavailable response. The BDD harness's webServer chain runs
 * `vite build` before apps/server boots so this branch should be
 * unreachable under test.
 */
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppState } from '../bootstrap.ts';

const ADMIN_DIST_ROOT_REL = '../../dist/admin';

/**
 * Paths that MUST remain handled by other route groups, not the SPA.
 * The catch-all below explicitly skips them so a misordered mount
 * (someone moves this above /api in main.ts) still doesn't shadow the
 * API. Belt-and-braces: defensive against future refactors.
 */
const RESERVED_PREFIXES: readonly string[] = [
    '/api/',
    '/oauth/',
    '/saml/',
    '/scim/',
    '/healthz',
    '/readyz',
    '/metrics',
    '/signup',
    '/docs',
];

function isReserved(path: string): boolean {
    for (const prefix of RESERVED_PREFIXES) {
        if (path === prefix || path.startsWith(prefix)) return true;
    }
    return false;
}

export function adminSpaRoutes(_state: AppState): Hono {
    const app = new Hono();
    const indexHtmlAbs = resolve(process.cwd(), ADMIN_DIST_ROOT_REL, 'index.html');

    // Asset path — fingerprinted files under /assets/*. serveStatic
    // resolves files relative to CWD via the `root` field.
    app.get(
        '/assets/*',
        serveStatic({
            root: ADMIN_DIST_ROOT_REL,
        }),
    );

    // SPA catch-all (GET only). Any reserved path passed through here
    // by route-order mistake gets explicitly rejected so the API never
    // gets accidentally shadowed. For matches, return index.html so
    // the SPA's hash router takes over.
    app.get('*', async function (c) {
        const path = new URL(c.req.url).pathname;
        if (isReserved(path)) {
            // Should be unreachable when this group is mounted last,
            // but the guard is cheap and self-documenting.
            return c.notFound();
        }
        if (!existsSync(indexHtmlAbs)) {
            return c.json(
                {
                    status: 'unavailable',
                    reason: 'admin SPA build not found',
                    expected: indexHtmlAbs,
                    hint: 'run `pnpm --filter @atlas/admin build` before serving',
                },
                503,
            );
        }
        // Serve index.html as the SPA bootstrap document. We rewrite
        // the request path so serveStatic picks `index.html` regardless
        // of the original deep path.
        const handler = serveStatic({
            root: ADMIN_DIST_ROOT_REL,
            rewriteRequestPath: function () {
                return '/index.html';
            },
        });
        let fellThrough = false;
        const result = await handler(c, async function (): Promise<void> {
            // serveStatic invokes next() if it can't find the file —
            // record that and fall through to a 503 below.
            fellThrough = true;
        });
        if (fellThrough || result === undefined) {
            return c.json(
                {
                    status: 'unavailable',
                    reason: 'admin SPA build not found',
                    expected: indexHtmlAbs,
                },
                503,
            );
        }
        return result;
    });

    return app;
}
