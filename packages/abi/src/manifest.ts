// Module manifest types — pure data shapes mirroring `crates/core/src/types.rs`.
// Field names match the Rust serde JSON output (camelCase for structs,
// SCREAMING_SNAKE_CASE for these enums).

export type AuditLevel = 'NONE' | 'INFO' | 'BASIC' | 'SENSITIVE' | 'FULL_PAYLOAD';

export type EventCategory = 'DOMAIN' | 'INTEGRATION' | 'ANALYTICS';

export type SchemaCompatibility = 'FORWARD' | 'BACKWARD' | 'FULL' | 'NONE';

export type VaryDimension = 'TENANT' | 'LOCALE' | 'ROLE' | 'USER';

export type PrivacyLevel = 'PUBLIC' | 'TENANT' | 'USER';

export interface ActionDeclaration {
  actionId: string;
  resourceType: string;
  verb: string;
  auditLevel: AuditLevel;
}

export interface ResourceDeclaration {
  resourceType: string;
  ownership: string;
}

export interface EventDeclaration {
  eventType: string;
  category: EventCategory;
  schemaId: string;
  compatibility: SchemaCompatibility;
}

export interface ProjectionDeclaration {
  projectionName: string;
  inputEvents: string[];
  outputModel: string;
  rebuildable: boolean;
}

export interface MigrationDeclaration {
  migrationId: string;
  description: string;
}

export interface UiRouteDeclaration {
  path: string;
  component: string;
}

export interface JobDeclaration {
  jobType: string;
  schemaId: string;
  triggeredBy: string[];
  idempotencyKey: string;
}

export interface CacheArtifact {
  artifactId: string;
  varyBy: VaryDimension[];
  ttlSeconds: number;
  tags: string[];
  privacy: PrivacyLevel;
}

export interface ModuleManifest {
  moduleId: string;
  displayName: string;
  version: string;
  actions: ActionDeclaration[];
  resources: ResourceDeclaration[];
  events: EventDeclaration[];
  projections: ProjectionDeclaration[];
  migrations: MigrationDeclaration[];
  uiRoutes: UiRouteDeclaration[];
  jobs: JobDeclaration[];
  cacheArtifacts: CacheArtifact[];
  capabilities: string[];
}
