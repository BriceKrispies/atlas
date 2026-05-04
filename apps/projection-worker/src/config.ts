/**
 * Projection-worker configuration.
 *
 * Mirrors `apps/server/src/config.ts` shape but reads only the env vars
 * the worker needs. Phase 2 (shadow mode) is observe-only — the worker
 * runs the dispatcher chain against a wrapped projection store / cache
 * that doesn't write to the live KV; divergence is logged. Phase 3
 * cut-over flips `WORKER_MODE=async` and the worker becomes authoritative.
 */

export interface WorkerConfig {
  controlPlaneDbUrl: string;
  /** How often we re-scan the control plane for new tenants. Seconds. */
  tenantDiscoveryIntervalSeconds: number;
  /** Logical module identifier for cursor namespacing. */
  moduleId: string;
  /** Phase 2 / Phase 3 toggle. `shadow` is observe-only; `live` writes. */
  workerMode: 'shadow' | 'live';
  /** Log verbosity. */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadWorkerConfig(): WorkerConfig {
  const controlPlaneDbUrl = process.env['CONTROL_PLANE_DB_URL'];
  if (!controlPlaneDbUrl) {
    throw new Error(
      'CONTROL_PLANE_DB_URL is required for the projection worker',
    );
  }
  const interval = Number(
    process.env['WORKER_TENANT_DISCOVERY_INTERVAL_SECONDS'] ?? '30',
  );
  const moduleId = process.env['WORKER_MODULE_ID'] ?? 'projection-default';
  const workerMode = process.env['WORKER_MODE'] === 'live' ? 'live' : 'shadow';
  const logLevel = (process.env['WORKER_LOG_LEVEL'] ??
    'info') as WorkerConfig['logLevel'];
  return {
    controlPlaneDbUrl,
    tenantDiscoveryIntervalSeconds: Number.isFinite(interval)
      ? interval
      : 30,
    moduleId,
    workerMode,
    logLevel,
  };
}
