/**
 * Session-cookie helpers.
 *
 * Wire shape:
 *   `atlas_session=<sessionId>.<refreshSecret>; HttpOnly; Secure;
 *    SameSite=Strict; Path=/; Max-Age=<...>`
 *
 * The `<sessionId>` prefix lets `/refresh` resolve the AuthSession in
 * O(1) without a hash scan (the session row's `refreshTokenHash` is
 * verified against the trailing `<refreshSecret>` after lookup).
 *
 * `Secure` is omitted when `INSECURE_COOKIES=true` (dev only — the
 * Vite SPAs run on `http://localhost:<port>`, browsers refuse Secure
 * cookies on plain HTTP). Production deployments MUST NOT set this.
 */
const COOKIE_NAME = 'atlas_session';
const CSRF_COOKIE_NAME = 'atlas_csrf';
const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;
export interface ParsedSessionCookie {
    sessionId: string;
    refreshSecret: string;
}
/**
 * Parse the `atlas_session` cookie value. Returns null when the cookie
 * is missing, empty, or malformed (no `.` separator).
 */
export function parseSessionCookie(cookieHeader: string | undefined): ParsedSessionCookie | null {
    if (!cookieHeader)
        return null;
    const cookies = cookieHeader.split(';').map(function (c) {
        return c.trim();
    });
    for (const c of cookies) {
        const eq = c.indexOf('=');
        if (eq <= 0)
            continue;
        const name = c.slice(0, eq).trim();
        if (name !== COOKIE_NAME)
            continue;
        const value = c.slice(eq + 1).trim();
        const dot = value.indexOf('.');
        if (dot <= 0 || dot === value.length - 1)
            return null;
        return {
            sessionId: value.slice(0, dot),
            refreshSecret: value.slice(dot + 1),
        };
    }
    return null;
}
export function readCsrfCookie(cookieHeader: string | undefined): string | null {
    if (!cookieHeader)
        return null;
    const cookies = cookieHeader.split(';').map(function (c) {
        return c.trim();
    });
    for (const c of cookies) {
        const eq = c.indexOf('=');
        if (eq <= 0)
            continue;
        const name = c.slice(0, eq).trim();
        if (name !== CSRF_COOKIE_NAME)
            continue;
        return c.slice(eq + 1).trim();
    }
    return null;
}
export interface BuildSessionCookieOptions {
    payload: string;
    maxAgeSeconds?: number;
    /**
     * Set false in dev (HTTP) so browsers accept the cookie. Default
     * true (production HTTPS).
     */
    secure?: boolean;
    /**
     * Optional `Domain=` attribute. In dev the signup-confirm flow sets
     * `.localhost` so a cookie minted on `localhost:3000` survives the
     * redirect to `<slug>.localhost:3000`. Omitted → host-only cookie.
     *
     * SameSite has to be relaxed when crossing host boundaries: the 303
     * from `/signup/confirm` to `<slug>.<apex>/` is a cross-origin
     * navigation that `SameSite=Strict` would block. We use
     * `SameSite=Lax` whenever a Domain is set, which still defends the
     * common CSRF surface (POST + non-GET) but lets the redirect carry
     * the cookie.
     */
    domain?: string;
}
export function buildSessionCookie(opts: BuildSessionCookieOptions): string {
    const maxAge = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
    const secure = opts.secure ?? true;
    const sameSite = opts.domain ? 'Lax' : 'Strict';
    const parts = [
        `${COOKIE_NAME}=${opts.payload}`,
        'Path=/',
        'HttpOnly',
        `SameSite=${sameSite}`,
        `Max-Age=${maxAge}`,
    ];
    if (opts.domain)
        parts.push(`Domain=${opts.domain}`);
    if (secure)
        parts.push('Secure');
    return parts.join('; ');
}
export function buildCsrfCookie(opts: {
    token: string;
    maxAgeSeconds?: number;
    secure?: boolean;
}): string {
    const maxAge = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
    const secure = opts.secure ?? true;
    // CSRF cookie is NOT HttpOnly — JS reads it to set the X-Atlas-Csrf
    // header. SameSite=Strict still gates it against cross-origin reads.
    const parts = [
        `${CSRF_COOKIE_NAME}=${opts.token}`,
        'Path=/',
        'SameSite=Strict',
        `Max-Age=${maxAge}`,
    ];
    if (secure)
        parts.push('Secure');
    return parts.join('; ');
}
/** Set-Cookie header value that clears the session cookie immediately. */
export function buildClearSessionCookie(secure: boolean = true): string {
    const parts = [
        `${COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        'Max-Age=0',
    ];
    if (secure)
        parts.push('Secure');
    return parts.join('; ');
}
export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const CSRF_COOKIE_HEADER = CSRF_COOKIE_NAME;
export const CSRF_REQUEST_HEADER = 'X-Atlas-Csrf';
