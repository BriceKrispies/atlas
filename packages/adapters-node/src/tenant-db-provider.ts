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

const DEFAULT_LRU_CAP = 32;
const DEFAULT_POOL_MAX = 5;

export interface TenantDbProvider {
  getPool(tenantId: string): Promise<postgres.Sql>;
}

interface TenantConnectionInfo {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}

function connectionString(info: TenantConnectionInfo): string {
  return `postgres://${info.user}:${info.password}@${info.host}:${info.port}/${info.name}`;
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

class TenantPoolCache {
  private readonly pools = new Map<string, postgres.Sql>();
  private readonly order: string[] = [];
  // Pending close promises from eviction / race-loser cleanup. Tracked so
  // `closeAll` can await them — otherwise unit-test teardown can race with
  // half-closed sockets.
  private readonly pendingCloses = new Set<Promise<void>>();
  constructor(private readonly cap: number) {}

  get(tenantId: string): postgres.Sql | undefined {
    const pool = this.pools.get(tenantId);
    if (!pool) return undefined;
    // Move to MRU (back).
    const idx = this.order.indexOf(tenantId);
    if (idx >= 0) this.order.splice(idx, 1);
    this.order.push(tenantId);
    return pool;
  }

  insert(tenantId: string, pool: postgres.Sql): void {
    while (this.pools.size >= this.cap) {
      const oldest = this.order.shift();
      if (oldest === undefined) break;
      const evicted = this.pools.get(oldest);
      this.pools.delete(oldest);
      if (evicted) this.trackClose(evicted);
    }
    this.pools.set(tenantId, pool);
    this.order.push(tenantId);
  }

  /**
   * Track a fire-and-forget pool close so `closeAll` can wait for it.
   * Used by eviction and the race-loser path.
   */
  trackClose(pool: postgres.Sql): void {
    const p = pool.end({ timeout: 1 }).catch(() => {
      /* swallow — close is best-effort */
    });
    this.pendingCloses.add(p);
    void p.finally(() => this.pendingCloses.delete(p));
  }

  has(tenantId: string): boolean {
    return this.pools.has(tenantId);
  }

  /** Visible for testing. */
  size(): number {
    return this.pools.size;
  }

  async closeAll(): Promise<void> {
    const tasks = [...this.pools.values()].map((p) => p.end({ timeout: 1 }));
    this.pools.clear();
    this.order.length = 0;
    const pending = [...this.pendingCloses];
    await Promise.allSettled([...tasks, ...pending]);
  }
}

export class PostgresTenantDbProvider implements TenantDbProvider {
  private readonly cache: TenantPoolCache;
  private readonly poolMax: number;
  private readonly resolveOverride?: (
    tenantId: string,
  ) => Promise<TenantConnectionInfo | null>;
  // Dedup concurrent first-time `getPool` calls per tenant so we don't
  // spin up N pools and discard N-1 (TOCTOU race in the previous
  // implementation).
  private readonly inFlight = new Map<string, Promise<postgres.Sql>>();

  constructor(
    private readonly controlPlane: postgres.Sql,
    opts: PostgresTenantDbProviderOptions = {},
  ) {
    const cap = Math.max(1, opts.cap ?? DEFAULT_LRU_CAP);
    this.cache = new TenantPoolCache(cap);
    this.poolMax = opts.poolMax ?? DEFAULT_POOL_MAX;
    if (opts.resolveConnection) {
      this.resolveOverride = opts.resolveConnection;
    }
  }

  async getPool(tenantId: string): Promise<postgres.Sql> {
    const cached = this.cache.get(tenantId);
    if (cached) return cached;

    const pending = this.inFlight.get(tenantId);
    if (pending) return pending;

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
    const pool = postgres(connectionString(info), { max: this.poolMax });

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

  private async lookupConnectionInfo(
    tenantId: string,
  ): Promise<TenantConnectionInfo | null> {
    if (this.resolveOverride) {
      return this.resolveOverride(tenantId);
    }
    const rows = await this.controlPlane<
      Array<{
        db_host: string | null;
        db_port: number | null;
        db_name: string | null;
        db_user: string | null;
        db_password: string | null;
      }>
    >`
      SELECT db_host, db_port, db_name, db_user, db_password
      FROM control_plane.tenants
      WHERE tenant_id = ${tenantId}
    `;
    const row = rows[0];
    if (!row) return null;
    if (
      row.db_host == null ||
      row.db_port == null ||
      row.db_name == null ||
      row.db_user == null ||
      row.db_password == null
    ) {
      throw new Error(
        `tenant ${tenantId} is missing one of {db_host, db_port, db_name, db_user, db_password}`,
      );
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
