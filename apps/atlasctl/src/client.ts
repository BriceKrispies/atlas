import { readFileSync } from 'node:fs';
import { Agent as HttpsAgent } from 'node:https';
import type { Credential } from './auth.ts';

export interface ClientOptions {
  endpoint: string;
  credential: Credential;
  correlationId: string;
}

export interface RequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ResponseRecord {
  status: number;
  body: unknown;
  correlationId: string;
}

/**
 * Build an https.Agent from an mTLS credential. Validates the credential
 * shape (file reads will throw if cert/key/ca paths are unreadable).
 *
 * Phase A: the agent is constructed for shape verification but the actual
 * request path below refuses mTLS — server-side mTLS support is deferred
 * per specs/crosscut/atlasctl.md. Exported for unit tests.
 */
export function buildAgent(credential: Credential): HttpsAgent | undefined {
  if (credential.kind !== 'mtls') return undefined;
  const cert = readFileSync(credential.cert);
  const key = readFileSync(credential.key);
  const ca = credential.ca !== undefined ? readFileSync(credential.ca) : undefined;
  const opts: ConstructorParameters<typeof HttpsAgent>[0] =
    ca !== undefined ? { cert, key, ca } : { cert, key };
  return new HttpsAgent(opts);
}

export async function request(
  client: ClientOptions,
  req: RequestOptions,
): Promise<ResponseRecord> {
  if (client.credential.kind === 'mtls') {
    // Phase A: agent constructs (validates inputs) but the request path
    // is not yet plumbed through node:undici/dispatcher. Server-side
    // mTLS support is also deferred. Surface a clear error rather than
    // silently sending unauthenticated.
    buildAgent(client.credential);
    throw new Error(
      'mTLS request path is wired but not exercised: server-side mTLS support is deferred per Phase A (see specs/crosscut/atlasctl.md).',
    );
  }
  const url = new URL(req.path, client.endpoint).toString();
  const headers: Record<string, string> = {
    'X-Correlation-Id': client.correlationId,
    Accept: 'application/json',
    ...req.headers,
  };
  if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (client.credential.kind === 'api-key') {
    headers['X-Api-Key'] = client.credential.key;
  } else if (client.credential.kind === 'token') {
    headers['Authorization'] = `Bearer ${client.credential.token}`;
  } else if (client.credential.kind === 'debug-principal') {
    // Test-auth bypass: server accepts this only when TEST_AUTH_ENABLED=true.
    // Production servers reject the header.
    headers['X-Debug-Principal'] = client.credential.principalJson;
  }
  const init: RequestInit = {
    method: req.method ?? 'GET',
    headers,
  };
  if (req.body !== undefined) {
    init.body = JSON.stringify(req.body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  const cid = res.headers.get('x-correlation-id') ?? client.correlationId;
  return { status: res.status, body, correlationId: cid };
}
