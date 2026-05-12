/**
 * Projection-worker configuration.
 *
 * Mirrors `apps/server/src/config.ts` shape but reads only the env vars
 * the worker needs. Phase 2 (shadow mode) is observe-only — the worker
 * runs the dispatcher chain against a wrapped projection store / cache
 * that doesn't write to the live KV; divergence is logged. Phase 3
 * cut-over flips `WORKER_MODE=async` and the worker becomes authoritative.
 */

import type { AtlasEnvironment } from '@atlas/platform-core';

export interface WorkerConfig {
  controlPlaneDbUrl: string;
  /** How often we re-scan the control plane for new tenants. Seconds. */
  tenantDiscoveryIntervalSeconds: number;
  /** Logical module identifier for cursor namespacing. */
  moduleId: string;
  /** Phase 2 / Phase 3 toggle. `shadow` is observe-only; `live` writes. */
  workerMode: 'shadow' | 'live';
  /**
   * Process environment — stamped onto every log line via
   * AtlasExecutionContext. Defaults to `development` so local runs don't
   * have to set anything; ops sets `ATLAS_ENVIRONMENT=production` etc.
   */
  environment: AtlasEnvironment;
}

const VALID_ENVIRONMENTS: ReadonlyArray<AtlasEnvironment> = [
  'development',
  'staging',
  'production',
  'test',
];

function parseEnvironment(raw: string | undefined): AtlasEnvironment {
  if (!raw) return 'development';
  for (const env of VALID_ENVIRONMENTS) {
    if (env === raw) return env;
  }
  return 'development';
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
  const environment = parseEnvironment(process.env['ATLAS_ENVIRONMENT']);
  return {
    controlPlaneDbUrl,
    tenantDiscoveryIntervalSeconds: Number.isFinite(interval)
      ? interval
      : 30,
    moduleId,
    workerMode,
    environment,
  };
}
