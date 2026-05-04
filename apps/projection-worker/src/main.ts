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
 */

import { loadWorkerConfig } from './config.ts';
import { bootstrap, shutdown } from './bootstrap.ts';
import { runTenantLoop } from './tenant-loop.ts';
import { acquireLeadership } from './leader.ts';

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const state = await bootstrap(config);
  log('info', 'worker booted', { mode: config.workerMode, moduleId: config.moduleId });

  // Hot-standby: wait for advisory-lock leadership before processing.
  // Multiple replicas can boot; only the leader drains.
  const leadership = await acquireLeadership(state.controlPlaneSql, config.moduleId);
  log('info', 'leader acquired', { moduleId: config.moduleId });

  const stopLoop = await runTenantLoop(state);

  const shutdownOnce = once(async (signal: string) => {
    log('info', `received ${signal}, shutting down`);
    await stopLoop();
    await leadership.release();
    await shutdown(state);
    log('info', 'shutdown complete');
    process.exit(0);
  });

  process.on('SIGINT', () => void shutdownOnce('SIGINT'));
  process.on('SIGTERM', () => void shutdownOnce('SIGTERM'));
}

function once<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  let called = false;
  return async (...args: A) => {
    if (called) return;
    called = true;
    await fn(...args);
  };
}

function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  // Simple structured logging — replace with @atlas/metrics + a real
  // logger in a follow-up. Keeping it small for Phase 2.
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...fields }));
}

main().catch((err) => {
  console.error(JSON.stringify({
    level: 'error',
    msg: 'worker failed during startup',
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  }));
  process.exit(1);
});
