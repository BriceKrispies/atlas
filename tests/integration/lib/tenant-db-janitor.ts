/**
 * Itest-only janitor for orphan per-tenant databases left behind by
 * interrupted integration-test runs.
 *
 * **Why this exists.** Integration tests that provision a per-tenant DB
 * (ADR 0005) name it `atlas_t_<purpose>_itest_<runid>` and drop it in
 * `afterAll`. If the run is interrupted (Ctrl-C, OOM, `podman stop`),
 * `afterAll` does not execute and the empty DB + matching `_runtime` role
 * accumulate on the Postgres instance. Over many interrupted runs the
 * cluster collects stale, no-test-owns-it databases.
 *
 * **What this is not.** A production janitor. Production tenant teardown
 * happens through the tenant-destroy flow. This helper exists only to keep
 * the integration-test Postgres clean between local dev runs and CI shards.
 *
 * **Safety bar.** The LIKE pattern callers pass *must* contain the
 * `_itest_` infix. This is the load-bearing guard that prevents the janitor
 * from ever dropping a real production tenant DB
 * (`atlas_t_<real-tenant>`) — those names will never contain `_itest_`.
 *
 * Spec: `tickets/db-per-tenant-followups/itest-tenant-db-janitor.md`
 * Related ADR: `specs/decisions/0005-custom-schema-storage-strategy.md`
 */
import type postgres from 'postgres';

/**
 * Suffix appended to a tenant's runtime role by
 * `adapters/node/src/tenant-db-provider.ts`. Kept as a constant rather than
 * imported because the tests should not depend on adapter internals — if
 * the suffix ever changes, both this file and the provider get touched in
 * the same change.
 */
const RUNTIME_ROLE_SUFFIX = '_runtime';

/**
 * Required infix in any safe janitor pattern. Itest tenants are named
 * `atlas_t_<purpose>_itest_<runid>`; production tenants are
 * `atlas_t_<tenant-slug>` with no `_itest_` segment. Refusing patterns
 * without this infix is the defence-in-depth against an operator typo
 * accidentally wiping live tenants.
 */
const REQUIRED_INFIX = '_itest_';

export interface OrphanDroppedEvent {
    /**
     * Stable structured-log event name. Tests / log scrapers can grep for
     * this string when verifying the janitor fired.
     */
    eventName: 'ItestJanitor.OrphanDropped';
    /** Database that was dropped. */
    dbName: string;
    /** Runtime role that was dropped alongside the database (if present). */
    roleName: string | null;
}

export interface CleanOrphanTestDatabasesResult {
    /** All drops actually performed (one entry per database that existed). */
    drops: ReadonlyArray<OrphanDroppedEvent>;
}

/**
 * Drop every database whose name matches `pattern` (a Postgres LIKE
 * pattern), and drop the matching `<dbName>_runtime` role alongside. The
 * function is idempotent: when no orphans exist it returns `{ drops: [] }`
 * and emits no events.
 *
 * **The pattern is mandatory.** Callers pass the purpose-scoped pattern
 * their itest file uses, e.g. `atlas_t_repo_itest_%`. The function refuses
 * any pattern that does not include the `_itest_` infix — without that
 * infix the pattern could match a real production tenant DB.
 *
 * @param controlSql Postgres connection to a database that *is not* one of
 *                   the candidates for dropping (typically `control_plane`).
 *                   `DROP DATABASE` will fail otherwise.
 * @param pattern    A Postgres LIKE pattern — e.g. `atlas_t_repo_itest_%`.
 *                   MUST contain `_itest_`.
 * @returns          A list of drops actually performed. Empty when no
 *                   orphans were found.
 */
export async function cleanOrphanTestDatabases(
    controlSql: postgres.Sql,
    pattern: string,
): Promise<CleanOrphanTestDatabasesResult> {
    if (!pattern.includes(REQUIRED_INFIX)) {
        throw new Error(
            `cleanOrphanTestDatabases: pattern ${JSON.stringify(pattern)} does not ` +
                `contain ${JSON.stringify(REQUIRED_INFIX)}; refusing to run against a ` +
                `pattern that could match production tenant databases`,
        );
    }
    if (!pattern.startsWith('atlas_t_')) {
        // Defence in depth — every per-tenant DB the provider creates is
        // `atlas_t_*`. A pattern that doesn't anchor here has no business
        // running through this helper.
        throw new Error(
            `cleanOrphanTestDatabases: pattern ${JSON.stringify(pattern)} must start ` +
                `with "atlas_t_"`,
        );
    }
    const dbRows = await controlSql<{
        datname: string;
    }[]>`SELECT datname FROM pg_database WHERE datname LIKE ${pattern}`;
    if (dbRows.length === 0) {
        return { drops: [] };
    }
    const drops: OrphanDroppedEvent[] = [];
    for (const row of dbRows) {
        const dbName = row.datname;
        // Belt-and-braces: even though the LIKE pattern was infix-guarded,
        // assert again per-row that the candidate name contains `_itest_`.
        // A subtle bug (e.g. `_` matching as a wildcard in LIKE) could
        // otherwise let a real DB through.
        if (!dbName.includes(REQUIRED_INFIX) || !dbName.startsWith('atlas_t_')) {
            // Skip rather than throw — pg_database may contain rows that
            // happen to match a poorly-scoped pattern, and we'd rather
            // leave them alone than abort the suite.
            continue;
        }
        const roleName = `${dbName}${RUNTIME_ROLE_SUFFIX}`;
        // Postgres won't allow DROP DATABASE with active connections.
        // Itest leftovers shouldn't have any (the process that left them
        // crashed), but force-terminate as defence-in-depth.
        try {
            await controlSql.unsafe(
                `SELECT pg_terminate_backend(pid) FROM pg_stat_activity ` +
                    `WHERE datname = '${dbName.replace(/'/g, "''")}'`,
            );
        } catch {
            // Best-effort — if termination fails the DROP below will surface
            // the real problem.
        }
        await controlSql.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
        // The runtime role may or may not exist — older runs may have
        // landed before the role-creation step. `IF EXISTS` keeps this
        // idempotent.
        let droppedRole: string | null = null;
        const roleRows = await controlSql<{
            rolname: string;
        }[]>`SELECT rolname FROM pg_roles WHERE rolname = ${roleName}`;
        if (roleRows.length > 0) {
            await controlSql.unsafe(`DROP ROLE IF EXISTS "${roleName}"`);
            droppedRole = roleName;
        }
        const event: OrphanDroppedEvent = {
            eventName: 'ItestJanitor.OrphanDropped',
            dbName,
            roleName: droppedRole,
        };
        drops.push(event);
        // Single structured line per drop. Newline-delimited JSON so log
        // scrapers / the Playwright stdout capture can pick this up the
        // same way they pick up server-side events.
        console.log(JSON.stringify(event));
    }
    return { drops };
}
