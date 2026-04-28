// ControlPlaneRegistry is intentionally narrow. The Rust port exposes more
// methods (get_tenant, list_enabled_modules, ...) that the TS implementation
// does not need yet — the TS impl reads bundled JSON, not a database.
// Expand this port when Chunk 4+ introduces a Postgres-backed control plane
// registry that genuinely needs the richer API.

import type { ValidateFunction } from 'ajv/dist/2020.js';

export interface ActionEntry {
  actionId: string;
  resourceType: string;
  schemaId: string;
  schemaVersion: number;
}

export interface ControlPlaneRegistry {
  hasAction(actionId: string): boolean;
  getAction(actionId: string): ActionEntry | null;
  getSchemaValidator(schemaId: string, version: number): ValidateFunction | null;
}
