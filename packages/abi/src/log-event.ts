/**
 * Atlas LogEvent — the structured event shape every emitted log line
 * conforms to. Top-level fields are stable and reserved; caller-supplied
 * data goes under `properties`. Implementation lives in @atlas/logging;
 * this is interface-only so domain code can talk types without coupling
 * to the logging package.
 *
 * Per specs/crosscut/logging.md.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEventError {
  code: string;
  message: string;
  stack?: string;
}

export interface LogEvent {
  /** ISO 8601 UTC with milliseconds. */
  timestamp: string;
  level: LogLevel;
  message: string;
  /** Domain.Verb.Outcome event name. Optional but strongly recommended. */
  eventName?: string;

  // Identity (from AtlasExecutionContext)
  tenantId: string;
  principalId: string;
  userId?: string;
  sessionId?: string;

  // Operation
  moduleId?: string;
  actionId?: string;
  resourceType?: string;
  resourceId?: string;
  surfaceId?: string;

  // Trace
  correlationId: string;
  causationId?: string;
  traceId: string;
  spanId: string;
  requestId?: string;

  // Diagnostic
  durationMs?: number;
  error?: LogEventError;

  /** Caller-supplied data. Top-level fields above are reserved. */
  properties?: Readonly<Record<string, unknown>>;
}
