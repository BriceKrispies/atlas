/**
 * Loopback guard — mirrors `scripts/dev-up.ts` `assertLoopback`. The snapshot
 * tool restores credentials (incl. db_password) into databases; refusing
 * non-loopback hosts prevents a misclicked env var from writing to a
 * production cluster. Capture is read-only but we guard it too for symmetry.
 */
export function assertLoopback(dbUrl: string): { ok: true } | { ok: false; reason: string } {
    let host: string;
    try {
        host = new URL(dbUrl).hostname.toLowerCase();
    } catch {
        return { ok: false, reason: `DB URL is not a parseable URL: ${dbUrl}` };
    }
    const isLoopback =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '[::1]' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local');
    if (!isLoopback) {
        return {
            ok: false,
            reason:
                `refusing to operate against non-loopback DB host '${host}'. ` +
                `db-snapshot is a developer-laptop tool.`,
        };
    }
    return { ok: true };
}

/** Parse a `postgres://user:pass@host:port/db` URL into superuser coordinates. */
export function parseSuperuser(dbUrl: string): {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
} {
    const u = new URL(dbUrl);
    return {
        host: u.hostname,
        port: u.port ? Number.parseInt(u.port, 10) : 5432,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.replace(/^\//, ''),
    };
}
