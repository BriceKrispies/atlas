/**
 * Public types for the Atlas in-process metrics package.
 *
 * Mirrors a small slice of the Prometheus client surface — Counter +
 * Histogram only, no Gauge in this chunk (no Rust-side Gauge consumer
 * has migrated yet; add when SSE/WS connection counters port).
 *
 * Strict labels are declared at construction time. Observe / inc calls
 * with extra or missing label keys throw — typos fail loud rather than
 * silently emitting per-typo cardinality.
 */

export type LabelValues = Readonly<Record<string, string>>;

export interface MetricDescriptor {
  readonly name: string;
  readonly help: string;
  readonly labelNames: readonly string[];
}

export type MetricType = 'counter' | 'histogram';

/**
 * Common interface every registered metric implements. The registry uses
 * this to drive serialization without caring about per-metric internals.
 */
export interface Metric {
  readonly descriptor: MetricDescriptor;
  readonly type: MetricType;
  /**
   * Render this metric to Prometheus text format (one or more lines,
   * NOT including the leading `# HELP` / `# TYPE` lines — the registry
   * adds those uniformly so multi-instance metrics share the header).
   */
  render(): string;
}
