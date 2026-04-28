/**
 * Correlation-id propagation. Honours an inbound `X-Correlation-Id` header
 * when present; mints a fresh id otherwise. The id flows through the
 * IngressState into events (Invariant I5).
 */

import type { Context } from 'hono';

const HEADER = 'X-Correlation-Id';

function newCorrelationId(): string {
  // Hono runs on Node 18+ where crypto.randomUUID is global.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function correlationIdFor(c: Context): string {
  const inbound = c.req.header(HEADER) ?? c.req.header(HEADER.toLowerCase());
  if (inbound && inbound.length > 0) return inbound;
  return newCorrelationId();
}
