import type {
  AtlasExecutionContext,
  LogEvent,
  LogFields,
  LogLevel,
} from '@atlas/platform-core';
import { redact } from './redaction.ts';

export interface BuildLogEventOptions {
  /** Additional sensitive key names beyond the redaction defaults. */
  redactionExtraKeys?: ReadonlyArray<string>;
}

/**
 * Build a structured LogEvent from a context + caller args.
 *
 * Reserved top-level fields are stamped from the context and CANNOT be
 * overridden by the caller. Caller-supplied data lands under `properties`
 * and is run through redaction before reaching any sink.
 *
 * The caller's `error` field is stamped at the top level (matches the
 * LogEvent schema). Stack traces are NOT walked through redaction —
 * they're considered internal-codebase content per the contract.
 */
export function buildLogEvent(
  ctx: AtlasExecutionContext,
  level: LogLevel,
  message: string,
  fields: LogFields | undefined,
  options: BuildLogEventOptions = {},
): LogEvent {
  // Build into a Record so we can conditionally add optional fields per
  // exactOptionalPropertyTypes. The cast at the end is safe because we
  // populate every required field above.
  const event: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    tenantId: ctx.tenantId,
    principalId: ctx.principalId,
    correlationId: ctx.correlationId,
    traceId: ctx.traceId,
    spanId: ctx.spanId,
  };

  if (ctx.userId !== undefined) event['userId'] = ctx.userId;
  if (ctx.sessionId !== undefined) event['sessionId'] = ctx.sessionId;
  if (ctx.causationId !== undefined) event['causationId'] = ctx.causationId;
  if (ctx.requestId !== undefined) event['requestId'] = ctx.requestId;
  if (ctx.moduleId !== undefined) event['moduleId'] = ctx.moduleId;
  if (ctx.actionId !== undefined) event['actionId'] = ctx.actionId;
  if (ctx.resourceType !== undefined) event['resourceType'] = ctx.resourceType;
  if (ctx.resourceId !== undefined) event['resourceId'] = ctx.resourceId;
  if (ctx.surfaceId !== undefined) event['surfaceId'] = ctx.surfaceId;

  if (fields !== undefined) {
    if (fields.event !== undefined) event['eventName'] = fields.event;
    if (fields.error !== undefined) event['error'] = fields.error;
    if (fields.durationMs !== undefined) event['durationMs'] = fields.durationMs;
    if (fields.properties !== undefined) {
      const extraKeys = options.redactionExtraKeys;
      const opts = extraKeys !== undefined ? { extraKeys } : {};
      event['properties'] = redact(fields.properties, opts);
    }
  }

  return event as unknown as LogEvent;
}
