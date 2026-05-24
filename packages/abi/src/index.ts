/**
 * @atlas/abi — Ring 0. The application binary interface: the pure contract
 * types every Atlas program speaks (envelopes, principal, control-plane row
 * shapes, the logging/execution-context contract, module-manifest shapes, and
 * the DSL artifact envelope). Zero workspace dependencies by construction.
 *
 * Carved from @atlas/platform-core per ADR 0016 so that @atlas/ports (Ring 1)
 * can reference these shapes without an outward edge to the runtime (Ring 2).
 * @atlas/platform-core re-exports everything here, so its public surface is
 * unchanged for existing consumers.
 */

export type {
  EventEnvelope,
  IntentEnvelope,
  IntentPayload,
  IntentResponse,
  Principal,
  SearchDocument,
  CacheSetOptions,
  AnalyticsEvent,
  ServerEvent,
} from './types.ts';

export type {
  JsonValue,
  Tenant,
  Module,
  ModuleVersion,
  TenantModule,
  SchemaRegistryEntry,
  PolicyBundle,
  CustomDomainRow,
  EntityTypeRow,
  FieldRow,
  IndexDeclarationRow,
  RegistryOrigin,
} from './control-plane-db.ts';

export type { LogLevel, LogEvent, LogEventError } from './log-event.ts';
export type { Logger, LogFields } from './logger.ts';
export type {
  AtlasEnvironment,
  AtlasExecutionContext,
  AtlasExecutionContextPatch,
} from './execution-context.ts';

export type {
  ModuleManifest,
  ActionDeclaration,
  ResourceDeclaration,
  EventDeclaration,
  ProjectionDeclaration,
  MigrationDeclaration,
  UiRouteDeclaration,
  JobDeclaration,
  CacheArtifact,
  AuditLevel,
  EventCategory,
  SchemaCompatibility,
  VaryDimension,
  PrivacyLevel,
} from './manifest.ts';

export type {
  SourceRange,
  SourceMap,
  ArtifactRef,
  DslArtifact,
} from './dsl-artifact.ts';
