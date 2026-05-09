/**
 * Public signup routes.
 *
 * The first thin vertical slice. Three endpoints + two static HTML
 * pages, all mounted in the **public** group (no principalMiddleware):
 *
 *   GET  /signup              → HTML form
 *   POST /api/v1/signup       → calls Tenancy.Signup.Submit
 *   GET  /signup/confirm      → HTML "click to confirm" page (token in qs)
 *   POST /signup/confirm      → calls Identity.Invite.Accept against the
 *                               provisioned tenant; sets session cookie
 *                               with Domain=COOKIE_DOMAIN; 302s to
 *                               http://<slug>.<apex>:<port>/
 *
 * The HTML pages are inline templates — no Vite SPA, no design-package
 * build step required for this slice. SPA-shell replacement is deferred
 * to a future slice (see
 * `specs/domains/tenancy/capabilities/public-signup/README.md`
 * "NOT in Scope").
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  PostgresEntityStore,
  PostgresEventStore,
  PostgresRelationStore,
} from '@atlas/adapter-node';
import {
  handleInviteAccept,
  handleInviteIssue,
  identityDispatcher,
  IdentityError,
} from '@atlas/identity';
import {
  handleSignupSubmit,
  TenancyError,
} from '@atlas/tenancy';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse, mapError } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import { buildSessionCookie } from '../middleware/cookie.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

interface SignupSubmitBody {
  email?: unknown;
  tenantSlug?: unknown;
  organizationName?: unknown;
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlResponse(c: AppCtx, body: string, status = 200): Response {
  return c.body(body, status as 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

const SIGNUP_FORM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sign up — Atlas</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font: 14px/1.4 system-ui, sans-serif; max-width: 520px; margin: 4rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.5rem; margin: 0 0 1rem; }
  p { color: #555; }
  label { display: block; margin: 1rem 0 .25rem; font-weight: 600; }
  input { width: 100%; box-sizing: border-box; padding: .55rem .65rem; font: inherit; border: 1px solid #ccc; border-radius: 6px; min-height: 44px; }
  button { margin-top: 1.25rem; padding: .6rem 1rem; font: inherit; font-weight: 600; background: #111; color: #fff; border: 0; border-radius: 6px; cursor: pointer; min-height: 44px; }
  @media (hover: hover) {
    button:hover { background: #333; }
  }
  .hint { font-size: 12px; color: #777; margin-top: .25rem; }
  .error { color: #b00; margin-top: 1rem; padding: .5rem .75rem; background: #fee; border-radius: 6px; display: none; }
  .ok { color: #050; margin-top: 1rem; padding: .5rem .75rem; background: #efe; border-radius: 6px; display: none; }
</style>
</head>
<body>
  <h1>Sign up for Atlas</h1>
  <p>Pick a tenant slug for your organization. Once an admin approves, you'll get a magic-link email to sign in at <code>&lt;slug&gt;.localhost</code>.</p>
  <form id="f">
    <label for="organizationName">Organization name</label>
    <input id="organizationName" data-testid="public-signup.organization-name" required maxlength="200">
    <label for="tenantSlug">Tenant slug</label>
    <input id="tenantSlug" data-testid="public-signup.tenant-slug" required pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" maxlength="63">
    <div class="hint">Lowercase letters, digits, hyphens. 1–63 chars. Becomes <code>&lt;slug&gt;.localhost</code>.</div>
    <label for="email">Email</label>
    <input id="email" data-testid="public-signup.email" type="email" required>
    <button type="submit" data-testid="public-signup.submit">Submit</button>
    <div class="error" id="err" data-testid="public-signup.error" role="alert" aria-live="polite"></div>
    <div class="ok" id="ok" data-testid="public-signup.success" role="alert" aria-live="polite"></div>
  </form>
<script>
const f = document.getElementById('f');
const err = document.getElementById('err');
const ok = document.getElementById('ok');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.style.display = 'none';
  ok.style.display = 'none';
  const body = {
    email: document.getElementById('email').value.trim(),
    tenantSlug: document.getElementById('tenantSlug').value.trim().toLowerCase(),
    organizationName: document.getElementById('organizationName').value.trim(),
  };
  const res = await fetch('/api/v1/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    err.textContent = (j.error && j.error.message) || 'Signup failed.';
    err.style.display = 'block';
    return;
  }
  ok.textContent = 'Submitted. An admin will review your request — when approved you\\'ll receive a magic-link email.';
  ok.style.display = 'block';
  f.reset();
});
</script>
</body>
</html>`;

function confirmHtml(token: string, tenantId: string, email: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Confirm your account — Atlas</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font: 14px/1.4 system-ui, sans-serif; max-width: 520px; margin: 4rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.5rem; }
  button { padding: .6rem 1rem; font: inherit; font-weight: 600; background: #111; color: #fff; border: 0; border-radius: 6px; cursor: pointer; min-height: 44px; }
  @media (hover: hover) {
    button:hover { background: #333; }
  }
  .error { color: #b00; margin-top: 1rem; padding: .5rem .75rem; background: #fee; border-radius: 6px; display: none; }
</style>
</head>
<body>
  <h1>Welcome to Atlas</h1>
  <p>Click the button below to finish setting up <strong>${escapeHtml(email)}</strong>. We'll sign you in and take you to your tenant's home page at <code>${escapeHtml(tenantId)}.localhost</code>.</p>
  <form id="f">
    <input type="hidden" id="token" value="${escapeHtml(token)}">
    <input type="hidden" id="tenantId" value="${escapeHtml(tenantId)}">
    <input type="hidden" id="email" value="${escapeHtml(email)}">
    <button type="submit" data-testid="public-signup-confirm.submit">Sign in</button>
    <div class="error" id="err" role="alert" aria-live="polite"></div>
  </form>
<script>
const f = document.getElementById('f');
const err = document.getElementById('err');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.style.display = 'none';
  const body = {
    presentedToken: document.getElementById('token').value,
    tenantId: document.getElementById('tenantId').value,
    acceptedEmail: document.getElementById('email').value,
  };
  const res = await fetch('/signup/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    err.textContent = (j.error && j.error.message) || 'Confirmation failed.';
    err.style.display = 'block';
    return;
  }
  // Server returns 200 + { redirect } on success. Navigate the browser
  // ourselves so the new session cookie is sent on the GET to the
  // tenant's apex URL.
  if (j.redirect) {
    window.location.href = j.redirect;
    return;
  }
  err.textContent = 'Confirmation failed.';
  err.style.display = 'block';
});
</script>
</body>
</html>`;
}

export function signupRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  // ----- HTML form ----------------------------------------------------
  app.get('/signup', (c: AppCtx) => htmlResponse(c, SIGNUP_FORM_HTML));

  // ----- Submit -------------------------------------------------------
  app.post('/api/v1/signup', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    let body: SignupSubmitBody;
    try {
      body = (await c.req.json()) as SignupSubmitBody;
    } catch {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'invalid JSON body', 400, correlationId);
    }
    const email = readString(body.email);
    const tenantSlug = readString(body.tenantSlug);
    const organizationName = readString(body.organizationName);
    if (!email || !tenantSlug || !organizationName) {
      return errorResponse(
        c,
        'SCHEMA_VALIDATION_FAILED',
        'email, tenantSlug, organizationName are required',
        400,
        correlationId,
      );
    }
    try {
      const result = await handleSignupSubmit(
        { email, tenantSlug, organizationName, correlationId },
        { signupRequests: state.signupRequests, logger: c.get('ctx').logger },
      );
      return c.json(
        {
          signupId: result.signup.signupId,
          status: result.signup.status,
          preexisting: result.preexisting,
        },
        202,
      );
    } catch (e) {
      if (e instanceof TenancyError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      return mapError(c, e, correlationId);
    }
  });

  // ----- Confirm (HTML page) ------------------------------------------
  app.get('/signup/confirm', (c: AppCtx) => {
    const token = c.req.query('token') ?? '';
    const tenantId = c.req.query('tenantId') ?? '';
    const email = c.req.query('email') ?? '';
    if (!token || !tenantId || !email) {
      return htmlResponse(
        c,
        '<!DOCTYPE html><html><body><h1>Invalid link</h1><p>Magic-link is missing one of token, tenantId, email.</p></body></html>',
        400,
      );
    }
    return htmlResponse(c, confirmHtml(token, tenantId, email));
  });

  // ----- Confirm (POST) -----------------------------------------------
  app.post('/signup/confirm', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    interface ConfirmBody {
      tenantId?: unknown;
      presentedToken?: unknown;
      acceptedEmail?: unknown;
    }
    let body: ConfirmBody;
    try {
      body = (await c.req.json()) as ConfirmBody;
    } catch {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'invalid JSON body', 400, correlationId);
    }
    const tenantId = readString(body.tenantId);
    const presentedToken = readString(body.presentedToken);
    const acceptedEmail = readString(body.acceptedEmail);
    if (!tenantId || !presentedToken || !acceptedEmail) {
      return errorResponse(
        c,
        'SCHEMA_VALIDATION_FAILED',
        'tenantId, presentedToken, acceptedEmail are required',
        400,
        correlationId,
      );
    }

    let sql: import('postgres').Sql;
    try {
      sql = await ensureTenantMigrated(state, tenantId);
    } catch (e) {
      c.get('ctx').logger.warn('tenant migrate failed; returning 404', {
        event: 'Tenancy.EnsureMigrated.Failed',
        properties: {
          tenantId,
          route: 'signup.confirm',
          cause: (e as Error).message,
        },
      });
      return errorResponse(c, 'NOT_FOUND', `tenant not found: ${tenantId}`, 404, correlationId);
    }
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);

    try {
      const result = await handleInviteAccept(
        {
          tenantId,
          correlationId,
          principalId: null,
          presentedToken,
          acceptedEmail,
        },
        eventStore,
        entities,
      );
      const dispatch = identityDispatcher({ entities, relations });
      for (const f of result.follow) await dispatch(f);
      await dispatch(result.envelope);

      // Set the session cookie on the parent domain so the redirect
      // target (`<slug>.<apex>`) carries it. INSECURE_COOKIES drops
      // `Secure` on plain http.
      if (result.sessionResult) {
        c.header(
          'Set-Cookie',
          buildSessionCookie({
            payload: result.sessionResult.cookiePayload,
            secure: !state.config.insecureCookies,
            ...(state.config.cookieDomain
              ? { domain: state.config.cookieDomain }
              : {}),
          }),
          { append: true },
        );
      }

      const redirect = state.config.tenantBaseUrl(tenantId);
      // Return 200 with the redirect target in the body. The client
      // navigates with `window.location.href` so the new session
      // cookie is attached to the follow-up GET. We previously sent
      // 303 + Location, but cross-origin auto-follow is opaque in
      // some browsers (res.redirected/url are unreliable) and 303 is
      // outside `res.ok`, so the form's error branch fired instead
      // of the redirect.
      return c.body(JSON.stringify({ redirect }), 200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
    } catch (e) {
      if (e instanceof IdentityError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      return mapError(c, e, correlationId);
    }
  });

  return app;
}

/**
 * Helper used by `admin-signups.ts` to mint the magic-link invite
 * inside the new tenant. Lives here because both files share the
 * "spin up per-tenant adapters + dispatch InviteIssued" sequence.
 */
export async function issueInviteForTenant(
  state: AppState,
  input: { tenantId: string; email: string; correlationId: string },
): Promise<{ plaintextToken: string }> {
  const sql = await ensureTenantMigrated(state, input.tenantId);
  const eventStore = new PostgresEventStore(sql);
  const entities = new PostgresEntityStore(sql);
  const relations = new PostgresRelationStore(sql);
  const result = await handleInviteIssue(
    {
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      principalId: null,
      email: input.email,
      rolesOnAccept: ['admin'],
    },
    eventStore,
  );
  await identityDispatcher({ entities, relations })(result.envelope);
  return { plaintextToken: result.plaintextToken };
}
