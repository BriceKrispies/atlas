/**
 * EntityTypeRegistry — read-side view of the metadata that governs
 * `EntityStore` rows.
 *
 * Three registries stitched into one port:
 *   1. Entity types — name + JSON-schema + ownership
 *   2. Fields       — per-field metadata (label, type, validation)
 *   3. Indexes      — declared expression indexes for the materializer
 *
 * Tenant resolution: pass `tenantId` to each accessor. The adapter
 * resolves "tenant override > platform default" — a tenant-specific row
 * wins; otherwise the platform default (where `tenant_id IS NULL`) is
 * used. Phase A only writes platform defaults; Phase F (tenant
 * customization) populates tenant-specific rows.
 *
 * Writes (registering / updating / removing types) are deliberately not
 * on this port. They go through dedicated operator surfaces (an admin
 * API in Phase F, an `atlasctl entity-type ...` CLI for Phase A
 * platform-wide registration).
 */

import type { EntityTypeRow, FieldRow, IndexDeclarationRow } from '@atlas/abi';

export interface EntityTypeRegistry {
  /**
   * Get the registered entity type, resolving tenant override > platform
   * default. Returns null when neither exists.
   */
  getEntityType(entityType: string, tenantId: string): Promise<EntityTypeRow | null>;

  /** All entity types visible to a tenant (overrides + platform defaults). */
  listEntityTypes(tenantId: string): Promise<EntityTypeRow[]>;

  /**
   * All fields for an entity type, with override resolution applied.
   * Fields whose tenant override exists shadow the platform default.
   */
  listFields(entityType: string, tenantId: string): Promise<FieldRow[]>;

  /**
   * All declared indexes for an entity type. The platform-wide subset
   * (`tenant_id IS NULL`) is what the index materializer reconciles
   * at boot; tenant-specific indexes are added once Phase F custom-fields
   * lands.
   */
  listIndexes(entityType: string, tenantId: string | null): Promise<IndexDeclarationRow[]>;

  /**
   * Cross-cutting: all platform-default indexes across every entity type.
   * The startup materializer iterates this to reconcile the live DB.
   */
  listAllPlatformIndexes(): Promise<IndexDeclarationRow[]>;
}
