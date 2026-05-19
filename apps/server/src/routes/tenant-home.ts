/**
 * Tenant home — the minimal landing page served at `/` of any
 * registered custom-domain host (`<slug>.localhost`).
 *
 * Lives in the public group because the host alone determines whether
 * we render. We resolve the session inline (cookie → AuthSession →
 * User) so the welcome line can show the signed-in email; if no valid
 * session is present we render a "sign-in required" stub. PR3 swaps
 * the stub for the magic-link login form.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { PostgresEntityStore } from '@atlas/adapter-node';
import { constantTimeEqual, getSessionEntity, getUserEntity, hashSecret, } from '@atlas/identity';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { parseSessionCookie } from '../middleware/cookie.ts';
import { resolveHostTenant } from '../middleware/tenant-resolution.ts';
import type { ServerVariables } from '../middleware/principal.ts';
type AppCtx = Context<{
    Variables: ServerVariables;
}>;
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function renderWelcome(tenantName: string, email: string | null): string {
    const safeName = escapeHtml(tenantName);
    const greet = email
        ? `Signed in as <strong>${escapeHtml(email)}</strong>`
        : `Not signed in.`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeName} — Atlas</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font: 14px/1.4 system-ui, sans-serif; max-width: 520px; margin: 4rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.75rem; margin: 0 0 .5rem; }
  p { color: #555; }
  .ok { padding: .75rem 1rem; background: #efe; border-radius: 6px; margin-bottom: 1rem; }
  ul { list-style: none; padding: 0; }
  li { padding: .5rem 0; border-top: 1px solid #eee; }
  a { color: #0066cc; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="ok">Welcome to <strong>${safeName}</strong></div>
  <p>${greet}</p>
  <ul>
    <li><a href="/api/v1/identity/sessions">My sessions (JSON)</a></li>
    <li><a href="/api/v1/identity/session/logout" onclick="event.preventDefault(); fetch('/api/v1/identity/session/logout', {method:'POST', credentials:'include'}).then(()=>location.reload());">Sign out</a></li>
  </ul>
</body>
</html>`;
}
const NOT_REGISTERED_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Atlas</title></head>
<body style="font:14px system-ui;max-width:480px;margin:4rem auto;padding:0 1rem">
<h1>Atlas</h1>
<p>This host isn't registered. <a href="/signup">Sign up</a> to claim it.</p>
</body></html>`;
export function tenantHomeRoutes(state: AppState): Hono<{
    Variables: ServerVariables;
}> {
    const app = new Hono<{
        Variables: ServerVariables;
    }>();
    app.get('/', async function (c: AppCtx) {
        const hostTenantId = await resolveHostTenant(c.req.header('host'), state.customDomains, state.customDomainCache);
        if (!hostTenantId) {
            return c.body(NOT_REGISTERED_HTML, 200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            });
        }
        const tenant = await state.tenants.get(hostTenantId);
        const tenantName = tenant?.name ?? hostTenantId;
        // Resolve session for the welcome line. Best-effort: any failure
        // here renders the "not signed in" variant instead of erroring out.
        let email: string | null = null;
        const cookie = parseSessionCookie(c.req.header('cookie'));
        if (cookie) {
            try {
                const sql = await ensureTenantMigrated(state, hostTenantId);
                const entities = new PostgresEntityStore(sql);
                const session = await getSessionEntity(entities, hostTenantId, cookie.sessionId);
                if (session &&
                    constantTimeEqual(session.refreshTokenHash, hashSecret(cookie.refreshSecret))) {
                    const user = await getUserEntity(entities, hostTenantId, session.userId);
                    email = user?.email ?? null;
                }
            }
            catch {
                // ignore — render the "not signed in" variant
            }
        }
        return c.body(renderWelcome(tenantName, email), 200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
        });
    });
    return app;
}
