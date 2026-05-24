import { compileValidator, bundledSchemaSeed, bundledActionSeed } from '@atlas/schemas';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import type { ActionEntry, ControlPlaneRegistry } from '@atlas/ports';
import type { Logger } from '@atlas/platform-core';

/**
 * In-memory mirror of the control-plane schema/action registry stores
 * (`control_plane.intent_schemas` / `control_plane.action_entries` +
 * `registry_version` cursor). Backs the dynamic-registration path so the sim
 * + contract suite agree with the Postgres adapter (node↔idb parity).
 *
 * @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#control-plane-storage-shape
 */
export interface InMemorySchemaRegistryStore {
  /** Keyed by `${schemaId}:${schemaVersion}`. */
  schemas: Map<
    string,
    {
      schemaId: string;
      schemaVersion: number;
      document: Record<string, unknown>;
      source: 'seed' | 'registered';
    }
  >;
  /** Keyed by `actionId`. */
  actions: Map<string, ActionEntry & { source: 'seed' | 'registered' }>;
  /** Monotonic change cursor — bumped on every write; the registry refreshes its snapshot when it advances. */
  version: number;
}

function schemaKey(schemaId: string, schemaVersion: number): string {
  return `${schemaId}:${schemaVersion}`;
}

/** Synchronously seed a store from the bundled `@atlas/schemas` set (source='seed'). */
function seedStoreFromBundle(store: InMemorySchemaRegistryStore): void {
  for (const row of bundledSchemaSeed()) {
    const key = schemaKey(row.schemaId, row.schemaVersion);
    if (store.schemas.has(key)) continue;
    store.schemas.set(key, {
      schemaId: row.schemaId,
      schemaVersion: row.schemaVersion,
      document: row.document,
      source: 'seed',
    });
  }
  for (const entry of bundledActionSeed()) {
    if (store.actions.has(entry.actionId)) continue;
    store.actions.set(entry.actionId, {
      actionId: entry.actionId,
      resourceType: entry.resourceType,
      schemaId: entry.schemaId,
      schemaVersion: entry.schemaVersion,
      source: 'seed',
    });
  }
  store.version += 1;
}

/**
 * In-memory `ControlPlaneRegistry`. Lookups read directly from the backing
 * `dynamicStore` (the in-memory analogue of the control-plane tables); the
 * per-`(schemaId,schemaVersion)` compiled-validator cache is dropped whenever
 * the store's `version` cursor advances past the version the cache was built
 * against (version-driven invalidation, mirroring the Postgres adapter). The
 * sync port surface is preserved (decision O1): the store is in-process, so no
 * async hop is needed to observe a write.
 *
 * When constructed WITHOUT a `dynamicStore`, the registry creates its own
 * store and seeds it from the bundled `@atlas/schemas` set — matching the
 * Postgres adapter's seeded-control-plane state (the bundle seeds the live
 * source on first boot). This is what makes the store-less static contract
 * (`new InMemoryControlPlaneRegistry()` resolving bundled actions/schemas)
 * agree with a freshly-seeded Postgres registry.
 */
export class InMemoryControlPlaneRegistry implements ControlPlaneRegistry {
  private readonly dynamicStore: InMemorySchemaRegistryStore;
  private validatorCache: Map<string, ValidateFunction>;
  private cacheVersion: number;

  constructor(_logger?: Logger, dynamicStore?: InMemorySchemaRegistryStore) {
    void _logger;
    if (dynamicStore) {
      this.dynamicStore = dynamicStore;
    } else {
      this.dynamicStore = { schemas: new Map(), actions: new Map(), version: 0 };
      seedStoreFromBundle(this.dynamicStore);
    }
    this.validatorCache = new Map();
    this.cacheVersion = -1;
  }

  /**
   * Drop the compiled-validator cache when the store cursor has advanced since
   * the cache was built. Cheap (a number compare) and called on every lookup
   * so a row change is observed on the next request.
   */
  private syncCache(): void {
    const store = this.dynamicStore;
    if (store.version !== this.cacheVersion) {
      this.validatorCache = new Map();
      this.cacheVersion = store.version;
    }
  }

  hasAction(actionId: string): boolean {
    return this.dynamicStore.actions.has(actionId);
  }

  getAction(actionId: string): ActionEntry | null {
    const row = this.dynamicStore.actions.get(actionId);
    if (!row) return null;
    // Strip the provenance `source` tag — the port shape is `ActionEntry`.
    return {
      actionId: row.actionId,
      resourceType: row.resourceType,
      schemaId: row.schemaId,
      schemaVersion: row.schemaVersion,
    };
  }

  getSchemaValidator(schemaId: string, version: number): ValidateFunction | null {
    const store = this.dynamicStore;
    this.syncCache();
    const key = schemaKey(schemaId, version);
    const cached = this.validatorCache.get(key);
    if (cached) return cached;
    const row = store.schemas.get(key);
    if (!row) return null;
    const validate = compileValidator(row.document);
    this.validatorCache.set(key, validate);
    return validate;
  }
}
