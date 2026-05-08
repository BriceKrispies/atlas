/**
 * @atlas/logging — context-first logging for Atlas.
 *
 * Public API. Logger is obtained ONLY via an AtlasExecutionContext
 * (`ctx.logger`); there is no top-level createLogger factory by design.
 * Build a context at every boundary using createRootContext (HTTP / job /
 * worker) or createSystemContext (scheduled work).
 *
 * Per specs/crosscut/logging.md.
 */

// Boundaries
export {
  createRootContext,
  createSystemContext,
} from './createRootContext.ts';
export type {
  CreateRootContextInput,
  CreateSystemContextInput,
} from './createRootContext.ts';

// Pipeline
export {
  LogPipeline,
  registerForExitFlush,
  unregisterForExitFlush,
} from './pipeline.ts';
export type { LogPipelineOptions } from './pipeline.ts';

// Sinks
export type { Sink } from './sinks/sink.ts';
export { ConsoleJsonSink } from './sinks/console-json.ts';
export type { ConsoleJsonSinkOptions } from './sinks/console-json.ts';
export { MemoryRingBufferSink } from './sinks/memory-ring.ts';
export type { MemoryRingBufferSinkOptions } from './sinks/memory-ring.ts';
export { CollectorSink } from './sinks/test-sink.ts';

// Level control
export type {
  LevelController,
  LevelResolutionInput,
  LevelOverridesSnapshot,
} from './level-controller.ts';
export { InMemoryLevelController } from './level-controller.ts';

// Levels
export { LOG_LEVELS, levelOrder, isLogLevel } from './levels.ts';

// IDs
export {
  newCorrelationId,
  newSpanId,
  newRequestId,
  sanitizeIncomingCorrelationId,
} from './ids.ts';

// Redaction
export { sensitive, redact, isSensitive } from './redaction.ts';
export type { RedactOptions } from './redaction.ts';

// Re-export the platform-core context types here for convenience —
// callers can import everything they need from @atlas/logging.
export type {
  AtlasEnvironment,
  AtlasExecutionContext,
  AtlasExecutionContextPatch,
  Logger,
  LogFields,
  LogEvent,
  LogEventError,
  LogLevel,
} from '@atlas/platform-core';
