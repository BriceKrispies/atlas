/**
 * TenantDbProvider — TypeScript port of
 * `crates/adapters/src/postgres_tenant_db.rs`.
 *
 * Resolves a tenant id to a per-tenant Postgres `Sql` (postgres.js
 * connection). Looks up the connection columns (`db_host`, `db_port`,
 * `db_name`, `db_user`, `db_password`) on `control_plane.tenants`,
 * materialises a `postgres()` instance, and caches it with a hand-rolled
 * LRU keyed by tenant id.
 *
 * Defaults match the Rust adapter (cap 32, max 5 connections per tenant).
 *
 * **Why not in `@atlas/ports`?** Per-tenant pool resolution is a
 * Postgres-shaped concern. The IDB sim doesn't have pools, just per-tenant
 * databases that already round-trip through `openAtlasIdb(tenantId)`. The
 * abstraction would leak. If a future shared port ever appears, it lives in
 * `@atlas/ports` and this struct implements it.
 */
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import type { Logger } from '@atlas/platform-core';
import { runMigrations } from './migrations/runner.ts';
const DEFAULT_LRU_CAP = 32;
const DEFAULT_POOL_MAX = 5;
/**
 * Maximum length of a Postgres identifier (NAMEDATALEN - 1). DB names and
 * role names must fit within this; we sanitise the tenant id before
 * concatenating with the `atlas_t_` prefix and `_runtime` suffix.
 */
const PG_IDENT_MAX = 63;
/**
 * Explicit, documented connection-resilience options applied to BOTH
 * Postgres pool-construction sites — the control-plane pool
 * (`apps/server/src/bootstrap.ts`) and every per-tenant pool
 * (`openPostgresFromInfo` below). Single-sourced here so the two sites
 * cannot drift, and so the pool-resilience regression test can import the
 * exact object production uses.
 *
 * **Why these and not a bespoke reconnect loop.** The empirical probe
 * (capability spec §Empirical-First Directive, run 2026-05-23 on
 * postgres.js 3.4.9) confirmed the driver ALREADY recovers per-query after
 * a Postgres container bounce: the same pool object errors on the first
 * post-bounce query (`CONNECTION_CLOSED`), sees `57P03` while Postgres is
 * still starting, then reconnects and succeeds — no pool latch, no manual
 * retry loop needed. The deliverable for capability `pool-resilience`
 * (always-on §1, I20) is therefore to make that already-working behaviour
 * EXPLICIT and INTENTIONAL, not to re-implement the driver's pool.
 *
 * - `connect_timeout` (30s): bound how long a single (re)connect attempt
 *   waits for the server to accept connections, so a wedged network path
 *   surfaces as an error the per-query reconnect can retry, rather than
 *   hanging a request indefinitely.
 * - `idle_timeout` (20s): retire idle sockets so a long-lived pool does
 *   not accumulate connections the server has silently dropped.
 * - `max_lifetime` (30min): recycle connections periodically — bounds the
 *   blast radius of a half-open socket that survives a bounce.
 *
 * postgres.js's default per-query reconnect (the actual healing mechanism)
 * is on by default and is NOT disabled here. See
 * `specs/domains/runtime/capabilities/pool-resilience/README.md` and
 * `specs/crosscut/always-on.md` §1 (I20).
 */
export const POSTGRES_RESILIENCE_OPTIONS = {
    connect_timeout: 30,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
} as const;
export interface TenantDbProvider {
    getPool(tenantId: string): Promise<postgres.Sql>;
}
export interface ProvisionTenantDatabaseArgs {
    /** Slug-style tenant id (e.g. `_platform`, `dev-tenant`). */
    tenantId: string;
    /** Human-readable name. Defaults to `tenantId`. Only used if the tenants row needs to be inserted (currently it must already exist — see notes). */
    name?: string;
    /** Optional region label, persisted on the tenants row. Ignored when the row already exists. */
    region?: string;
    /** Optional context-bound logger. The structured event is emitted via `logger.info(...)`; when omitted, no log is emitted. */
    logger?: Logger;
}
export interface ProvisionTenantDatabaseResult {
    /** `true` when the database was created on this call; `false` on idempotent re-runs. */
    created: boolean;
    /** Final Postgres database name (`atlas_t_<sanitisedTenantId>`). */
    dbName: string;
    /** Final tenant runtime role name (`atlas_t_<sanitisedTenantId>_runtime`). */
    runtimeRole: string;
}
interface TenantConnectionInfo {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
}
/**
 * Sanitise a tenant id slug for use as part of a Postgres identifier.
 * Tenants in the control plane use slugs like `_platform` or `dev-tenant`;
 * Postgres identifiers permit `[a-z0-9_]` (case-folded) but `-` requires
 * quoting and creates fragile interpolation. We replace `-` with `_` and
 * reject anything outside the allowlist — defence-in-depth against an
 * injection sneaking through the tenants table.
 */
function sanitiseTenantSlug(tenantId: string): string {
    if (tenantId.length === 0) {
        throw new Error('provisionTenantDatabase: tenantId is empty');
    }
    // Slug rules mirror the tenant-id validation upstream: lowercase
    // letters, digits, `_`, and `-`. We turn `-` into `_` for the DB
    // identifier (matches phase-2 dev-up expectations:
    // `dev-tenant` → `atlas_t_dev_tenant`).
    const normalised = tenantId.toLowerCase().replace(/-/g, '_');
    if (!/^[a-z0-9_]+$/.test(normalised)) {
        throw new Error(`provisionTenantDatabase: tenantId ${JSON.stringify(tenantId)} is not a valid slug`);
    }
    return normalised;
}
function dbNameFor(tenantId: string): string {
    const slug = sanitiseTenantSlug(tenantId);
    const name = `atlas_t_${slug}`;
    if (name.length > PG_IDENT_MAX) {
        throw new Error(`provisionTenantDatabase: derived db name ${name} exceeds ${PG_IDENT_MAX} chars`);
    }
    return name;
}
function runtimeRoleFor(tenantId: string): string {
    const slug = sanitiseTenantSlug(tenantId);
    const role = `atlas_t_${slug}_runtime`;
    if (role.length > PG_IDENT_MAX) {
        throw new Error(`provisionTenantDatabase: derived runtime role ${role} exceeds ${PG_IDENT_MAX} chars`);
    }
    return role;
}
/**
 * Generate an opaque password for a freshly-created tenant runtime role.
 * Stored cleartext in `control_plane.tenants.db_password` so the provider
 * can open connections; this mirrors the existing `db_password TEXT`
 * column and the rest of the dev-mode plaintext-secret posture. Replacing
 * this with a sealed-secrets / KMS-backed shape is a follow-up tracked
 * under `storage/secrets`.
 */
function generateRolePassword(): string {
    return randomBytes(24).toString('base64url');
}
/**
 * Quote a Postgres identifier (database or role name). The sanitisation
 * above guarantees only `[a-z0-9_]` characters, so this is paranoia
 * rather than necessity — but identifier interpolation into DDL warrants
 * defence in depth.
 */
function quoteIdent(ident: string): string {
    if (!/^[a-z0-9_]+$/.test(ident)) {
        throw new Error(`refusing to quote unsafe identifier: ${ident}`);
    }
    return `"${ident}"`;
}
/**
 * Quote a Postgres string literal by doubling single quotes. Used for
 * `CREATE ROLE ... PASSWORD '...'` since postgres.js parameter binding
 * is not supported for that grammar.
 */
function quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
interface PostgresTenantDbProviderOptions {
    /** Maximum number of cached per-tenant pools before LRU eviction. */
    cap?: number;
    /** `max` connections passed to `postgres()` per-tenant. */
    poolMax?: number;
    /**
     * Optional override for how a tenant id resolves to connection info. When
     * provided, this bypasses the `control_plane.tenants` lookup. Used by
     * tests that want to point every tenant at the same physical DB.
     */
    resolveConnection?: (tenantId: string) => Promise<TenantConnectionInfo | null>;
}

/**
 * Structured error thrown by `getPool` when a tenant row exists but its
 * `db_*` connection coordinates are NULL — i.e. the tenant has not had its
 * dedicated database provisioned. ADR 0005 (db-per-tenant) is fail-closed:
 * there is no shared-DB fallback.
 *
 * Operators see this in dev when they haven't run `pnpm dev:up`; in
 * production it means the signup-approval provisioner hasn't completed
 * (or failed mid-run). The `code` matches the canonical error taxonomy in
 * `specs/error_taxonomy.json` and is surfaced upstream by handlers like
 * `CustomSchema.ObjectType.Define`.
 */
export class TenantDatabaseNotProvisionedError extends Error {
    readonly code = 'TENANT_DATABASE_NOT_PROVISIONED' as const;
    readonly tenantId: string;
    constructor(tenantId: string) {
        super(
            `tenant ${tenantId}: per-tenant database not provisioned ` +
                `(control_plane.tenants.db_* is NULL). ` +
                `In dev: run \`pnpm dev:up\` to provision the per-tenant DB. ` +
                `In production: invoke the tenancy provisioner ` +
                `(PostgresTenantDbProvider.provisionTenantDatabase) ` +
                `during signup-approval. See ADR 0005 (db-per-tenant).`,
        );
        this.name = 'TenantDatabaseNotProvisionedError';
        this.tenantId = tenantId;
    }
}
/**
 * Structured error thrown by `provisionTenantDatabase` when no
 * `control_plane.tenants` row exists for the given tenantId. The
 * provisioner refuses to create the per-tenant database / runtime role
 * without an anchor row — otherwise a typo'd tenantId would silently
 * create an orphan DB.
 *
 * The `code` matches the canonical `TENANT_NOT_FOUND` entry in
 * `specs/error_taxonomy.json` (chosen over the ad-hoc `TENANT_ROW_MISSING`
 * because the taxonomy already covers "tenant id does not exist" with
 * that conventional code).
 */
export class TenantNotFoundError extends Error {
    readonly code = 'TENANT_NOT_FOUND' as const;
    readonly tenantId: string;
    constructor(tenantId: string) {
        super(
            `tenant ${tenantId}: no row in control_plane.tenants — ` +
                `provisionTenantDatabase refuses to create an orphan DB / role. ` +
                `Insert the tenants row before calling the provisioner ` +
                `(signup-approve / dev-up inserts it first).`,
        );
        this.name = 'TenantNotFoundError';
        this.tenantId = tenantId;
    }
}
/** Parse a `postgres://user:pass@host:port/dbname` URL into TenantConnectionInfo. */
export function parseTenantConnectionUrl(url: string): TenantConnectionInfo {
    const u = new URL(url);
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
        throw new Error(`expected postgres:// URL, got ${u.protocol}`);
    }
    const port = u.port ? Number.parseInt(u.port, 10) : 5432;
    if (!Number.isFinite(port) || port <= 0) {
        throw new Error(`invalid port in tenant DB url: ${u.port}`);
    }
    const dbname = u.pathname.replace(/^\//, '');
    if (!dbname)
        throw new Error(`tenant DB url is missing the database name: ${url}`);
    return {
        host: u.hostname,
        port,
        name: dbname,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
    };
}
/**
 * Open a postgres pool from a TenantConnectionInfo using postgres.js's
 * config-object form. Avoids the URL round-trip via `connectionString()`
 * which has caused `password authentication failed` regressions when the
 * URL parser interpretation differs between consumers (see
 * docs/incidents/2026-05-08-tenant-db-auth-failure.md). Prefer this over
 * passing a connection string.
 */
function openPostgresFromInfo(info: TenantConnectionInfo, max: number): postgres.Sql {
    return postgres({
        host: info.host,
        port: info.port,
        database: info.name,
        user: info.user,
        password: info.password,
        max,
        // Explicit connection-resilience config so a per-tenant pool
        // survives a Postgres container bounce without an apps/server
        // restart (capability pool-resilience, always-on §1, I20). The
        // driver already reconnects per-query; these options make that
        // intentional and bound. See POSTGRES_RESILIENCE_OPTIONS.
        ...POSTGRES_RESILIENCE_OPTIONS,
        // Suppress postgres NOTICE chatter (`relation already exists,
        // skipping`, `role already exists, skipping`, etc.) that
        // otherwise leaks to stdout on idempotent provisioner re-runs.
        // The information is already structurally captured by our own
        // existence-check branches — the chatter just adds noise to
        // `pnpm dev:up` output. See ticket
        // db-per-tenant-followups/provisioner-hardening (F8).
        onnotice: () => {
            /* swallow */
        },
    });
}
class TenantPoolCache {
    private readonly pools = new Map<string, postgres.Sql>();
    private readonly order: string[] = [];
    // Pending close promises from eviction / race-loser cleanup. Tracked so
    // `closeAll` can await them — otherwise unit-test teardown can race with
    // half-closed sockets.
    private readonly pendingCloses = new Set<Promise<void>>();
    constructor(private readonly cap: number) { }
    get(tenantId: string): postgres.Sql | undefined {
        const pool = this.pools.get(tenantId);
        if (!pool)
            return undefined;
        // Move to MRU (back).
        const idx = this.order.indexOf(tenantId);
        if (idx >= 0)
            this.order.splice(idx, 1);
        this.order.push(tenantId);
        return pool;
    }
    insert(tenantId: string, pool: postgres.Sql): void {
        while (this.pools.size >= this.cap) {
            const oldest = this.order.shift();
            if (oldest === undefined)
                break;
            const evicted = this.pools.get(oldest);
            this.pools.delete(oldest);
            if (evicted)
                this.trackClose(evicted);
        }
        this.pools.set(tenantId, pool);
        this.order.push(tenantId);
    }
    /**
     * Track a fire-and-forget pool close so `closeAll` can wait for it.
     * Used by eviction and the race-loser path. Returns the tracked
     * close promise so callers that need the post-call "pool is gone"
     * contract (e.g. `invalidate`) can await it.
     */
    trackClose(pool: postgres.Sql): Promise<void> {
        const p = pool.end({ timeout: 1 }).catch(function () {
            /* swallow — close is best-effort */
        });
        this.pendingCloses.add(p);
        void p.finally(() => this.pendingCloses.delete(p));
        return p;
    }
    /**
     * Close and evict a single tenant's cached pool, removing it from both
     * the `pools` map and the `order` LRU array (so a stale tenant id can
     * never linger as a phantom LRU entry). No-op if no pool is cached for
     * `tenantId`. Returns the tracked close promise (resolved immediately
     * on a no-op) so the caller can await the socket teardown — this is
     * how `PostgresTenantDbProvider.invalidate` upholds its "after resolve,
     * the previously-cached pool is gone" contract (capability
     * tenant-pool-invalidation, always-on §1, I20).
     */
    delete(tenantId: string): Promise<void> {
        const pool = this.pools.get(tenantId);
        if (!pool) {
            return Promise.resolve();
        }
        this.pools.delete(tenantId);
        const idx = this.order.indexOf(tenantId);
        if (idx >= 0) {
            this.order.splice(idx, 1);
        }
        return this.trackClose(pool);
    }
    /**
     * Close and evict every cached pool, resetting the LRU bookkeeping.
     * Awaits all closes. Unlike `closeAll` (which tears the provider down
     * for good), the provider stays live after `clear` — the next
     * `getPool` re-resolves and reconnects. Used by
     * `PostgresTenantDbProvider.invalidateAll` after a full wipe-and-reseed
     * (capability tenant-pool-invalidation, always-on §1, I20).
     */
    async clear(): Promise<void> {
        await this.closeAll();
    }
    has(tenantId: string): boolean {
        return this.pools.has(tenantId);
    }
    /** Visible for testing. */
    size(): number {
        return this.pools.size;
    }
    async closeAll(): Promise<void> {
        const tasks = [...this.pools.values()].map(function (p) {
            return p.end({ timeout: 1 });
        });
        this.pools.clear();
        this.order.length = 0;
        const pending = [...this.pendingCloses];
        await Promise.allSettled([...tasks, ...pending]);
    }
}
export class PostgresTenantDbProvider implements TenantDbProvider {
    private readonly cache: TenantPoolCache;
    private readonly poolMax: number;
    private readonly resolveOverride?: (tenantId: string) => Promise<TenantConnectionInfo | null>;
    // Dedup concurrent first-time `getPool` calls per tenant so we don't
    // spin up N pools and discard N-1 (TOCTOU race in the previous
    // implementation).
    private readonly inFlight = new Map<string, Promise<postgres.Sql>>();
    // Dedup concurrent `provisionTenantDatabase` calls per tenant. Without
    // this, two parallel calls both pass the `pg_database` existence check,
    // both attempt `CREATE DATABASE`, and the second errors with
    // `database "<x>" already exists`. The promise is awaited by the
    // second caller; the entry is cleared on both resolve and reject so
    // subsequent calls re-issue cleanly (mirrors the `inFlight` pattern
    // above).
    private readonly inFlightProvision = new Map<string, Promise<ProvisionTenantDatabaseResult>>();
    constructor(private readonly controlPlane: postgres.Sql, opts: PostgresTenantDbProviderOptions = {}) {
        const cap = Math.max(1, opts.cap ?? DEFAULT_LRU_CAP);
        this.cache = new TenantPoolCache(cap);
        this.poolMax = opts.poolMax ?? DEFAULT_POOL_MAX;
        if (opts.resolveConnection) {
            this.resolveOverride = opts.resolveConnection;
        }
    }
    async getPool(tenantId: string): Promise<postgres.Sql> {
        const cached = this.cache.get(tenantId);
        if (cached)
            return cached;
        const pending = this.inFlight.get(tenantId);
        if (pending)
            return pending;
        const promise = this.openPool(tenantId).finally(() => {
            this.inFlight.delete(tenantId);
        });
        this.inFlight.set(tenantId, promise);
        return promise;
    }
    private async openPool(tenantId: string): Promise<postgres.Sql> {
        const info = await this.lookupConnectionInfo(tenantId);
        if (!info) {
            throw new Error(`tenant ${tenantId}: not found in control_plane.tenants`);
        }
        const pool = openPostgresFromInfo(info, this.poolMax);
        // Defensive re-check: even with `inFlight`, another path could have
        // populated the cache (e.g. if `getPool` was called from inside a
        // resolveOverride). Last-write-wins; the loser's pool is tracked for
        // shutdown.
        const raced = this.cache.get(tenantId);
        if (raced) {
            this.cache.trackClose(pool);
            return raced;
        }
        this.cache.insert(tenantId, pool);
        return pool;
    }
    /** Visible for ops/tests. Closes every cached pool. */
    async close(): Promise<void> {
        await this.cache.closeAll();
    }
    /**
     * Close and evict the cached pool for a single tenant. The next
     * `getPool(tenantId)` re-runs `lookupConnectionInfo` and opens a fresh
     * pool against the (possibly recreated) tenant database. No-op if no
     * pool is cached for `tenantId`. The close is awaited so that once this
     * resolves no previously-cached pool for `tenantId` is reachable via
     * `getPool`.
     *
     * Used by the db-snapshot reseed step after a tenant DB is
     * dropped/recreated, so a live process drops the stale pool without a
     * restart (always-on §1, I20). This is an adapter-only API (return type
     * is void over a Postgres-shaped cache) — deliberately NOT on the
     * `TenantDbProvider` interface or `@atlas/ports` (see the file header).
     *
     * In-flight first-time opens for the same tenant are NOT cancelled —
     * the reseed tooling quiesces traffic; this evicts what is cached.
     */
    async invalidate(tenantId: string): Promise<void> {
        await this.cache.delete(tenantId);
    }
    /**
     * Close and evict every cached per-tenant pool. The provider stays
     * live: the next `getPool` for any tenant re-resolves and reconnects.
     * No-op on an empty cache. Used by the db-snapshot reseed step after a
     * full wipe-and-reseed (every tenant DB recreated) so a live process
     * drops all stale pools without a restart (always-on §1, I20).
     */
    async invalidateAll(): Promise<void> {
        await this.cache.clear();
    }
    /**
     * Provision a per-tenant Postgres database for `tenantId`, following
     * the topology fixed by ADR 0005 (db-per-tenant, two-role per DB).
     *
     * Idempotent — re-running yields the same end state with no errors.
     * Existence checks against `pg_database` and `pg_roles` guard each
     * mutating step.
     *
     * Concurrency: parallel calls for the same `tenantId` are de-duped
     * via an in-flight promise map. The second caller awaits the first's
     * result — exactly one `CREATE DATABASE` / `CREATE ROLE` attempt
     * fires per tenant. The map entry is cleared on resolve AND reject,
     * so subsequent calls re-issue cleanly even after a failed
     * provision. See ticket
     * db-per-tenant-followups/provisioner-hardening (F4).
     *
     * Precondition: the `control_plane.tenants` row for `tenantId` MUST
     * exist before this call. The provisioner refuses to create the DB
     * / role without an anchor row — otherwise a typo'd tenantId would
     * silently create an orphan that no `getPool` could ever resolve
     * to. Throws `TenantNotFoundError` (canonical code
     * `TENANT_NOT_FOUND` per `specs/error_taxonomy.json`). The row check
     * happens BEFORE any side effect — no CREATE DATABASE, no CREATE
     * ROLE on the rejected path. See F5.
     *
     * Partial-state recovery: first-time, post-partial-crash, and
     * reconciled paths converge on the same end state. A password is
     * generated only when either the role doesn't exist OR
     * `control_plane.tenants.db_password IS NULL`; otherwise it is
     * preserved. The realistic crash scenario is "CREATE ROLE
     * succeeded, no UPDATE ran at all" — all five `db_*` columns NULL
     * including `db_password`. The original role password is not
     * recoverable from `pg_roles` after CREATE, so partial recovery
     * issues `ALTER ROLE ... PASSWORD '<new>'` and writes all five
     * columns. This rotation is materially safe because no `getPool`
     * could have succeeded against the NULL row anyway — there is no
     * open runtime pool to lock out. On the narrow "db_password
     * survived but the four coordinates were NULL" path the password
     * is preserved (it's still the live secret). See F6.
     *
     * Steps (in order, all under the privileged `controlPlane` connection):
     *   1. Verify the `control_plane.tenants` row exists (F5).
     *   2. `CREATE DATABASE <dbName>` if not present.
     *   3. `CREATE ROLE <runtimeRole>` if not present. If the role
     *      already exists but `control_plane.tenants.db_password IS
     *      NULL` (post-partial-crash recovery), generate a new
     *      password and `ALTER ROLE ... PASSWORD '<new>'` to make it
     *      usable again. Otherwise the role's existing password is
     *      preserved.
     *   4. Grant `CONNECT` on the new DB to the runtime role.
     *   5. Open a NEW connection as the provisioner (the `controlPlane` user) to the new DB and:
     *        a. Run tenant migrations (`runMigrations(sql, 'tenant')`).
     *        b. Grant `USAGE` on `public`, `SELECT,INSERT,UPDATE,DELETE` on all current and future tables in `public`. No `CREATE`/`ALTER`/`DROP` — that's the platform's job, not the tenant's (I16).
     *   6. UPDATE `control_plane.tenants`. When a password was
     *      generated (first-time or post-partial-crash recovery),
     *      writes all five `db_*` columns including `db_password`. On
     *      pure idempotent re-runs (role exists AND `db_password` is
     *      populated), writes `db_host/db_port/db_name/db_user` but
     *      NOT `db_password`.
     *   7. Emit `Tenancy.Database.Provisioned` log event when a
     *      password was generated (first-time or post-partial-crash
     *      recovery).
     *
     * The connection used to run migrations is opened and closed in this
     * call — it is NOT registered with the LRU. The runtime pool that
     * `getPool(tenantId)` returns is separate and goes through the
     * `db_*` columns this call populates.
     */
    async provisionTenantDatabase(args: ProvisionTenantDatabaseArgs): Promise<ProvisionTenantDatabaseResult> {
        const { tenantId } = args;
        const pending = this.inFlightProvision.get(tenantId);
        if (pending) {
            // Second concurrent caller for the same tenant joins the
            // in-flight execution. They receive the same result; only
            // one CREATE DATABASE / CREATE ROLE fires. The joining
            // caller does NOT receive a `Tenancy.Database.Provisioned`
            // log event through their own `args.logger` — that event is
            // emitted by the first caller (which owns the
            // `wasFirstTime` observation). Matches the
            // idempotent-re-run semantics: at most one event per
            // provision.
            return pending;
        }
        const promise = this.runProvisionTenantDatabase(args).finally(() => {
            // Clear on resolve AND reject so a failed provision doesn't
            // poison the map. Mirrors the `inFlight` pattern in
            // `getPool`.
            this.inFlightProvision.delete(tenantId);
        });
        this.inFlightProvision.set(tenantId, promise);
        return promise;
    }
    private async runProvisionTenantDatabase(args: ProvisionTenantDatabaseArgs): Promise<ProvisionTenantDatabaseResult> {
        const { tenantId } = args;
        const dbName = dbNameFor(tenantId);
        const runtimeRole = runtimeRoleFor(tenantId);
        // --- Step 1: Precondition — tenants row must exist (F5) ---
        // Done BEFORE any side effect. A typo'd tenantId or a caller
        // that forgot the INSERT would otherwise silently create an
        // orphan DB + role that no `getPool` could ever resolve to.
        // Also snapshot db_password so the partial-crash recovery path
        // (Step 3) can detect "role exists but no usable password
        // persisted" without a second round-trip.
        const tenantRow = await this.controlPlane<{ exists: boolean; db_password: string | null }[]>`
      SELECT
        TRUE AS exists,
        db_password
      FROM control_plane.tenants
      WHERE tenant_id = ${tenantId}
    `;
        if (tenantRow.length === 0) {
            throw new TenantNotFoundError(tenantId);
        }
        const existingPassword = tenantRow[0]?.db_password ?? null;
        // --- Step 2: CREATE DATABASE (idempotent) ---
        const dbExists = await this.controlPlane<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${dbName}) AS exists
    `;
        const createdDb = dbExists[0]?.exists !== true;
        if (createdDb) {
            // CREATE DATABASE cannot run inside a transaction. postgres.js
            // executes `sql.unsafe(...)` outside the implicit tx wrapper when
            // no params are bound — exactly what's needed here.
            await this.controlPlane.unsafe(`CREATE DATABASE ${quoteIdent(dbName)}`);
        }
        // --- Step 3: CREATE ROLE (or ALTER ROLE on partial recovery) ---
        const roleExists = await this.controlPlane<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${runtimeRole}) AS exists
    `;
        const createdRole = roleExists[0]?.exists !== true;
        // Generate a password when EITHER (a) the role doesn't exist
        // yet (first-time) OR (b) the role exists but
        // `control_plane.tenants.db_password IS NULL` (post-partial-
        // crash recovery — the realistic crash scenario is "CREATE
        // ROLE succeeded, no UPDATE ran at all", leaving all five
        // db_* columns NULL). On the recovery path we ALTER ROLE
        // because the original password isn't recoverable from
        // pg_roles and a NULL db_password means no getPool could have
        // succeeded — there is no open runtime pool to lock out by
        // rotating. Otherwise the existing password is preserved.
        const needsFreshPassword = createdRole || existingPassword === null;
        let generatedPassword: string | null = null;
        if (createdRole) {
            generatedPassword = generateRolePassword();
            await this.controlPlane.unsafe(`CREATE ROLE ${quoteIdent(runtimeRole)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${quoteLiteral(generatedPassword)}`);
        }
        else if (needsFreshPassword) {
            // Role exists but db_password is NULL — partial-crash
            // recovery. Reset the role's password to a fresh value so
            // the runtime pool can authenticate after this call.
            generatedPassword = generateRolePassword();
            await this.controlPlane.unsafe(`ALTER ROLE ${quoteIdent(runtimeRole)} WITH PASSWORD ${quoteLiteral(generatedPassword)}`);
        }
        // --- Step 4: GRANT CONNECT on new DB (idempotent — repeated grants are no-ops) ---
        await this.controlPlane.unsafe(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(runtimeRole)}`);
        // --- Step 5: Open provisioner connection to the new DB, migrate, grant CRUD ---
        const provisionerInfo = await this.provisionerInfoFor(dbName);
        const tenantSql = openPostgresFromInfo(provisionerInfo, this.poolMax);
        try {
            await runMigrations(tenantSql, 'tenant');
            // CRUD-only grants on `public` for the runtime role. No
            // CREATE/ALTER/DROP. Default privileges so future tables
            // created by the provisioner (e.g. follow-on migrations,
            // tenant-DDL-allowlist materialisations) inherit the grant.
            await tenantSql.unsafe(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(runtimeRole)}`);
            await tenantSql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdent(runtimeRole)}`);
            await tenantSql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdent(runtimeRole)}`);
            await tenantSql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoteIdent(runtimeRole)}`);
            await tenantSql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quoteIdent(runtimeRole)}`);
        }
        finally {
            await tenantSql.end({ timeout: 5 }).catch(function () {
                /* swallow — close is best-effort */
            });
        }
        // --- Step 6: UPDATE control_plane.tenants ---
        // Two paths, keyed by whether a password was generated this
        // call (`generatedPassword !== null`):
        //   - Password-generating path (first-time OR partial-crash
        //     recovery): write all five db_* columns including
        //     db_password. This is what makes the realistic crash
        //     scenario — "CREATE ROLE succeeded, no UPDATE ran at
        //     all", leaving all five columns NULL — converge: the
        //     ALTER ROLE in Step 3 made the role usable again, and
        //     this UPDATE persists the matching coordinates and the
        //     fresh password.
        //   - Pure idempotent re-run (role exists AND db_password was
        //     already populated): write db_host/db_port/db_name/db_user
        //     but NOT db_password. The existing password is the live
        //     secret; rotating it would lock out any open runtime
        //     pool. The coordinate-only UPDATE is what converges the
        //     narrow "db_password survived but other columns got
        //     NULLed" partial state.
        // See F6.
        if (generatedPassword !== null) {
            await this.controlPlane`
        UPDATE control_plane.tenants
        SET db_host     = ${provisionerInfo.host},
            db_port     = ${provisionerInfo.port},
            db_name     = ${dbName},
            db_user     = ${runtimeRole},
            db_password = ${generatedPassword}
        WHERE tenant_id = ${tenantId}
      `;
        }
        else {
            // Pure idempotent re-run. For a clean re-run (row already
            // correctly populated) this is a no-op write; for the
            // narrow "db_password survived but other columns NULL"
            // partial state this is what converges the row.
            await this.controlPlane`
        UPDATE control_plane.tenants
        SET db_host = ${provisionerInfo.host},
            db_port = ${provisionerInfo.port},
            db_name = ${dbName},
            db_user = ${runtimeRole}
        WHERE tenant_id = ${tenantId}
      `;
        }
        // --- Step 7: Structured log event ---
        // Fires whenever a password was generated — i.e. either
        // first-time or post-partial-crash recovery. A pure
        // idempotent re-run is silent (matches the "at most one event
        // per provision" contract; recovery is materially a
        // provision).
        const emitProvisionedEvent = generatedPassword !== null;
        if (emitProvisionedEvent && args.logger) {
            args.logger.info('tenant database provisioned', {
                event: 'Tenancy.Database.Provisioned',
                properties: {
                    tenantId,
                    dbName,
                    runtimeRole,
                },
            });
        }
        return { created: createdDb, dbName, runtimeRole };
    }
    /**
     * Build a `TenantConnectionInfo` pointing at `dbName` but using the
     * provisioner's connection coordinates (host / port / user / password).
     * Migrations and DDL run under this identity; the tenant runtime role
     * is CRUD-only.
     */
    private async provisionerInfoFor(dbName: string): Promise<TenantConnectionInfo> {
        // postgres.js exposes the resolved connection options via the
        // function's `.options` property. Reading them here keeps the
        // provisioner identity consistent with whatever bootstrapped the
        // `controlPlane` Sql — no second config source to drift against.
        const opts = (this.controlPlane as unknown as {
            options: {
                host?: string | string[];
                hostname?: string;
                port?: number | number[];
                user?: string;
                username?: string;
                pass?: string;
                password?: string;
            };
        }).options;
        const host = Array.isArray(opts.host) ? opts.host[0] : (opts.host ?? opts.hostname);
        const port = Array.isArray(opts.port) ? opts.port[0] : opts.port;
        const user = opts.user ?? opts.username;
        const password = opts.pass ?? opts.password;
        if (typeof host !== 'string' || host.length === 0) {
            throw new Error('provisionTenantDatabase: could not resolve provisioner host from controlPlane connection');
        }
        if (typeof port !== 'number' || !Number.isFinite(port)) {
            throw new Error('provisionTenantDatabase: could not resolve provisioner port from controlPlane connection');
        }
        if (typeof user !== 'string' || user.length === 0) {
            throw new Error('provisionTenantDatabase: could not resolve provisioner user from controlPlane connection');
        }
        if (typeof password !== 'string') {
            throw new Error('provisionTenantDatabase: could not resolve provisioner password from controlPlane connection');
        }
        return { host, port, name: dbName, user, password };
    }
    private async lookupConnectionInfo(tenantId: string): Promise<TenantConnectionInfo | null> {
        if (this.resolveOverride) {
            return this.resolveOverride(tenantId);
        }
        const rows = await this.controlPlane<Array<{
            db_host: string | null;
            db_port: number | null;
            db_name: string | null;
            db_user: string | null;
            db_password: string | null;
        }>> `
      SELECT db_host, db_port, db_name, db_user, db_password
      FROM control_plane.tenants
      WHERE tenant_id = ${tenantId}
    `;
        const row = rows[0];
        if (!row)
            return null;
        if (row.db_host == null ||
            row.db_port == null ||
            row.db_name == null ||
            row.db_user == null ||
            row.db_password == null) {
            // ADR 0005 (db-per-tenant) is fail-closed: a tenant row without
            // populated db_* coordinates means the per-tenant database has
            // not been provisioned. There is no shared-DB fallback —
            // protocol-layer isolation is the whole point.
            throw new TenantDatabaseNotProvisionedError(tenantId);
        }
        return {
            host: row.db_host,
            port: row.db_port,
            name: row.db_name,
            user: row.db_user,
            password: row.db_password,
        };
    }
}
