/**
 * Builds a capabilities record for a <widget-host> from a fixture spec.
 *
 * Each capability entry is an array of rules; the first rule whose
 * `match` object matches the invocation args wins. Rules with no `match`
 * act as catch-alls. Four behaviors are supported:
 *
 *   fixture  — resolve with `response`
 *   delay    — resolve with `response` after `delayMs`
 *   reject   — reject with `new Error(error)`
 *   hang     — return a promise that never settles (useful for verifying
 *              loading/skeleton states without racing the resolver)
 *
 * The returned capability object plugs directly into `<widget-host>.capabilities`.
 */

export type MockBehavior = 'fixture' | 'delay' | 'reject' | 'hang';

export interface MockCapabilityRule {
  match?: Record<string, unknown>;
  behavior?: MockBehavior;
  response?: unknown;
  error?: string;
  delayMs?: number;
}

export type MockCapabilitySpec = Record<string, MockCapabilityRule[]>;

export type CapabilityFn = (args: unknown) => Promise<unknown>;

function argsMatch(match: Record<string, unknown> | undefined, args: unknown): boolean {
  if (!match || typeof match !== 'object') return true;
  if (!args || typeof args !== 'object') return false;
  const a = args as Record<string, unknown>;
  for (const [k, v] of Object.entries(match)) {
    if (a[k] !== v) return false;
  }
  return true;
}

function runRule(rule: MockCapabilityRule): Promise<unknown> {
  const behavior: MockBehavior = rule.behavior ?? 'fixture';
  if (behavior === 'fixture') return Promise.resolve(rule.response);
  if (behavior === 'reject') return Promise.reject(new Error(rule.error ?? 'mock rejection'));
  if (behavior === 'delay') {
    const ms = typeof rule.delayMs === 'number' ? rule.delayMs : 500;
    return new Promise((resolve) => setTimeout(() => resolve(rule.response), ms));
  }
  if (behavior === 'hang') return new Promise(() => {});
  return Promise.reject(new Error(`unknown mock behavior '${behavior as string}'`));
}

export function buildMockCapabilities(
  spec: MockCapabilitySpec | null | undefined,
): Record<string, CapabilityFn> {
  const out: Record<string, CapabilityFn> = {};
  for (const [name, rules] of Object.entries(spec ?? {})) {
    if (!Array.isArray(rules)) continue;
    out[name] = async (args: unknown) => {
      for (const rule of rules) {
        if (argsMatch(rule.match, args)) return runRule(rule);
      }
      throw new Error(`no mock rule matched capability '${name}'`);
    };
  }
  return out;
}
