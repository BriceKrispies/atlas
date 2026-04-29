/**
 * Smoke tests for the atlas-specific metric singletons. The rest of
 * the assertions live in `counter.test.ts` / `histogram.test.ts`;
 * here we only verify the names + label sets match the Rust
 * counterpart so dashboards keep working when traffic flips.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  intentsSubmittedTotal,
  policyEvaluationsTotal,
  intentDurationSeconds,
  resetRegistry,
  getRegistry,
} from '@atlas/metrics';

beforeEach(() => {
  resetRegistry();
});

describe('Atlas metric singletons', () => {
  test('intentsSubmittedTotal labels = action + decision', () => {
    const c = intentsSubmittedTotal();
    expect(c.descriptor.name).toBe('atlas_intents_submitted_total');
    expect([...c.descriptor.labelNames].sort()).toEqual(['action', 'decision']);
    c.inc({ action: 'Catalog.SeedPackage.Apply', decision: 'permit' });
    c.inc({ action: 'Catalog.SeedPackage.Apply', decision: 'deny' });
    expect(c.get({ action: 'Catalog.SeedPackage.Apply', decision: 'permit' })).toBe(1);
  });

  test('policyEvaluationsTotal labels = decision', () => {
    const c = policyEvaluationsTotal();
    expect(c.descriptor.name).toBe('atlas_policy_evaluations_total');
    expect([...c.descriptor.labelNames]).toEqual(['decision']);
    c.inc({ decision: 'permit' });
    expect(c.get({ decision: 'permit' })).toBe(1);
  });

  test('intentDurationSeconds is a histogram with action label', () => {
    const h = intentDurationSeconds();
    expect(h.descriptor.name).toBe('atlas_intent_duration_seconds');
    expect([...h.descriptor.labelNames]).toEqual(['action']);
    h.observe(0.05, { action: 'Catalog.SeedPackage.Apply' });
    const out = getRegistry().serialize();
    expect(out).toContain('# TYPE atlas_intent_duration_seconds histogram');
    expect(out).toContain('atlas_intent_duration_seconds_bucket{action="Catalog.SeedPackage.Apply",le="0.1"} 1');
  });

  test('repeat singleton accessor returns same instance via registry', () => {
    const c1 = intentsSubmittedTotal();
    const c2 = intentsSubmittedTotal();
    expect(c1).toBe(c2);
  });
});
