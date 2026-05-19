/**
 * apps/projection-worker — async leg of the request lifecycle.
 *
 * Drains events from the per-tenant `WorkerSource` and runs the module
 * dispatcher chain (catalog + content-pages + cache invalidation + SSE
 * broadcast) for each event. In Phase 2 (shadow mode) the chain runs
 * against a wrapped `ProjectionStore`/`Cache` that does NOT write to the
 * live KV — divergence between the worker's would-be writes and the
 * inline path's actual writes is logged. In Phase 3 (cut-over) the
 * worker becomes authoritative and the inline chain in `apps/server`
 * is removed.
 *
 * See `specs/worker.md` for the migration plan.
 *
 * Logging: a LogPipeline + InMemoryLevelController are constructed before
 * bootstrap so every line — including the first "starting" line — flows
 * through the structured pipeline per specs/crosscut/logging.md. The
 * boot AtlasExecutionContext is threaded into bootstrap, leadership, and
 * the tenant loop; per-event contexts are derived inside the loop with
 * the envelope's correlationId / eventId as causation.
 */

import {
  ConsoleJsonSink,
  InMemoryLevelController,
  LogPipeline,
  MemoryRingBufferSink,
  createSystemContext,
  isLogLevel,
  registerForExitFlush,
} from '@atlas/logging';
import type { AtlasExecutionContext, LogLevel } from '@atlas/platform-core';
import { loadWorkerConfig } from './config.ts';
import { bootstrap, shutdown } from './bootstrap.ts';
import { runTenantLoop } from './tenant-loop.ts';
import { acquireLeadership } from './leader.ts';

async function main(bootCtx: AtlasExecutionContext): Promise<void> {
  const config = loadWorkerConfig();
  const state = await bootstrap(config, bootCtx.logger);
  bootCtx.logger.info('worker booted', {
    event: 'ProjectionWorker.Boot.Complete',
    properties: { mode: config.workerMode, moduleId: config.moduleId },
  });

  // Hot-standby: wait for advisory-lock leadership before processing.
  // Multiple replicas can boot; only the leader drains.
  const leadership = await acquireLeadership(
    bootCtx.withModule('@atlas/projection-worker').withAction(
      'ProjectionWorker.Leader.Acquire',
    ),
    state.controlPlaneSql,
    config.moduleId,
  );
  bootCtx.logger.info('leader acquired', {
    event: 'ProjectionWorker.Leader.Acquired',
    properties: { moduleId: config.moduleId },
  });

  const stopLoop = await runTenantLoop(
    bootCtx.withModule('@atlas/projection-worker'),
    logPipeline,
    state,
  );

  const shutdownOnce = once(async function (signal: string) {
    bootCtx.logger.info(`received ${signal}, shutting down`, {
      event: 'ProjectionWorker.Shutdown.Received',
      properties: { signal },
    });
    await stopLoop();
    await leadership.release();
    await shutdown(state);
    bootCtx.logger.info('shutdown complete', {
      event: 'ProjectionWorker.Shutdown.Complete',
    });
    process.exit(0);
  });

  process.on('SIGINT', function () { return void shutdownOnce('SIGINT'); });
  process.on('SIGTERM', function () { return void shutdownOnce('SIGTERM'); });
}

function once<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  let called = false;
  return async function (...args: A) {
    if (called) return;
    called = true;
    await fn(...args);
  };
}

// Build the logging pipeline + boot context first so every log line —
// including the very first one — is structured. LOG_LEVEL seeds the
// global override on the level controller; defaults to 'info' for prod
// parity. Smoke / debugging flows set LOG_LEVEL=debug to surface the
// per-event boundary lines (Dispatcher.Ran, etc.).
const initialLevel: LogLevel = (function () {
  const raw = process.env['LOG_LEVEL'];
  if (raw && isLogLevel(raw)) return raw;
  return 'info';
})();
const levelController = new InMemoryLevelController(initialLevel);
const inspectionSink = new MemoryRingBufferSink({ capacity: 5000 });
const logPipeline = new LogPipeline(
  [new ConsoleJsonSink(), inspectionSink],
  levelController,
);
registerForExitFlush(logPipeline);

// Read environment from env directly here — main()'s loadWorkerConfig
// hasn't run yet, but the boot context needs an environment to stamp on
// the very first log line. The config-read happens inside main(); the
// two are kept in sync via the same env var.
const bootEnvironment = (function (): 'development' | 'staging' | 'production' | 'test' {
  const raw = process.env['ATLAS_ENVIRONMENT'];
  if (raw === 'production' || raw === 'staging' || raw === 'test') return raw;
  return 'development';
})();

const bootCtx = createSystemContext({
  pipeline: logPipeline,
  environment: bootEnvironment,
  moduleId: '@atlas/projection-worker',
});

main(bootCtx).catch(function (err) {
  bootCtx.logger.fatal('worker failed during startup', {
    event: 'ProjectionWorker.Startup.Failed',
    error: {
      code: 'WORKER_BOOT_FAILED',
      message: err instanceof Error ? err.message : String(err),
      ...(err instanceof Error && err.stack !== undefined
        ? { stack: err.stack }
        : {}),
    },
  });
  process.exit(1);
});
