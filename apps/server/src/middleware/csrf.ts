/**
 * CSRF middleware — double-submit token.
 *
 * Skipped for:
 *   - Safe methods (GET, HEAD, OPTIONS, TRACE).
 *   - Bearer-auth paths (no `atlas_session` cookie was sent → the
 *     request can't be a CSRF). API keys + OAuth tokens flow through
 *     `Authorization: Bearer ...` and never set the session cookie.
 *
 * Enforced for any mutating request that DID present an
 * `atlas_session` cookie. The `atlas_csrf` cookie value must equal
 * the `X-Atlas-Csrf` request header.
 *
 * On miss/mismatch: 403 with `CSRF_FAILED`.
 */
import type { Context, Next } from 'hono';
import { CSRF_REQUEST_HEADER, parseSessionCookie, readCsrfCookie, } from './cookie.ts';
import { errorResponse } from './errors.ts';
import { correlationIdFor } from './correlation.ts';
import type { ServerVariables } from './principal.ts';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);
export function csrfMiddleware() {
    return async function (c: Context<{
        Variables: ServerVariables;
    }>, next: Next): Promise<Response | void> {
        const method = c.req.method.toUpperCase();
        if (SAFE_METHODS.has(method)) {
            await next();
            return;
        }
        const cookie = c.req.header('cookie');
        const session = parseSessionCookie(cookie);
        if (!session) {
            // No session cookie → not a cookie-driven request. Bearer-auth
            // paths fall through here.
            await next();
            return;
        }
        const csrfCookie = readCsrfCookie(cookie);
        const csrfHeader = c.req.header(CSRF_REQUEST_HEADER);
        if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
            const correlationId = correlationIdFor(c);
            return errorResponse(c, 'CSRF_FAILED', 'CSRF token missing or mismatched', 403, correlationId);
        }
        await next();
        return;
    };
}
