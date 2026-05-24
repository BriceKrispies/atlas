// Semantic validators for Atlas domain types.
//
// Port of `crates/core/src/validation.rs`. Pure functions: no I/O, no
// network, no file access. Used both at runtime (ingress, workers) and at
// CI/dev-time (spec-validate runner).
//
// The `ValidationError` taxonomy maps 1:1 to the Rust enum variants:
//   MissingField, InvalidFormat, Duplicate, InvalidReference,
//   ConstraintViolation.

import type { EventEnvelope, SearchDocument } from '@atlas/abi';
import type { ModuleManifest } from '@atlas/abi';

/**
 * Analytics event shape mirroring `crates/core/src/types.rs::AnalyticsEvent`
 * (the Rust core domain type used by `validate_analytics_events`). This is
 * distinct from the `AnalyticsEvent` re-exported from `./types.ts`, which is
 * the slimmer port-side shape the `AnalyticsStore` port uses.
 */
export interface CoreAnalyticsEvent {
  eventId: string;
  eventType: string;
  tenantId: string;
  dimensions: Record<string, string>;
  metrics: Record<string, number>;
  timestamp: string;
  schemaId: string;
}

/**
 * Discriminator matching every Rust `ValidationError` variant.
 */
export type ValidationErrorKind =
  | 'MissingField'
  | 'InvalidFormat'
  | 'Duplicate'
  | 'InvalidReference'
  | 'ConstraintViolation';

/**
 * Structured validation error. The `kind` discriminator and `field` /
 * `message` payloads track the Rust `ValidationError` enum exactly so the
 * cross-runtime error strings stay aligned.
 */
export class ValidationError extends Error {
  override readonly name = 'ValidationError';
  readonly kind: ValidationErrorKind;
  readonly field?: string;

  private constructor(kind: ValidationErrorKind, message: string, field?: string) {
    super(message);
    this.kind = kind;
    if (field !== undefined) {
      this.field = field;
    }
  }

  static missingField(field: string): ValidationError {
    return new ValidationError('MissingField', `Missing required field: ${field}`, field);
  }

  static invalidFormat(message: string): ValidationError {
    return new ValidationError('InvalidFormat', `Invalid format: ${message}`);
  }

  static duplicate(message: string): ValidationError {
    return new ValidationError('Duplicate', `Duplicate value: ${message}`);
  }

  static invalidReference(message: string): ValidationError {
    return new ValidationError('InvalidReference', `Invalid reference: ${message}`);
  }

  static constraintViolation(message: string): ValidationError {
    return new ValidationError('ConstraintViolation', `Constraint violation: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Drains the leading object check: ensure value is a plain object. */
function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw ValidationError.invalidFormat(`${what} must be an object`);
  }
  return value;
}

/** Drains the leading array check: ensure value is an array. */
function requireArray(value: unknown, what: string): unknown[] {
  if (!isArray(value)) {
    throw ValidationError.invalidFormat(`${what} must be an array`);
  }
  return value;
}

/** Verify presence of a non-empty string field on an object; throw on miss. */
function requireNonEmptyString(
  obj: Record<string, unknown>,
  field: string,
): string {
  const v = obj[field];
  if (!isString(v) || v.length === 0) {
    throw ValidationError.missingField(field);
  }
  return v;
}

// ---------------------------------------------------------------------------
// EventEnvelope
// ---------------------------------------------------------------------------

/**
 * Validate an EventEnvelope against platform invariants.
 *
 * Enforces (mirrors `validate_event_envelope` in Rust):
 * - Invariant I3: `idempotencyKey` is required and non-empty
 * - `eventType` must follow `Module.EventName` pattern (contains a dot)
 * - `schemaVersion` must be >= 1
 * - `eventId`, `tenantId`, `correlationId`, `schemaId` must be non-empty
 */
export function validateEventEnvelope(value: unknown): asserts value is EventEnvelope {
  const env = requireObject(value, 'EventEnvelope');

  // Invariant I3: idempotencyKey is required (matches Rust order).
  if (!isString(env['idempotencyKey']) || env['idempotencyKey'].length === 0) {
    throw ValidationError.missingField('idempotencyKey');
  }
  if (!isString(env['eventId']) || env['eventId'].length === 0) {
    throw ValidationError.missingField('eventId');
  }
  if (!isString(env['tenantId']) || env['tenantId'].length === 0) {
    throw ValidationError.missingField('tenantId');
  }
  if (!isString(env['correlationId']) || env['correlationId'].length === 0) {
    throw ValidationError.missingField('correlationId');
  }

  const eventType = env['eventType'];
  if (!isString(eventType)) {
    throw ValidationError.missingField('eventType');
  }
  if (!eventType.includes('.')) {
    throw ValidationError.invalidFormat(
      `eventType must follow Module.EventName pattern, got: ${eventType}`,
    );
  }

  const schemaVersion = env['schemaVersion'];
  if (!isFiniteNumber(schemaVersion)) {
    throw ValidationError.invalidFormat('schemaVersion must be a number');
  }
  if (schemaVersion < 1) {
    throw ValidationError.invalidFormat('schemaVersion must be >= 1');
  }

  if (!isString(env['schemaId']) || env['schemaId'].length === 0) {
    throw ValidationError.missingField('schemaId');
  }
}

// ---------------------------------------------------------------------------
// ModuleManifest
// ---------------------------------------------------------------------------

/**
 * Validate a ModuleManifest against platform invariants.
 *
 * Enforces (mirrors `validate_module_manifest` in Rust):
 * - moduleId, displayName, version must be non-empty
 * - resourceTypes unique within the module
 * - actionIds unique within the module
 * - Action `resourceType` must reference a declared resource
 * - eventTypes unique within the module; `Module.EventName` shape; schemaId set
 * - projections require `projectionName` and `outputModel`
 * - jobs require `jobType`, `schemaId`, `idempotencyKey`
 * - cache artifacts require `artifactId` and `ttlSeconds > 0`
 */
export function validateModuleManifest(value: unknown): asserts value is ModuleManifest {
  const m = requireObject(value, 'ModuleManifest');

  requireNonEmptyString(m, 'moduleId');
  requireNonEmptyString(m, 'displayName');
  requireNonEmptyString(m, 'version');

  // resources -----------------------------------------------------------
  const resources = m['resources'];
  if (resources !== undefined && !isArray(resources)) {
    throw ValidationError.invalidFormat('resources must be an array');
  }
  const resourceTypes = new Set<string>();
  for (const raw of (resources as unknown[] | undefined) ?? []) {
    const r = requireObject(raw, 'resources[]');
    const rt = r['resourceType'];
    if (!isString(rt) || rt.length === 0) {
      throw ValidationError.missingField('resources[].resourceType');
    }
    if (resourceTypes.has(rt)) {
      throw ValidationError.duplicate(`resourceType '${rt}' declared multiple times`);
    }
    resourceTypes.add(rt);
  }

  // actions -------------------------------------------------------------
  const actions = m['actions'];
  if (actions !== undefined && !isArray(actions)) {
    throw ValidationError.invalidFormat('actions must be an array');
  }
  const actionIds = new Set<string>();
  for (const raw of (actions as unknown[] | undefined) ?? []) {
    const a = requireObject(raw, 'actions[]');
    const aid = a['actionId'];
    if (!isString(aid) || aid.length === 0) {
      throw ValidationError.missingField('actions[].actionId');
    }
    if (actionIds.has(aid)) {
      throw ValidationError.duplicate(`actionId '${aid}' declared multiple times`);
    }
    actionIds.add(aid);
    const art = a['resourceType'];
    if (!isString(art) || art.length === 0) {
      throw ValidationError.missingField(`actions[${aid}].resourceType`);
    }
    if (!resourceTypes.has(art)) {
      throw ValidationError.invalidReference(
        `action '${aid}' references undeclared resourceType '${art}'`,
      );
    }
  }

  // events --------------------------------------------------------------
  const events = m['events'];
  if (events !== undefined && !isArray(events)) {
    throw ValidationError.invalidFormat('events must be an array');
  }
  const eventTypes = new Set<string>();
  for (const raw of (events as unknown[] | undefined) ?? []) {
    const e = requireObject(raw, 'events[]');
    const et = e['eventType'];
    if (!isString(et) || et.length === 0) {
      throw ValidationError.missingField('events[].eventType');
    }
    if (eventTypes.has(et)) {
      throw ValidationError.duplicate(`eventType '${et}' declared multiple times`);
    }
    eventTypes.add(et);
    const sid = e['schemaId'];
    if (!isString(sid) || sid.length === 0) {
      throw ValidationError.missingField(`events[${et}].schemaId`);
    }
    if (!et.includes('.')) {
      throw ValidationError.invalidFormat(
        `eventType must follow Module.EventName pattern, got: ${et}`,
      );
    }
  }

  // projections ---------------------------------------------------------
  const projections = m['projections'];
  if (projections !== undefined && !isArray(projections)) {
    throw ValidationError.invalidFormat('projections must be an array');
  }
  for (const raw of (projections as unknown[] | undefined) ?? []) {
    const p = requireObject(raw, 'projections[]');
    const pn = p['projectionName'];
    if (!isString(pn) || pn.length === 0) {
      throw ValidationError.missingField('projections[].projectionName');
    }
    const om = p['outputModel'];
    if (!isString(om) || om.length === 0) {
      throw ValidationError.missingField(`projections[${pn}].outputModel`);
    }
  }

  // jobs ----------------------------------------------------------------
  const jobs = m['jobs'];
  if (jobs !== undefined && !isArray(jobs)) {
    throw ValidationError.invalidFormat('jobs must be an array');
  }
  for (const raw of (jobs as unknown[] | undefined) ?? []) {
    const j = requireObject(raw, 'jobs[]');
    const jt = j['jobType'];
    if (!isString(jt) || jt.length === 0) {
      throw ValidationError.missingField('jobs[].jobType');
    }
    const sid = j['schemaId'];
    if (!isString(sid) || sid.length === 0) {
      throw ValidationError.missingField(`jobs[${jt}].schemaId`);
    }
    const idk = j['idempotencyKey'];
    if (!isString(idk) || idk.length === 0) {
      throw ValidationError.missingField(`jobs[${jt}].idempotencyKey`);
    }
  }

  // cacheArtifacts ------------------------------------------------------
  const cacheArtifacts = m['cacheArtifacts'];
  if (cacheArtifacts !== undefined && !isArray(cacheArtifacts)) {
    throw ValidationError.invalidFormat('cacheArtifacts must be an array');
  }
  for (const raw of (cacheArtifacts as unknown[] | undefined) ?? []) {
    const c = requireObject(raw, 'cacheArtifacts[]');
    const aid = c['artifactId'];
    if (!isString(aid) || aid.length === 0) {
      throw ValidationError.missingField('cacheArtifacts[].artifactId');
    }
    const ttl = c['ttlSeconds'];
    if (!isFiniteNumber(ttl) || ttl === 0) {
      throw ValidationError.constraintViolation(
        `cacheArtifact '${aid}' has ttlSeconds=0, must be > 0`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// SearchDocument[]
// ---------------------------------------------------------------------------

/**
 * Validate a list of SearchDocuments against platform invariants.
 *
 * Enforces (mirrors `validate_search_documents` in Rust):
 * - documentId, documentType, tenantId must be non-empty
 * - documentIds are unique within the batch
 */
export function validateSearchDocuments(
  value: unknown,
): asserts value is SearchDocument[] {
  const arr = requireArray(value, 'SearchDocument[]');
  const seen = new Set<string>();
  for (const raw of arr) {
    const d = requireObject(raw, 'SearchDocument');
    const id = d['documentId'];
    if (!isString(id) || id.length === 0) {
      throw ValidationError.missingField('documentId');
    }
    if (seen.has(id)) {
      throw ValidationError.duplicate(`documentId '${id}' appears multiple times`);
    }
    seen.add(id);
    const dt = d['documentType'];
    if (!isString(dt) || dt.length === 0) {
      throw ValidationError.missingField(`documents[${id}].documentType`);
    }
    const tid = d['tenantId'];
    if (!isString(tid) || tid.length === 0) {
      throw ValidationError.missingField(`documents[${id}].tenantId`);
    }
  }
}

// ---------------------------------------------------------------------------
// AnalyticsEvent[]
// ---------------------------------------------------------------------------

/**
 * Validate a list of AnalyticsEvents against platform invariants.
 *
 * Enforces (mirrors `validate_analytics_events` in Rust):
 * - eventId, eventType, tenantId, schemaId must be non-empty
 * - eventType follows `Module.event_name` (contains a dot)
 * - eventIds are unique within the batch
 *
 * Note: this validates the Rust core `AnalyticsEvent` shape (see
 * `CoreAnalyticsEvent`), which differs from the slimmer port-side
 * `AnalyticsEvent` exported from `./types.ts`.
 */
export function validateAnalyticsEvents(
  value: unknown,
): asserts value is CoreAnalyticsEvent[] {
  const arr = requireArray(value, 'AnalyticsEvent[]');
  const seen = new Set<string>();
  for (const raw of arr) {
    const e = requireObject(raw, 'AnalyticsEvent');
    const id = e['eventId'];
    if (!isString(id) || id.length === 0) {
      throw ValidationError.missingField('eventId');
    }
    if (seen.has(id)) {
      throw ValidationError.duplicate(`eventId '${id}' appears multiple times`);
    }
    seen.add(id);
    const et = e['eventType'];
    if (!isString(et) || et.length === 0) {
      throw ValidationError.missingField(`events[${id}].eventType`);
    }
    const tid = e['tenantId'];
    if (!isString(tid) || tid.length === 0) {
      throw ValidationError.missingField(`events[${id}].tenantId`);
    }
    const sid = e['schemaId'];
    if (!isString(sid) || sid.length === 0) {
      throw ValidationError.missingField(`events[${id}].schemaId`);
    }
    if (!et.includes('.')) {
      throw ValidationError.invalidFormat(
        `eventType must follow Module.event_name pattern, got: ${et}`,
      );
    }
  }
}
