/**
 * PostgresControlPlaneRegistry — TypeScript port of
 * `crates/adapters/src/postgres_registry.rs`, narrowed to the three
 * methods the TS `ControlPlaneRegistry` port currently exposes:
 * `hasAction`, `getAction`, `getSchemaValidator`.
 *
 * **Decision (Plan §"Decisions baked in" #4):** for v1 parity the action
 * catalog is read from the bundled module manifest in `@atlas/schemas`,
 * not from `control_plane.module_versions`. The IDB sim and the Postgres
 * server need to expose the same actions; the bundle is the single source.
 * The control-plane pool is held for future use (live schema lookups,
 * tenant-module enablement) but is unused by the three port methods today.
 *
 * Schema validators come from the same ajv registry the IDB adapter uses
 * (`@atlas/schemas`).
 */

import { moduleManifest, getSchemaValidator } from '@atlas/schemas';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import type { ActionEntry, ControlPlaneRegistry } from '@atlas/ports';
import type postgres from 'postgres';

const ACTION_SCHEMA_BY_ID: Record<string, { schemaId: string; schemaVersion: number }> = {
  'Catalog.SeedPackage.Apply': {
    schemaId: 'catalog.seed_package.apply.v1',
    schemaVersion: 1,
  },
  'Catalog.Family.Publish': {
    schemaId: 'catalog.family.publish.v1',
    schemaVersion: 1,
  },
};

/**
 * Construct from the bundled manifest. Matches `InMemoryControlPlaneRegistry`
 * in `@atlas/adapters-idb` exactly — same source data, same shape.
 */
export class PostgresControlPlaneRegistry implements ControlPlaneRegistry {
  private readonly actions: Map<string, ActionEntry>;

  /**
   * @param controlPlane Held for future expansion. Not consulted today.
   */
  constructor(private readonly controlPlane?: postgres.Sql) {
    void this.controlPlane;
    this.actions = new Map();
    const manifest = moduleManifest() as {
      actions?: Array<{ actionId: string; resourceType: string }>;
    };
    for (const a of manifest.actions ?? []) {
      const mapping = ACTION_SCHEMA_BY_ID[a.actionId];
      if (!mapping) continue;
      this.actions.set(a.actionId, {
        actionId: a.actionId,
        resourceType: a.resourceType,
        schemaId: mapping.schemaId,
        schemaVersion: mapping.schemaVersion,
      });
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
