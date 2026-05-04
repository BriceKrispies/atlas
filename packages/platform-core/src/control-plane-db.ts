/**
 * TypeScript port of the row DTOs defined in
 * `crates/control_plane_db/src/models.rs`.
 *
 * These mirror the Rust `serde`-serialised shape one-for-one. The Rust
 * structs use `chrono::DateTime<Utc>` and `serde_json::Value`; on the wire
 * those become RFC 3339 strings and arbitrary JSON, respectively. Field
 * names follow the Rust source — none of the Rust types declare
 * `#[serde(rename_all = "camelCase")]`, so the on-the-wire representation
 * is **snake_case**. We surface them here in their snake_case form so the
 * TS adapter can read rows from `postgres.js` without a column-name
 * translation step (postgres.js returns column names as-is, and these
 * already match the column names).
 *
 * If a future refactor introduces a camelCase API surface for these
 * entities, define a separate camelCase DTO with explicit conversion —
 * don't lie about the wire shape here.
 */

/** Arbitrary JSON value (the TS analogue of `serde_json::Value`). */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Row of `control_plane.tenants`. */
export interface Tenant {
  tenant_id: string;
  name: string;
  status: string;
  region: string | null;
  /** ISO-8601 timestamp (Rust: `DateTime<Utc>`). */
  created_at: string;
}

/** Row of `control_plane.modules`. */
export interface Module {
  module_id: string;
  display_name: string;
  latest_version: string;
  created_at: string;
}

/** Row of `control_plane.module_versions`. */
export interface ModuleVersion {
  module_id: string;
  version: string;
  manifest_json: JsonValue;
  schema_hash: string;
  created_at: string;
}

/** Row of `control_plane.tenant_modules`. */
export interface TenantModule {
  tenant_id: string;
  module_id: string;
  enabled_version: string;
  enabled_at: string;
  config_json: JsonValue | null;
}

/** Row of `control_plane.schema_registry`. */
export interface SchemaRegistryEntry {
  schema_id: string;
  version: number;
  json_schema: JsonValue;
  /** One of `BACKWARD`, `FORWARD`, `FULL`, `NONE` (string in DB). */
  compat_mode: string;
  created_at: string;
}

/** Row of `control_plane.policies`. */
export interface PolicyBundle {
  tenant_id: string;
  version: number;
  policy_json: JsonValue;
  /** One of `draft`, `active`, `archived`. */
  status: string;
  created_at: string;
}

/**
 * Row of `control_plane.custom_domains`. **Stub-mode shape** — verification
 * + cert columns (validation_token, verified_at, cert_provider, cert_ref)
 * land in a follow-up migration when the real DNS-validation / cert-issuance
 * flow ships. The `status` column is currently constrained to
 * `'active' | 'disabled'`; the real flow widens it to also include
 * `'pending' | 'verified'`. See
 * `specs/domains/tenancy/capabilities/custom-domains/README.md` for the
 * upgrade plan.
 */
export interface CustomDomainRow {
  hostname: string;
  tenant_id: string;
  /** One of `active`, `disabled` (stub). Future: `pending`, `verified`. */
  status: string;
  is_primary: boolean;
  created_at: string;
}

// ---------------- L3 metadata registries (Phase A) ----------------
// These DTOs mirror `control_plane.entity_type_registry`,
// `control_plane.field_registry`, and `control_plane.index_registry`.
// `tenant_id IS NULL` rows are platform defaults inherited by every tenant;
// non-NULL rows are tenant overrides (populated in Phase F).

export type RegistryOrigin = 'platform' | 'tenant' | 'package';

/** Row of `control_plane.entity_type_registry`. */
export interface EntityTypeRow {
  entity_type: string;
  tenant_id: string | null;
  schema_version: number;
  json_schema: JsonValue;
  origin: RegistryOrigin;
  package_id: string | null;
  created_at: string;
}

/** Row of `control_plane.field_registry`. */
export interface FieldRow {
  entity_type: string;
  tenant_id: string | null;
  field_path: string;
  /** 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'reference' | 'geo-point' | 'json' | … */
  data_type: string;
  label: string | null;
  help_text: string | null;
  is_required: boolean;
  default_value: JsonValue | null;
  constraints: JsonValue | null;
  origin: RegistryOrigin;
  package_id: string | null;
  created_at: string;
}

/** Row of `control_plane.index_registry`. */
export interface IndexDeclarationRow {
  entity_type: string;
  tenant_id: string | null;
  index_name: string;
  /** Ordered JSONB-path strings, e.g. `["familyKey", "revisionNumber"]`. */
  field_paths: string[];
  is_unique: boolean;
  /** Stored as `{ "<path>": <value> }`; null means no WHERE clause. */
  where_clause: JsonValue | null;
  origin: RegistryOrigin;
  package_id: string | null;
  created_at: string;
}
