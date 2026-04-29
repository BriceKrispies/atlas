/**
 * Counter — monotonically increasing per-label-combination total.
 *
 * Mirrors prometheus's `CounterVec`. `inc()` adds 1 to the no-label
 * series (must be label-less) or to a labelled series; `inc(n)` adds
 * `n` (must be non-negative — counters can't go down).
 *
 * Storage: `Map<labelKey, number>`. Each unique label-value tuple
 * gets its own entry, created lazily on first observation. There is
 * no upper bound on cardinality at this layer — callers must keep
 * label values bounded (decision = permit/deny/error, action =
 * known-finite-set, etc.).
 */

import { labelKey, validateLabels, decodeLabelKey, renderLabels } from './labels.ts';
import type { LabelValues, Metric, MetricDescriptor } from './types.ts';

export interface CounterOptions {
  readonly name: string;
  readonly help: string;
  readonly labelNames?: readonly string[];
}

export class Counter implements Metric {
  readonly type = 'counter' as const;
  readonly descriptor: MetricDescriptor;
  private readonly values = new Map<string, number>();

  constructor(opts: CounterOptions) {
    this.descriptor = {
      name: opts.name,
      help: opts.help,
      labelNames: opts.labelNames ?? [],
    };
  }

  /**
   * Add `n` (default 1) to the series identified by `labels`. Throws
   * if the label set doesn't match the descriptor or if `n < 0`.
   */
  inc(labels?: LabelValues): void;
  inc(n: number, labels?: LabelValues): void;
  inc(arg1?: number | LabelValues, arg2?: LabelValues): void {
    let n: number;
    let labels: LabelValues | undefined;
    if (typeof arg1 === 'number') {
      n = arg1;
      labels = arg2;
    } else {
      n = 1;
      labels = arg1;
    }
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(
        `counter ${this.descriptor.name}: inc requires a finite non-negative number, got ${String(n)}`,
      );
    }
    validateLabels(this.descriptor.labelNames, labels, this.descriptor.name);
    const key = labelKey(this.descriptor.labelNames, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + n);
  }

  /**
   * Read the current value for a label combination. Returns 0 for an
   * unobserved series (matches Prometheus client semantics — emit a
   * zero sample once the series has been touched, but the renderer
   * skips never-observed labelled metrics to avoid empty output).
   */
  get(labels?: LabelValues): number {
    validateLabels(this.descriptor.labelNames, labels, this.descriptor.name);
    return this.values.get(labelKey(this.descriptor.labelNames, labels)) ?? 0;
  }

  render(): string {
    const lines: string[] = [];
    if (this.descriptor.labelNames.length === 0 && this.values.size === 0) {
      // Always emit the no-label series so scrapers see a 0 baseline.
      lines.push(`${this.descriptor.name} 0`);
      return lines.join('\n');
    }
    const entries = [...this.values.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [key, value] of entries) {
      const labels = decodeLabelKey(this.descriptor.labelNames, key);
      const block = renderLabels(this.descriptor.labelNames, labels);
      lines.push(`${this.descriptor.name}${block} ${formatValue(value)}`);
    }
    return lines.join('\n');
  }
}

/**
 * Render a numeric value the way Prometheus expects — integers
 * without a trailing `.0`, finite floats via `toString()`. Counters
 * are always non-negative + finite (the constructor + `inc` enforce
 * that), so we don't have to worry about NaN/Inf here, but the
 * formatter is shared with histogram sums where Inf-bucket boundaries
 * appear.
 */
export function formatValue(value: number): string {
  if (value === Number.POSITIVE_INFINITY) return '+Inf';
  if (value === Number.NEGATIVE_INFINITY) return '-Inf';
  if (Number.isNaN(value)) return 'NaN';
  return Number.isInteger(value) ? value.toString() : value.toString();
}
