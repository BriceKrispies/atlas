/**
 * `@atlas/metrics` — in-memory Prometheus-compatible metric primitives.
 *
 * Pure data structures. No I/O, no adapter dependencies, safe for
 * domain modules + ingress to import (port-boundary rule applies).
 * The only consumer that matters production-side is `apps/server`'s
 * `/metrics` route, which calls `getRegistry().serialize()`.
 */

export { Counter, type CounterOptions } from './counter.ts';
export {
  Histogram,
  type HistogramOptions,
  DEFAULT_DURATION_BUCKETS,
} from './histogram.ts';
export {
  Registry,
  getRegistry,
  setRegistry,
  resetRegistry,
} from './registry.ts';
export { MetricsLabelError } from './labels.ts';
export type {
  LabelValues,
  Metric,
  MetricDescriptor,
  MetricType,
} from './types.ts';
export {
  intentsSubmittedTotal,
  policyEvaluationsTotal,
  intentDurationSeconds,
} from './atlas-metrics.ts';
