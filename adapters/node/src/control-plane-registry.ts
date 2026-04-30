/**
 * PostgresControlPlaneRegistry — TypeScript port of
 * `crates/adapters/src/postgres_registry.rs`, narrowed to the three
 * methods the TS `ControlPlaneRegistry` port currently exposes:
 * `hasAction`, `getAction`, `getSchemaValidator`.
 *
 * **Decision (Plan §"Decisions baked in" #4):** for v1 parity the action
 * catalog is read from the bundled module manifests in `@atlas/schemas`,
 * not from `control_plane.module_versions`. The IDB sim and the Postgres
 * server need to expose the same actions; the bundles are the single source.
 * The control-plane pool is held for future use (live schema lookups,
 * tenant-module enablement) but is unused by the three port methods today.
 *
 * Schema validators come from the same ajv registry the IDB adapter uses
 * (`@atlas/schemas`).
 *
 * Chunk 8: the registry now consumes the *array* of per-module manifests
 * via `moduleManifests()`. On duplicate `actionId` (or duplicate
 * `resourceType`) the last manifest wins and a warning is emitted. The
 * old `moduleManifest()` (singular, deprecated) accessor is no longer
 * called here.
 */

import { moduleManifests, getSchemaValidator } from '@atlas/schemas';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import type { ActionEntry, ControlPlaneRegistry } from '@atlas/ports';
import type postgres from 'postgres';
import { actionIdToSchemaId } from './action-schema-id.ts';

interface ManifestActionLike {
  actionId: string;
  resourceType: string;
}

interface ManifestLike {
  moduleId?: string;
  actions?: ManifestActionLike[];
}

/**
 * Construct from the bundled manifests. Matches `InMemoryControlPlaneRegistry`
 * in `@atlas/adapter-idb` exactly — same source data, same shape.
 *
 * Schema id is derived from `actionId` via `actionIdToSchemaId` (no
 * static map): `Catalog.SeedPackage.Apply` -> `catalog.seed_package.apply.v1`.
 * Adding a new action only requires the manifest entry plus the
 * generated schema; no code edit here.
 */
export class PostgresControlPlaneRegistry implements ControlPlaneRegistry {
  private readonly actions: Map<string, ActionEntry>;

  /**
   * @param controlPlane Held for future expansion. Not consulted today.
   */
  constructor(private readonly controlPlane?: postgres.Sql) {
    void this.controlPlane;
    this.actions = new Map();
    const manifests = moduleManifests() as ReadonlyArray<ManifestLike>;
    // Track which moduleId originally registered each actionId so dup
    // warnings carry useful context.
    const ownerByAction = new Map<string, string>();
    for (const manifest of manifests) {
      const ownerId = manifest.moduleId ?? '<unknown>';
      for (const a of manifest.actions ?? []) {
        const { schemaId, schemaVersion } = actionIdToSchemaId(a.actionId);
        // Skip silently if no validator is registered for the derived
        // schemaId — keeps parity with the IDB adapter which also tolerates
        // manifest entries that have no bundled schema.
        if (getSchemaValidator(schemaId, schemaVersion) == null) continue;
        if (this.actions.has(a.actionId)) {
          // last-wins, but loud — manifest collisions are an architectural
          // smell (two modules claiming the same action). We don't throw
          // because the bundle ships in production and we'd rather degrade
          // than crash boot.
          // eslint-disable-next-line no-console
          console.warn(
            `[control-plane-registry] duplicate actionId "${a.actionId}": ` +
              `previously declared by "${ownerByAction.get(a.actionId) ?? '<unknown>'}", ` +
              `now overwritten by "${ownerId}" (last-wins)`,
          );
        }
        ownerByAction.set(a.actionId, ownerId);
        this.actions.set(a.actionId, {
          actionId: a.actionId,
          resourceType: a.resourceType,
          schemaId,
          schemaVersion,
        });
      }
    }
  }

  hasAction(actionId: string): boolean {
    return this.actions.has(actionId);
  }

  getAction(actionId: string): ActionEntry | null {
    return this.actions.get(actionId) ?? null;
  }

  getSchemaValidator(schemaId: string, version: number): ValidateFunction | null {
    return getSchemaValidator(schemaId, version);
  }
}
