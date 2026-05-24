/**
 * PostgresControlPlaneRegistry — the control-plane-backed (registry-as-data)
 * implementation of the `ControlPlaneRegistry` port. Reads platform intent
 * schemas + the action catalog from `control_plane.intent_schemas` /
 * `control_plane.action_entries`, keeping the port's three methods SYNC
 * (decision O1) by serving lookups from a process-local snapshot that a
 * background loop keeps current.
 *
 * ## Sync-over-async (O1) — refresh at the request boundary
 *
 * The ingress pipeline calls `getSchemaValidator` / `getAction`
 * **synchronously** (`packages/ingress/src/submit-intent.ts`), but reading the
 * control-plane pool is async. To keep the port sync without an async hop
 * *inside* the pipeline, the three lookups are PURE SYNC reads of a
 * process-local snapshot + compiled-validator cache — they kick no refresh.
 * Freshness is delivered deterministically at the REQUEST BOUNDARY:
 * `apps/server/src/middleware/registry-refresh.ts` awaits `refresh()` before
 * the authed `intents` routes run, so a row written out-of-band (the
 * hot-registration path) is observed on the NEXT request — same process,
 * stable bootId (I20), the spec's N+1 visibility guarantee. (The earlier
 * fire-and-forget-from-lookup design gave N+2 visibility and is removed.)
 * Because the registry tables are tiny platform data (the bundled seed + a
 * handful of runtime registrations), an unconditional reload per boundary is
 * cheap; the `registry_version` cursor drives the *compiled-validator* cache
 * invalidation (a changed document under an existing `(schemaId,version)`
 * recompiles), event/version-driven, not TTL (I10 spirit). PUBLIC (not
 * tenant-scoped) — the I9 tenant-key rule does not apply to platform intent
 * schemas.
 *
 * The bundled `@atlas/schemas` set is the SEED for these tables (see
 * `schema-registry-seed.ts`), not the live source.
 *
 * @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md
 */

import { compileValidator, bundledSchemaSeed, bundledActionSeed } from '@atlas/schemas';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import type { ActionEntry, ControlPlaneRegistry } from '@atlas/ports';
import type { Logger } from '@atlas/platform-core';
import type postgres from 'postgres';

interface SchemaSnapshotRow {
  schemaId: string;
  schemaVersion: number;
  document: Record<string, unknown>;
  /** Stable fingerprint of `document` — drives compiled-validator invalidation. */
  fingerprint: string;
}

interface RegistrySnapshot {
  /** Keyed by `${schemaId}:${schemaVersion}`. */
  schemas: Map<string, SchemaSnapshotRow>;
  /** Keyed by `actionId`. */
  actions: Map<string, ActionEntry>;
}

interface CachedValidator {
  validate: ValidateFunction;
  /** The document fingerprint this validator was compiled from. */
  fingerprint: string;
}

function schemaKey(schemaId: string, schemaVersion: number): string {
  return `${schemaId}:${schemaVersion}`;
}

function fingerprint(document: Record<string, unknown>): string {
  return JSON.stringify(document);
}

/**
 * Build a snapshot from the bundled `@atlas/schemas` set. Used when the
 * registry is constructed WITHOUT a control-plane pool — the bundled set is
 * the seed, and a store-less registry serves it directly so the sim + the
 * static contract suite resolve bundled actions/schemas (matching a
 * freshly-seeded Postgres registry).
 */
function bundleSnapshot(): RegistrySnapshot {
  const schemas = new Map<string, SchemaSnapshotRow>();
  for (const row of bundledSchemaSeed()) {
    schemas.set(schemaKey(row.schemaId, row.schemaVersion), {
      schemaId: row.schemaId,
      schemaVersion: row.schemaVersion,
      document: row.document,
      fingerprint: fingerprint(row.document),
    });
  }
  const actions = new Map<string, ActionEntry>();
  for (const entry of bundledActionSeed()) {
    actions.set(entry.actionId, {
      actionId: entry.actionId,
      resourceType: entry.resourceType,
      schemaId: entry.schemaId,
      schemaVersion: entry.schemaVersion,
    });
  }
  return { schemas, actions };
}

export class PostgresControlPlaneRegistry implements ControlPlaneRegistry {
  private snapshot: RegistrySnapshot;
  /** Per-`(schemaId,schemaVersion)` compiled-validator cache; recompiled on document change. */
  private readonly validatorCache: Map<string, CachedValidator>;
  private refreshing = false;
  private readonly initialLoad: Promise<void> | null;

  /**
   * @param controlPlane Control-plane pool — the live source. When absent, the
   *   registry serves the bundled seed directly (the sim + static contract path).
   * @param logger Optional boot-context logger for refresh-failure diagnostics.
   */
  constructor(
    private readonly controlPlane?: postgres.Sql,
    private readonly logger?: Logger,
  ) {
    this.snapshot = this.controlPlane
      ? { schemas: new Map(), actions: new Map() }
      : bundleSnapshot();
    this.validatorCache = new Map();

    // Prime the snapshot once at construction. Thereafter the snapshot is
    // refreshed deterministically at the request boundary (the
    // `registryRefreshMiddleware` awaits `refresh()` before the authed intents
    // routes), NOT kicked from a lookup — the three lookups stay pure sync
    // reads. A row written out-of-band is therefore observed on the NEXT
    // request (N+1), same process, stable bootId (I20). We run no perpetual
    // background poll: it would hold a pool connection busy and leak across
    // contract cases. See the O1 note above + the capability README.
    this.initialLoad = this.controlPlane ? this.refresh() : null;
  }

  /**
   * Reload the registry tables into the process-local snapshot. The row data is
   * reloaded unconditionally (the tables are small platform data); the
   * compiled-validator cache is invalidated per key by document fingerprint, so
   * a changed document under an existing `(schemaId,version)` recompiles
   * lazily on the next lookup.
   *
   * Reentrancy-guarded: overlapping refreshes collapse to one in-flight call.
   */
  async refresh(): Promise<void> {
    const sql = this.controlPlane;
    if (!sql || this.refreshing) return;
    this.refreshing = true;
    try {
      const schemaRows = await sql<
        { schema_id: string; schema_version: number; document: Record<string, unknown> }[]
      >`
        SELECT schema_id, schema_version, document FROM control_plane.intent_schemas
      `;
      const actionRows = await sql<
        { action_id: string; resource_type: string; schema_id: string; schema_version: number }[]
      >`
        SELECT action_id, resource_type, schema_id, schema_version
        FROM control_plane.action_entries
      `;

      const schemas = new Map<string, SchemaSnapshotRow>();
      for (const r of schemaRows) {
        schemas.set(schemaKey(r.schema_id, r.schema_version), {
          schemaId: r.schema_id,
          schemaVersion: r.schema_version,
          document: r.document,
          fingerprint: fingerprint(r.document),
        });
      }
      const actions = new Map<string, ActionEntry>();
      for (const r of actionRows) {
        actions.set(r.action_id, {
          actionId: r.action_id,
          resourceType: r.resource_type,
          schemaId: r.schema_id,
          schemaVersion: r.schema_version,
        });
      }
      this.snapshot = { schemas, actions };
    } catch (cause) {
      this.logger?.warn('control-plane registry refresh failed', {
        event: 'ControlPlaneRegistry.RefreshFailed',
        properties: { cause: cause instanceof Error ? cause.message : String(cause) },
      });
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Resolve the initial snapshot load and force one more refresh. Bootstrap
   * awaits this after seeding so the first request sees the seeded rows.
   * Lookups in the request path stay sync and never call this.
   */
  async waitForFreshSnapshot(): Promise<void> {
    if (this.initialLoad) await this.initialLoad;
    await this.refresh();
  }

  /** No-op retained for shutdown symmetry with adapters that hold timers. */
  close(): void {
    // The registry holds no background timer/loop; nothing to tear down.
  }

  hasAction(actionId: string): boolean {
    // Pure sync read of the snapshot — freshness is delivered by the
    // request-boundary refresh, not kicked from here (O1).
    return this.snapshot.actions.has(actionId);
  }

  getAction(actionId: string): ActionEntry | null {
    // Pure sync read of the snapshot (see O1 note above).
    return this.snapshot.actions.get(actionId) ?? null;
  }

  getSchemaValidator(schemaId: string, version: number): ValidateFunction | null {
    // Pure sync read of the snapshot + compiled-validator cache (O1).
    const key = schemaKey(schemaId, version);
    const row = this.snapshot.schemas.get(key);
    if (!row) return null;
    const cached = this.validatorCache.get(key);
    // Version-driven invalidation: recompile when the row's document changed
    // (a rewritten (schemaId,version) row), serve the cached validator otherwise.
    if (cached && cached.fingerprint === row.fingerprint) return cached.validate;
    const validate = compileValidator(row.document);
    this.validatorCache.set(key, { validate, fingerprint: row.fingerprint });
    return validate;
  }
}
