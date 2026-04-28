import { moduleManifest, getSchemaValidator } from '@atlas/schemas';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import type { ActionEntry, ControlPlaneRegistry } from '@atlas/ports';

/**
 * Convention-based mapping from a manifest `actionId` to its payload-schema
 * id. PascalCase segments become lower_snake_case, joined by `.`, suffix
 * `.v1`. Mirrors `@atlas/adapters-node/src/action-schema-id.ts`; both
 * adapters share the same `@atlas/schemas` source of truth.
 *
 *   `Catalog.SeedPackage.Apply` -> `catalog.seed_package.apply.v1`
 */
const PASCAL_BOUNDARY = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g;

function toSnake(segment: string): string {
  return segment.replace(PASCAL_BOUNDARY, '_').toLowerCase();
}

function actionIdToSchemaId(actionId: string): { schemaId: string; schemaVersion: number } {
  const segments = actionId.split('.').map(toSnake).filter((s) => s.length > 0);
  return { schemaId: `${segments.join('.')}.v1`, schemaVersion: 1 };
}

export class InMemoryControlPlaneRegistry implements ControlPlaneRegistry {
  private actions: Map<string, ActionEntry>;

  constructor() {
    this.actions = new Map();
    const manifest = moduleManifest() as { actions?: Array<{ actionId: string; resourceType: string }> };
    for (const a of manifest.actions ?? []) {
      const { schemaId, schemaVersion } = actionIdToSchemaId(a.actionId);
      if (getSchemaValidator(schemaId, schemaVersion) == null) continue;
      this.actions.set(a.actionId, {
        actionId: a.actionId,
        resourceType: a.resourceType,
        schemaId,
        schemaVersion,
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
