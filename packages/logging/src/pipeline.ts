import type { LogEvent } from '@atlas/platform-core';
import type { Sink } from './sinks/sink.ts';
import type { LevelController } from './level-controller.ts';

export interface LogPipelineOptions {
  /** Additional sensitive key names beyond the redaction defaults. */
  redactionExtraKeys?: ReadonlyArray<string>;
}

/**
 * The fan-out point. Owns the level controller (so per-context loggers
 * can resolve their effective level) and the sink set (so events go to
 * stdout, the inspection ring, future remote sinks).
 *
 * One LogPipeline per process is the typical shape. Tests construct
 * their own with a CollectorSink.
 */
export class LogPipeline {
  public readonly sinks: ReadonlyArray<Sink>;
  public readonly levelController: LevelController;
  public readonly redactionExtraKeys?: ReadonlyArray<string>;

  constructor(
    sinks: ReadonlyArray<Sink>,
    levelController: LevelController,
    options: LogPipelineOptions = {},
  ) {
    this.sinks = sinks;
    this.levelController = levelController;
    if (options.redactionExtraKeys !== undefined) {
      this.redactionExtraKeys = options.redactionExtraKeys;
    }
  }

  dispatch(event: LogEvent): void {
    for (const sink of this.sinks) sink.write(event);
  }

  /** Used by Logger.fatal() and exit handlers. */
  flushSync(): void {
    for (const sink of this.sinks) sink.flushSync();
  }
}

// ---- Process exit handler installation -------------------------------
// Pipelines register themselves on construction so SIGINT / SIGTERM /
// beforeExit can trigger a synchronous flush before the process dies.
// We don't lose the log lines that explain WHY we're shutting down.

const liveExitHandlerPipelines = new Set<LogPipeline>();
let installedExitHandler = false;

function installExitHandlerOnce(): void {
  if (installedExitHandler) return;
  installedExitHandler = true;
  const flushAll = (): void => {
    for (const p of liveExitHandlerPipelines) p.flushSync();
  };
  process.on('beforeExit', flushAll);
  process.on('SIGINT', () => {
    flushAll();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    flushAll();
    process.exit(143);
  });
}

/** Register a pipeline for sync flush on process exit. Idempotent. */
export function registerForExitFlush(pipeline: LogPipeline): void {
  liveExitHandlerPipelines.add(pipeline);
  installExitHandlerOnce();
}

/** Used by tests to avoid leaking pipelines across runs. */
export function unregisterForExitFlush(pipeline: LogPipeline): void {
  liveExitHandlerPipelines.delete(pipeline);
}
