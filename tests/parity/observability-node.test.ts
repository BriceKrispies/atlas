/**
 * Observability parity in node mode — Chunk 7.1.
 *
 * Mirrors `tests/blackbox/suites/observability_test.rs` with the
 * adaptations the TS port requires:
 *
 * - Atlas TS metrics are namespace-prefixed (`atlas_*`); the Rust
 *   counterparts are not. We only assert the names that exist on
 *   the TS side, which is sufficient parity for dashboards once
 *   they ship the prefix-aware queries.
 * - The Rust suite checks `events_appended_total{tenant_id, ...}`
 *   and `http_requests_total{route, ...}`. Those are not yet wired
 *   on the TS side (no HTTP middleware metric, no event-store
 *   metric). They land in a follow-up chunk; for now we exercise
 *   only the metrics this chunk wires.
 *
 * Skipped automatically when `NODE_PARITY_BASE_URL` is absent —
 * matches the rest of the parity suite.
 */

import { describe, test, expect } from 'vitest';

const baseUrl = process.env['NODE_PARITY_BASE_URL'];
const d = baseUrl ? describe : describe.skip;

interface PrometheusSample {
  labels: Record<string, string>;
  value: number;
}

function parsePrometheus(body: string): Map<string, PrometheusSample[]> {
  const out = new Map<string, PrometheusSample[]>();
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const lastSpace = line.lastIndexOf(' ');
    if (lastSpace <= 0) continue;
    const head = line.slice(0, lastSpace);
    const valueStr = line.slice(lastSpace + 1);
    const value = Number(valueStr);
    if (!Number.isFinite(value)) continue;
    const lbrace = head.indexOf('{');
    let name: string;
    const labels: Record<string, string> = {};
    if (lbrace === -1) {
      name = head;
    } else {
      name = head.slice(0, lbrace);
      const rbrace = head.lastIndexOf('}');
      const block = head.slice(lbrace + 1, rbrace);
      // Quick label parser — values are escape-quoted strings, no
      // commas inside values for our metric set.
      for (const part of splitLabelBlock(block)) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        const k = part.slice(0, eq);
        const vRaw = part.slice(eq + 1);
        const v = vRaw.startsWith('"') && vRaw.endsWith('"') ? vRaw.slice(1, -1) : vRaw;
        labels[k] = v;
      }
    }
    const list = out.get(name) ?? [];
    list.push({ labels, value });
    out.set(name, list);
  }
  return out;
}

function splitLabelBlock(block: string): string[] {
  // Split on top-level commas (not inside quoted values).
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < block.length; i += 1) {
    const ch = block[i];
    if (ch === '"' && block[i - 1] !== '\\') inQuote = !inQuote;
    if (ch === ',' && !inQuote) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

async function fetchMetrics(): Promise<Map<string, PrometheusSample[]>> {
  const res = await fetch(`${baseUrl}/metrics`, { method: 'GET' });
  expect(res.status).toBe(200);
  const ct = res.headers.get('content-type') ?? '';
  expect(ct).toContain('text/plain');
  return parsePrometheus(await res.text());
}

d('[node] observability parity', () => {
  test('metrics endpoint responds with prometheus content-type', async () => {
    const res = await fetch(`${baseUrl}/metrics`, { method: 'GET' });
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('text/plain');
    expect(ct).toContain('version=0.0.4');
  });

  test('atlas_intents_submitted_total is exposed (counter family)', async () => {
    const metrics = await fetchMetrics();
    // Either present (if a previous test submitted) or 0-baseline. The
    // counter HELP/TYPE lines guarantee at least one parsed sample row
    // when no labelled observations exist; for labelled counters,
    // emptiness is fine. We just assert the family TYPE/HELP rendered.
    const res = await fetch(`${baseUrl}/metrics`, { method: 'GET' });
    const body = await res.text();
    expect(body).toContain('# TYPE atlas_intents_submitted_total counter');
    expect(metrics).toBeDefined();
  });

  test('atlas_policy_evaluations_total is exposed', async () => {
    const res = await fetch(`${baseUrl}/metrics`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('# TYPE atlas_policy_evaluations_total counter');
  });

  test('atlas_intent_duration_seconds histogram type registered', async () => {
    const res = await fetch(`${baseUrl}/metrics`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('# TYPE atlas_intent_duration_seconds histogram');
  });

  test('metrics include label keys when populated', async () => {
    // Intent-submission tests in other parity files run before / after
    // and populate the counter; even if they don't, the assertion
    // shape stays valid (presence of label keys is checked only when
    // samples exist).
    const metrics = await fetchMetrics();
    const samples = metrics.get('atlas_intents_submitted_total');
    if (samples && samples.length > 0) {
      for (const s of samples) {
        expect(s.labels).toHaveProperty('action');
        expect(s.labels).toHaveProperty('decision');
      }
    }
  });
});
