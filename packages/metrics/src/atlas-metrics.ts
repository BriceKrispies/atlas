/**
 * Atlas-specific metric singletons.
 *
 * One module owns the canonical Counter/Histogram instances so all
 * call sites share them via import (rather than `registry.get(name)`
 * lookups, which would lose the strict-label types). Names match the
 * Rust ingress (`crates/ingress/src/metrics.rs`) so dashboards keep
 * working when traffic flips.
 *
 * Lazy initialisation: each accessor checks the global registry for
 * a previously-registered metric of that name and reuses it. This
 * keeps unit tests that swap the registry hermetic without forcing
 * each call site to re-import after `setRegistry`.
 */

import { Counter } from './counter.ts';
import { Histogram, DEFAULT_DURATION_BUCKETS } from './histogram.ts';
import { getRegistry } from './registry.ts';
import type { Metric } from './types.ts';

function getOrRegister<M extends Metric>(metric: M): M {
  const existing = getRegistry().get(metric.descriptor.name);
  if (existing) return existing as unknown as M;
  return getRegistry().register(metric);
}

/**
 * Per-intent submission counter. Labelled by the action id and the
 * decision the request resolved to:
 *   - `permit` — submitIntent reached handler dispatch / generic
 *     fall-through and produced an event envelope (success).
 *   - `deny`   — policy engine returned deny; submitIntent threw 403.
 *   - `error`  — any other thrown error (schema, idempotency,
 *     unknown-action, handler exception). Maps to non-403 failures.
 */
export function intentsSubmittedTotal(): Counter {
  return getOrRegister(
    new Counter({
      name: 'atlas_intents_submitted_total',
      help: 'Total intents processed by the ingress, labelled by action and decision.',
      labelNames: ['action', 'decision'],
    }),
  );
}

/**
 * Total Cedar (or stub) policy evaluations, by decision (`permit`
 * or `deny`). Mirrors the Rust `policy_evaluations_total` counter
 * exactly — same label set + value vocabulary so prom queries are
 * portable across runtimes.
 *
 * NOTE the Rust counterpart is `policy_evaluations_total`; we ship
 * `atlas_policy_evaluations_total` because the rest of the TS-side
 * metrics are namespace-prefixed. Dashboards that target Rust use
 * the unprefixed name; see follow-up smell in the report.
 */
export function policyEvaluationsTotal(): Counter {
  return getOrRegister(
    new Counter({
      name: 'atlas_policy_evaluations_total',
      help: 'Total policy evaluations, labelled by decision (permit|deny).',
      labelNames: ['decision'],
    }),
  );
}

/**
 * Wall-clock duration of a full submitIntent call, in seconds,
 * histogrammed per action id. The route handler measures around
 * its `submitIntent` invocation regardless of outcome (success or
 * thrown).
 */
export function intentDurationSeconds(): Histogram {
  return getOrRegister(
    new Histogram({
      name: 'atlas_intent_duration_seconds',
      help: 'Intent submission wall-clock duration in seconds, by action.',
      labelNames: ['action'],
      buckets: DEFAULT_DURATION_BUCKETS,
    }),
  );
}

/**
 * Total projections built by the worker, labelled by projection
 * type (e.g. `render-page`). Mirrors the Rust worker's
 * `projections_built_total` counter so dashboards stay portable
 * across the TS + Rust runtimes.
 */
export function projectionsBuiltTotal(): Counter {
  return getOrRegister(
    new Counter({
      name: 'atlas_projections_built_total',
      help: 'Total projections built, labelled by projection type.',
      labelNames: ['projection_type'],
    }),
  );
}

/**
 * Total WASM plugin executions, labelled by plugin id and outcome
 * (`ok` or `error`). Matches the Rust wasm_runtime counter so
 * cross-runtime dashboards continue to work.
 */
export function wasmExecutionsTotal(): Counter {
  return getOrRegister(
    new Counter({
      name: 'atlas_wasm_executions_total',
      help: 'Total WASM plugin executions, labelled by plugin and result.',
      labelNames: ['plugin_id', 'result'],
    }),
  );
}

/**
 * Total worker heartbeats emitted, labelled by worker id. Mirrors
 * the Rust worker's `worker_heartbeats_total` counter — used by
 * liveness alerts on the worker fleet.
 */
export function workerHeartbeatsTotal(): Counter {
  return getOrRegister(
    new Counter({
      name: 'atlas_worker_heartbeats_total',
      help: 'Total worker heartbeats, labelled by worker id.',
      labelNames: ['worker_id'],
    }),
  );
}

/**
 * Total guardrail events recorded by the diagnostics helpers
 * (`guardrail`, `techDebt`, `mvpShortcut`). Labels mirror the Rust
 * `guardrail_hits_total` counter exactly: `kind` (e.g. tech_debt,
 * mvp_shortcut, perf_workaround), `id` (unique guardrail identifier),
 * and `component` (module/subsystem where the guardrail lives).
 *
 * NOTE: name is unprefixed (`guardrail_hits_total`) to match the Rust
 * `metrics::counter!` emission directly — dashboards built off the
 * Rust runtime keep working without rewrites.
 */
export function guardrailHitsTotal(): Counter {
  return getOrRegister(
    new Counter({
      name: 'guardrail_hits_total',
      help: 'Total guardrail events recorded, labelled by kind, id, and component.',
      labelNames: ['kind', 'id', 'component'],
    }),
  );
}
