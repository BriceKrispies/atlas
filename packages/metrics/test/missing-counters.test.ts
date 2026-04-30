/**
 * Red-phase tests for counters that the Rust ingress + workers
 * already export but `@atlas/metrics` does not yet expose:
 *   - `projections_built_total{projection_type}`
 *   - `wasm_executions_total{plugin_id, result}`
 *   - `worker_heartbeats_total{worker_id}`
 *
 * These will fail with import errors today (the helpers don't
 * exist). Once the singletons are added to `atlas-metrics.ts`
 * and re-exported from `index.ts`, the tests should pass.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  // @ts-expect-error — not exported yet (red phase)
  projectionsBuiltTotal,
  // @ts-expect-error — not exported yet (red phase)
  wasmExecutionsTotal,
  // @ts-expect-error — not exported yet (red phase)
  workerHeartbeatsTotal,
  resetRegistry,
  getRegistry,
} from '@atlas/metrics';

beforeEach(() => {
  resetRegistry();
});

describe('Missing Atlas counter singletons', () => {
  test('projectionsBuiltTotal exposes a Counter labelled by projection_type', () => {
    const c = projectionsBuiltTotal();
    expect(c.descriptor.name).toBe('atlas_projections_built_total');
    expect([...c.descriptor.labelNames]).toEqual(['projection_type']);
    c.inc({ projection_type: 'render-page' });
    c.inc({ projection_type: 'render-page' });
    expect(c.get({ projection_type: 'render-page' })).toBe(2);

    const out = getRegistry().serialize();
    expect(out).toContain('# TYPE atlas_projections_built_total counter');
    expect(out).toContain(
      'atlas_projections_built_total{projection_type="render-page"} 2',
    );
  });

  test('wasmExecutionsTotal exposes a Counter labelled by plugin_id + result', () => {
    const c = wasmExecutionsTotal();
    expect(c.descriptor.name).toBe('atlas_wasm_executions_total');
    expect([...c.descriptor.labelNames].sort()).toEqual(['plugin_id', 'result']);
    c.inc({ plugin_id: 'demo-transform', result: 'ok' });
    c.inc({ plugin_id: 'demo-transform', result: 'error' });
    expect(c.get({ plugin_id: 'demo-transform', result: 'ok' })).toBe(1);
    expect(c.get({ plugin_id: 'demo-transform', result: 'error' })).toBe(1);

    const out = getRegistry().serialize();
    expect(out).toContain('# TYPE atlas_wasm_executions_total counter');
    expect(out).toContain(
      'atlas_wasm_executions_total{plugin_id="demo-transform",result="ok"} 1',
    );
    expect(out).toContain(
      'atlas_wasm_executions_total{plugin_id="demo-transform",result="error"} 1',
    );
  });

  test('workerHeartbeatsTotal exposes a Counter labelled by worker_id', () => {
    const c = workerHeartbeatsTotal();
    expect(c.descriptor.name).toBe('atlas_worker_heartbeats_total');
    expect([...c.descriptor.labelNames]).toEqual(['worker_id']);
    c.inc({ worker_id: 'main' });
    c.inc({ worker_id: 'main' });
    c.inc({ worker_id: 'main' });
    expect(c.get({ worker_id: 'main' })).toBe(3);

    const out = getRegistry().serialize();
    expect(out).toContain('# TYPE atlas_worker_heartbeats_total counter');
    expect(out).toContain('atlas_worker_heartbeats_total{worker_id="main"} 3');
  });

  test('repeat singleton accessors return the same instance via registry', () => {
    expect(projectionsBuiltTotal()).toBe(projectionsBuiltTotal());
    expect(wasmExecutionsTotal()).toBe(wasmExecutionsTotal());
    expect(workerHeartbeatsTotal()).toBe(workerHeartbeatsTotal());
  });
});
