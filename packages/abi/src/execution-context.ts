/**
 * AtlasExecutionContext — the execution spine for any work happening
 * inside Atlas. Carries identity (who) + trace (what flow) + operation
 * (what action / resource / surface) + a context-bound logger.
 *
 * Designed so logs cannot be emitted without context: `ctx.logger.info(...)`
 * is the only path. The ID fields below are stamped onto every LogEvent
 * automatically; callers do NOT pass correlationId / tenantId / etc. on
 * every log call.
 *
 * Inheritance is immutable. Every `with*()` returns a NEW context; the
 * parent is never mutated. correlationId / traceId / tenantId never
 * change across `.with*()` calls — those identify the whole flow.
 *
 * Implementation lives in @atlas/logging.
 *
 * Per specs/crosscut/logging.md and (forthcoming) specs/crosscut/execution-context.md.
 */

import type { Logger } from './logger.ts';

export type AtlasEnvironment = 'development' | 'staging' | 'production' | 'test';

/**
 * Subset of context fields that may be patched via `.with(...)`.
 *
 * Excluded fields (immutable across a flow):
 *   - tenantId: identifies the tenant for the whole flow
 *   - correlationId: the flow id; preserved by every step
 *   - traceId: distributed-trace identity; tied to correlationId
 *   - spanId: changes only via `.childSpan(name)`, not `.with()`
 *   - environment: process-level constant
 *   - logger: derived from the context itself
 */
export interface AtlasExecutionContextPatch {
  principalId?: string;
  userId?: string | undefined;
  sessionId?: string | undefined;
  causationId?: string | undefined;
  requestId?: string | undefined;
  moduleId?: string | undefined;
  actionId?: string | undefined;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  surfaceId?: string | undefined;
}

export interface AtlasExecutionContext {
  // Identity
  readonly tenantId: string;
  readonly principalId: string;
  readonly userId: string | undefined;
  readonly sessionId: string | undefined;

  // Trace IDs — kept distinct on purpose
  readonly correlationId: string; // whole flow
  readonly causationId: string | undefined; // immediate cause
  readonly traceId: string; // distributed-trace identity
  readonly spanId: string; // operation/span identity
  readonly requestId: string | undefined; // single HTTP request

  // Operation
  readonly moduleId: string | undefined;
  readonly actionId: string | undefined;
  readonly resourceType: string | undefined;
  readonly resourceId: string | undefined;
  readonly surfaceId: string | undefined;

  // Environment
  readonly environment: AtlasEnvironment;

  /** Logger bound to this context. Stamps all reserved fields on emit. */
  readonly logger: Logger;

  // Inheritance — immutable; each returns a new context.
  with(patch: AtlasExecutionContextPatch): AtlasExecutionContext;
  withModule(moduleId: string): AtlasExecutionContext;
  withAction(actionId: string): AtlasExecutionContext;
  withResource(resourceType: string, resourceId: string): AtlasExecutionContext;
  withSurface(surfaceId: string): AtlasExecutionContext;
  withCausation(causationId: string): AtlasExecutionContext;
  /** Generate a new spanId for a child operation. `name` is reserved for OTEL. */
  childSpan(name: string): AtlasExecutionContext;
}
