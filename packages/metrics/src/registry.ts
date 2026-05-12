/**
 * Registry — singleton store of registered metrics + the
 * Prometheus-text-format serializer used by `GET /metrics`.
 *
 * Metric names must be unique. Re-registering the same name throws
 * (helps catch double-imports of a module's metric singletons under
 * vitest hot-reload). For tests, `clear()` resets the singleton —
 * the public `getRegistry()` getter is process-global so unit tests
 * that exercise the singleton end up pulling whatever the previous
 * test registered. Each metrics test file should clear before/after
 * to keep ordering independent.
 */

import type { Metric } from './types.ts';

export class Registry {
  private readonly metrics = new Map<string, Metric>();

  register<M extends Metric>(metric: M): M {
    const name = metric.descriptor.name;
    if (this.metrics.has(name)) {
      throw new Error(`metric already registered: ${name}`);
    }
    this.metrics.set(name, metric);
    return metric;
  }

  /**
   * Look up a previously registered metric by name. Useful for
   * cross-module access without exporting every metric singleton
   * from a shared `metrics.ts` registry module.
   *
   * The optional `M` parameter lets the caller declare the expected
   * concrete metric shape (e.g. `Counter`, `Histogram`); the registry
   * itself doesn't enforce that, but it removes the need for an
   * unsafe cast at call sites that own the name. Callers are
   * responsible for ensuring the same name is always registered with
   * the same metric type — registration is deduped by `getOrRegister`.
   */
  get<M extends Metric = Metric>(name: string): M | undefined {
    const v = this.metrics.get(name);
    if (v === undefined) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- registry stores name→Metric with the concrete subtype erased; caller declares the expected `M` and `getOrRegister` keeps the (name, type) mapping consistent.
    return v as M;
  }

  /**
   * Drop every registered metric. Intended for unit tests; do not
   * call in production code.
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Render every registered metric in Prometheus text format.
   *
   * Prometheus expects each metric family to be preceded by `# HELP`
   * + `# TYPE` lines, then the samples, with families separated by a
   * blank line. We emit metrics in insertion order — registration
   * order is deterministic at boot, which keeps the rendered output
   * stable for snapshot tests.
   *
   * Empty histograms (no observations) render no lines, but still
   * get HELP + TYPE so scrapers know the metric exists.
   */
  serialize(): string {
    const blocks: string[] = [];
    for (const metric of this.metrics.values()) {
      const header = `# HELP ${metric.descriptor.name} ${metric.descriptor.help}\n# TYPE ${metric.descriptor.name} ${metric.type}`;
      const body = metric.render();
      blocks.push(body.length > 0 ? `${header}\n${body}` : header);
    }
    // Trailing newline matches what prometheus-rs's TextEncoder emits.
    return blocks.length === 0 ? '' : `${blocks.join('\n')}\n`;
  }
}

let singleton: Registry | null = null;

export function getRegistry(): Registry {
  if (!singleton) singleton = new Registry();
  return singleton;
}

/**
 * Replace the process-global registry. Used by tests that want full
 * isolation between cases without coupling to the singleton state.
 */
export function setRegistry(reg: Registry): void {
  singleton = reg;
}

export function resetRegistry(): void {
  singleton = new Registry();
}
