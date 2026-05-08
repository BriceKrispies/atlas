import type {
  AtlasExecutionContext,
  LogFields,
  Logger,
  LogLevel,
} from '@atlas/platform-core';
import { levelOrder } from './levels.ts';
import { buildLogEvent } from './log-event-builder.ts';
import type { LogPipeline } from './pipeline.ts';

/**
 * Build a Logger bound to a specific context. The resulting logger:
 *
 *   1. Resolves the effective level from the pipeline's LevelController
 *      using the context's correlationId / tenantId / moduleId. Filtered
 *      calls return early without building an event.
 *   2. For passing calls, builds a LogEvent with all reserved fields
 *      stamped from the context. Caller's properties are redacted.
 *   3. Dispatches to every sink in the pipeline.
 *   4. fatal() bypasses level filtering AND triggers a synchronous
 *      flush of every sink before returning.
 */
export function createContextLogger(
  ctx: AtlasExecutionContext,
  pipeline: LogPipeline,
): Logger {
  function emit(level: LogLevel, message: string, fields: LogFields | undefined): void {
    const resolved = pipeline.levelController.resolve({
      correlationId: ctx.correlationId,
      tenantId: ctx.tenantId,
      moduleId: ctx.moduleId,
    });
    if (levelOrder(level) < levelOrder(resolved)) return;
    const buildOpts =
      pipeline.redactionExtraKeys !== undefined
        ? { redactionExtraKeys: pipeline.redactionExtraKeys }
        : {};
    const event = buildLogEvent(ctx, level, message, fields, buildOpts);
    pipeline.dispatch(event);
  }

  function emitFatal(message: string, fields: LogFields | undefined): void {
    // fatal bypasses level filtering — it's reserved for unrecoverable
    // scenarios and the caller is about to exit. We must not silently
    // drop it because someone configured global=fatal+ somewhere.
    const buildOpts =
      pipeline.redactionExtraKeys !== undefined
        ? { redactionExtraKeys: pipeline.redactionExtraKeys }
        : {};
    const event = buildLogEvent(ctx, 'fatal', message, fields, buildOpts);
    pipeline.dispatch(event);
    pipeline.flushSync();
  }

  return {
    debug(message, fields) {
      emit('debug', message, fields);
    },
    info(message, fields) {
      emit('info', message, fields);
    },
    warn(message, fields) {
      emit('warn', message, fields);
    },
    error(message, fields) {
      emit('error', message, fields);
    },
    fatal(message, fields) {
      emitFatal(message, fields);
    },
  };
}
