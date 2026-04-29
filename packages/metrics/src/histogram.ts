/**
 * Histogram — bucketed observations + sum/count.
 *
 * Mirrors prometheus's `HistogramVec`. Each labelled series carries
 * its own per-bucket counts, sum, and overall count. Buckets are
 * configured at construction; `observe(value)` walks them in ascending
 * order and increments every bucket whose upper bound is `>= value`.
 *
 * Output format follows the Prometheus text spec: one `_bucket` line
 * per bucket (with the synthetic `le` label) including the +Inf
 * bucket, then `_sum` and `_count`.
 */

import { labelKey, validateLabels, decodeLabelKey, renderLabels } from './labels.ts';
import { formatValue } from './counter.ts';
import type { LabelValues, Metric, MetricDescriptor } from './types.ts';

export interface HistogramOptions {
  readonly name: string;
  readonly help: string;
  readonly labelNames?: readonly string[];
  /**
   * Bucket upper bounds, ascending. Excluding +Inf — the renderer
   * appends the +Inf bucket implicitly. Must be non-empty + strictly
   * increasing.
   */
  readonly buckets: readonly number[];
}

export const DEFAULT_DURATION_BUCKETS: readonly number[] = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
];

interface Series {
  /** Cumulative bucket counts, parallel to `buckets`. */
  bucketCounts: number[];
  sum: number;
  count: number;
}

export class Histogram implements Metric {
  readonly type = 'histogram' as const;
  readonly descriptor: MetricDescriptor;
  readonly buckets: readonly number[];
  private readonly series = new Map<string, Series>();

  constructor(opts: HistogramOptions) {
    if (opts.buckets.length === 0) {
      throw new Error(`histogram ${opts.name}: buckets must be non-empty`);
    }
    for (let i = 1; i < opts.buckets.length; i += 1) {
      const a = opts.buckets[i - 1];
      const b = opts.buckets[i];
      if (a === undefined || b === undefined || !(b > a)) {
        throw new Error(
          `histogram ${opts.name}: buckets must be strictly increasing`,
        );
      }
    }
    this.descriptor = {
      name: opts.name,
      help: opts.help,
      labelNames: opts.labelNames ?? [],
    };
    this.buckets = opts.buckets;
  }

  observe(value: number, labels?: LabelValues): void {
    if (!Number.isFinite(value)) {
      throw new Error(
        `histogram ${this.descriptor.name}: observe requires a finite number, got ${String(value)}`,
      );
    }
    validateLabels(this.descriptor.labelNames, labels, this.descriptor.name);
    const key = labelKey(this.descriptor.labelNames, labels);
    let s = this.series.get(key);
    if (!s) {
      s = {
        bucketCounts: new Array<number>(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.series.set(key, s);
    }
    s.count += 1;
    s.sum += value;
    for (let i = 0; i < this.buckets.length; i += 1) {
      const bound = this.buckets[i];
      if (bound !== undefined && value <= bound) {
        s.bucketCounts[i] = (s.bucketCounts[i] ?? 0) + 1;
      }
    }
  }

  render(): string {
    const lines: string[] = [];
    if (this.series.size === 0) {
      // No observations recorded yet — emit nothing. A scraper polling
      // an empty histogram should see no series, matching prometheus
      // client behaviour.
      return '';
    }
    const entries = [...this.series.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [key, s] of entries) {
      const labels = decodeLabelKey(this.descriptor.labelNames, key);
      for (let i = 0; i < this.buckets.length; i += 1) {
        const bound = this.buckets[i];
        if (bound === undefined) continue;
        const block = renderLabels(this.descriptor.labelNames, labels, [
          ['le', formatBucketBound(bound)],
        ]);
        lines.push(`${this.descriptor.name}_bucket${block} ${formatValue(s.bucketCounts[i] ?? 0)}`);
      }
      // +Inf bucket equals the total count.
      const infBlock = renderLabels(this.descriptor.labelNames, labels, [['le', '+Inf']]);
      lines.push(`${this.descriptor.name}_bucket${infBlock} ${formatValue(s.count)}`);
      const sumBlock = renderLabels(this.descriptor.labelNames, labels);
      lines.push(`${this.descriptor.name}_sum${sumBlock} ${formatValue(s.sum)}`);
      lines.push(`${this.descriptor.name}_count${sumBlock} ${formatValue(s.count)}`);
    }
    return lines.join('\n');
  }
}

/**
 * Bucket boundaries are usually small floats; Prometheus expects a
 * canonical decimal form (e.g. `0.005`, not `5e-3`). `Number#toString`
 * already does the right thing for the values we use, but integer
 * boundaries should keep their trailing `.0` for parity with the
 * Rust prometheus client (`vec![0.001, ..., 1.0, 2.5, 5.0, 10.0]`
 * renders `1`, `2.5`, `5`, `10` from prometheus-rs — so we don't add
 * the `.0`. This shape matches what dashboards saw from Rust.
 */
function formatBucketBound(value: number): string {
  return formatValue(value);
}
