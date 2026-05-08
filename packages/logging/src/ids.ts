/**
 * Identifier helpers for the execution-context spine. Uses node:crypto;
 * no third-party deps.
 */
import { randomBytes, randomUUID } from 'node:crypto';

export function newCorrelationId(): string {
  return randomUUID();
}

export function newSpanId(): string {
  // 8-byte hex — short, easy to grep, far more than enough entropy
  // for span identity within a single trace.
  return randomBytes(8).toString('hex');
}

export function newRequestId(): string {
  return randomUUID();
}

const CORRELATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Validate an inbound correlationId from a caller (HTTP header, message,
 * etc.). Returns the value if it's a safe-shaped id; null otherwise.
 *
 * Sanitizing prevents log-injection / unbounded-length / control-char
 * issues from polluting structured log lines.
 */
export function sanitizeIncomingCorrelationId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 128) return null;
  return CORRELATION_ID_RE.test(raw) ? raw : null;
}
