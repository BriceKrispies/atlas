/**
 * Logger interface — emitted by AtlasExecutionContext.logger. Implementation
 * lives in @atlas/logging. Domain / port / module code imports the interface
 * from here so it can talk to a logger without coupling to the impl.
 *
 * Per specs/crosscut/logging.md.
 */

import type { LogEventError } from './log-event.ts';

export interface LogFields {
  /** Domain.Verb.Outcome event name. Optional but strongly recommended. */
  event?: string;
  /** Structured error data. Top-level on the emitted LogEvent. */
  error?: LogEventError;
  /** Optional duration. Top-level on the emitted LogEvent. */
  durationMs?: number;
  /**
   * Caller-supplied data. Goes under `properties` on the emitted LogEvent;
   * never overrides reserved top-level fields. Sensitive values should be
   * wrapped with `sensitive(...)` from @atlas/logging or use a sensitive
   * key name (password, secret, token, etc. — see the redaction list in
   * the logging contract).
   */
  properties?: Readonly<Record<string, unknown>>;
}

/**
 * Per-context logger. Methods are non-blocking except for `.fatal`, which
 * forces a synchronous flush of the buffered pipeline before returning.
 * Reserved for boot-failure / unrecoverable scenarios where the next
 * action is process exit.
 */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Synchronous flush before return. Use sparingly. */
  fatal(message: string, fields?: LogFields): void;
}
