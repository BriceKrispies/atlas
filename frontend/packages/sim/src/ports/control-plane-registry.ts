import { moduleManifest, getSchemaValidator } from '../schemas/loader.ts';
import type { ValidateFunction } from 'ajv/dist/2020.js';

interface ActionEntry {
  actionId: string;
  resourceType: string;
  schemaId: string;
  schemaVersion: number;
}

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

export class ControlPlaneRegistryPort {
  private actions: Map<string, ActionEntry>;

  constructor() {
    this.actions = new Map();
    const manifest = moduleManifest() as { actions?: Array<{ actionId: string; resourceType: string }> };
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
