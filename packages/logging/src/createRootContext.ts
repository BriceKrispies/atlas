import type {
  AtlasEnvironment,
  AtlasExecutionContext,
} from '@atlas/platform-core';
import { makeContext, type ContextFields } from './context.ts';
import { newCorrelationId, newSpanId, sanitizeIncomingCorrelationId } from './ids.ts';
import type { LogPipeline } from './pipeline.ts';

export interface CreateRootContextInput {
  /** The pipeline this context's logger writes to. */
  pipeline: LogPipeline;

  // Required identity / environment
  tenantId: string;
  principalId: string;
  environment: AtlasEnvironment;

  // Optional identity
  userId?: string;
  sessionId?: string;

  /**
   * Inbound correlation id — typically from an X-Correlation-Id header,
   * a job envelope, or an event envelope's correlationId. Sanitized; if
   * missing or invalid, a fresh id is generated.
   */
  incomingCorrelationId?: string | null;

  // Optional trace fields
  causationId?: string;
  requestId?: string;
  /** Defaults to correlationId when omitted (no OTEL yet). */
  traceId?: string;
  /** Defaults to a fresh random span id when omitted. */
  spanId?: string;

  // Optional operation fields
  moduleId?: string;
  actionId?: string;
  resourceType?: string;
  resourceId?: string;
  surfaceId?: string;
}

/**
 * Build a root execution context at a boundary (HTTP request, job dequeue,
 * scheduled tick). Sanitizes inbound correlationId; generates one if
 * missing or invalid. Logger is attached automatically.
 */
export function createRootContext(input: CreateRootContextInput): AtlasExecutionContext {
  const correlationId =
    sanitizeIncomingCorrelationId(input.incomingCorrelationId ?? null) ?? newCorrelationId();
  const traceId = input.traceId ?? correlationId;
  const spanId = input.spanId ?? newSpanId();

  const fields: ContextFields = {
    tenantId: input.tenantId,
    principalId: input.principalId,
    userId: input.userId,
    sessionId: input.sessionId,
    correlationId,
    causationId: input.causationId,
    traceId,
    spanId,
    requestId: input.requestId,
    moduleId: input.moduleId,
    actionId: input.actionId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    surfaceId: input.surfaceId,
    environment: input.environment,
  };
  return makeContext(fields, input.pipeline);
}

export interface CreateSystemContextInput {
  pipeline: LogPipeline;
  environment: AtlasEnvironment;
  /** Defaults to 'system'. Set when the system action targets a specific tenant. */
  tenantId?: string;
  moduleId?: string;
  actionId?: string;
  /** Sanitized; generated if missing. */
  correlationId?: string;
}

/**
 * Build a context for scheduled / cron / system work. principalId is
 * always 'system' so audit consumers can distinguish from user actions.
 */
export function createSystemContext(input: CreateSystemContextInput): AtlasExecutionContext {
  const baseInput: CreateRootContextInput = {
    pipeline: input.pipeline,
    tenantId: input.tenantId ?? 'system',
    principalId: 'system',
    environment: input.environment,
  };
  if (input.correlationId !== undefined) baseInput.incomingCorrelationId = input.correlationId;
  if (input.moduleId !== undefined) baseInput.moduleId = input.moduleId;
  if (input.actionId !== undefined) baseInput.actionId = input.actionId;
  return createRootContext(baseInput);
}
