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

export { IngressError } from './errors.ts';
export type { ErrorBody, IngressErrorCode } from './errors.ts';

export { SingleFlight } from './singleflight.ts';
export { CachedRead } from './cached-read.ts';

export {
  buildCacheKey,
  renderTags,
  validateCacheArtifact,
  validateCacheKeyInputs,
  extractPlaceholder,
  extractAllPlaceholders,
  CacheError,
} from './cache-key.ts';
export type { CacheErrorKind, CacheErrorDetail } from './cache-key.ts';

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

export { normalizeHost, tenantBaseUrl } from './tenant-urls.ts';
export type { PrimaryCustomDomainLookup } from './tenant-urls.ts';

export { UpcasterRegistry, upcastToLatest } from './upcaster.ts';
export type { Upcaster } from './upcaster.ts';

export {
  indexNameFor,
  jsonbPathExpr,
  createIndexSql,
  dropIndexSql,
  reconcile as reconcileEntityIndexes,
} from './entity-indexer.ts';

export {
  envBool,
  envOr,
  envRequired,
  isStrictMode,
  forbidInStrict,
} from './env.ts';

// Logging / execution-context primitives. Interfaces only — the
// implementation lives in @atlas/logging. Per specs/crosscut/logging.md.
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

export {
  ValidationError,
  validateEventEnvelope,
  validateModuleManifest,
  validateSearchDocuments,
  validateAnalyticsEvents,
} from './validation.ts';
export type { ValidationErrorKind, CoreAnalyticsEvent } from './validation.ts';
