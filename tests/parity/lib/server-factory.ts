/**
 * HTTP factory — talks to a running `apps/server` over fetch.
 *
 * Used by `*-node.test.ts` parity tests. Construction takes a base URL,
 * tenantId, and principalId; the resulting `BrowserIngress` issues real
 * HTTP requests using the `X-Debug-Principal` test-auth pathway, which
 * `apps/server` accepts when `TEST_AUTH_ENABLED=true`.
 *
 * Errors are unpacked from the structured envelope (see
 * `apps/server/src/middleware/errors.ts`) and surfaced as
 * `IngressFailureError` so tests can assert on `code`/`status` identically to
 * the sim factory.
 *
 * Sim-only helpers (`readEventTags`, `truncateSearch`, `indexSearchDocument`)
 * throw `UnsupportedInMode`. Tests that need them must be sim-only.
 */

import {
  IngressFailureError,
  UnsupportedInMode,
  type BrowserIngress,
  type FactoryOptions,
  type HealthResponse,
  type IngressFailure,
} from './factory.ts';
import type {
  IntentEnvelope,
  IntentResponse,
  SearchDocument,
} from '@atlas/platform-core';
import type {
  TaxonomyNavigationResponse,
  FamilyDetailResponse,
  VariantTableParams,
  VariantTableResponse,
  SearchParams,
  SearchResponse,
} from '@atlas/modules-catalog';

export interface ServerFactoryOptions extends FactoryOptions {
  baseUrl: string;
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    correlationId?: string;
  };
}

function debugPrincipalHeader(opts: ServerFactoryOptions): string {
  // Server parser accepts at most three colon-separated segments
  // (type:id[:tenantId]). The principalId provided by tests already includes
  // the tenant suffix in some sim cases; for HTTP we always pass the
  // principal id verbatim and let the server stamp tenantId.
  // Format: user:<id>:<tenantId>
  return `user:${opts.principalId}:${opts.tenantId}`;
}

async function parseErrorBody(res: Response): Promise<IngressFailure> {
  const text = await res.text();
  let parsed: ErrorEnvelope = {};
  try {
    parsed = JSON.parse(text) as ErrorEnvelope;
  } catch {
    // Fall through to a generic envelope.
  }
  const code = parsed.error?.code ?? 'TRANSACTION_FAILED';
  const message = parsed.error?.message ?? (text || `HTTP ${res.status}`);
  const correlationId = parsed.error?.correlationId;
  const failure: IngressFailure = { code, status: res.status, message };
  if (correlationId !== undefined) {
    failure.correlationId = correlationId;
  }
  return failure;
}

export async function createServerIngress(
  opts: ServerFactoryOptions,
): Promise<BrowserIngress> {
  const headers = (extra?: Record<string, string>): Record<string, string> => ({
    'X-Debug-Principal': debugPrincipalHeader(opts),
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  });

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${opts.baseUrl}${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new IngressFailureError(await parseErrorBody(res));
    }
    return (await res.json()) as T;
  };

  const get = async <T>(path: string): Promise<{ ok: true; value: T } | { ok: false; failure: IngressFailure }> => {
    const res = await fetch(`${opts.baseUrl}${path}`, {
      method: 'GET',
      headers: headers(),
    });
    if (!res.ok) {
      return { ok: false, failure: await parseErrorBody(res) };
    }
    return { ok: true, value: (await res.json()) as T };
  };

  const ingress: BrowserIngress = {
    mode: 'node',
    tenantId: opts.tenantId,
    principalId: opts.principalId,

    async submitIntent(envelope: IntentEnvelope): Promise<IntentResponse> {
      return post<IntentResponse>('/api/v1/intents', envelope);
    },

    async submitIntentRaw(envelope) {
      try {
        const response = await post<IntentResponse>('/api/v1/intents', envelope);
        return { ok: true, response };
      } catch (e) {
        if (e instanceof IngressFailureError) {
          const failure: IngressFailure = {
            code: e.code,
            status: e.status,
            message: e.message,
          };
          if (e.correlationId !== undefined) failure.correlationId = e.correlationId;
          return { ok: false, failure };
        }
        if (e instanceof Error) {
          return {
            ok: false,
            failure: { code: 'TRANSACTION_FAILED', status: 500, message: e.message },
          };
        }
        return {
          ok: false,
          failure: { code: 'TRANSACTION_FAILED', status: 500, message: String(e) },
        };
      }
    },

    async getTaxonomyNodes(treeKey: string): Promise<TaxonomyNavigationResponse | null> {
      const r = await get<TaxonomyNavigationResponse>(
        `/api/v1/catalog/taxonomies/${encodeURIComponent(treeKey)}/nodes`,
      );
      if (r.ok) return r.value;
      if (r.failure.status === 404) return null;
      throw new IngressFailureError(r.failure);
    },

    async getFamilyDetail(familyKey: string): Promise<FamilyDetailResponse | null> {
      const r = await get<FamilyDetailResponse>(
        `/api/v1/catalog/families/${encodeURIComponent(familyKey)}`,
      );
      if (r.ok) return r.value;
      if (r.failure.status === 404) return null;
      throw new IngressFailureError(r.failure);
    },

    async getVariantTable(
      familyKey: string,
      params?: VariantTableParams,
    ): Promise<VariantTableResponse | null> {
      const qs = new URLSearchParams();
      if (params?.sort !== undefined) qs.set('sort', params.sort);
      if (params?.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
      if (params?.filters) {
        for (const [k, v] of Object.entries(params.filters)) {
          if (!v) continue;
          if (v.kind === 'equals') {
            qs.set(`filter.${k}`, String(v.value));
          } else if (v.kind === 'range') {
            if (v.gte !== undefined) qs.set(`filter.${k}.gte`, String(v.gte));
            if (v.lte !== undefined) qs.set(`filter.${k}.lte`, String(v.lte));
          }
        }
      }
      const path = `/api/v1/catalog/families/${encodeURIComponent(familyKey)}/variants${
        qs.toString() ? `?${qs}` : ''
      }`;
      const r = await get<VariantTableResponse>(path);
      if (r.ok) return r.value;
      if (r.failure.status === 404) return null;
      throw new IngressFailureError(r.failure);
    },

    async searchCatalog(params: SearchParams): Promise<SearchResponse> {
      const qs = new URLSearchParams();
      qs.set('q', params.q);
      if (params.type !== undefined) qs.set('type', params.type);
      if (params.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
      if (params.cursor !== undefined) qs.set('cursor', params.cursor);
      const r = await get<SearchResponse>(`/api/v1/catalog/search?${qs}`);
      if (r.ok) return r.value;
      throw new IngressFailureError(r.failure);
    },

    async readEventTags(_eventId: string): Promise<string[] | null> {
      throw new UnsupportedInMode('readEventTags', 'node');
    },

    async truncateSearch(): Promise<void> {
      throw new UnsupportedInMode('truncateSearch', 'node');
    },

    async indexSearchDocument(_doc: SearchDocument): Promise<void> {
      throw new UnsupportedInMode('indexSearchDocument', 'node');
    },

    async health(): Promise<{ status: number; body: HealthResponse }> {
      const res = await fetch(`${opts.baseUrl}/healthz`, { method: 'GET' });
      const body = (await res.json()) as HealthResponse;
      return { status: res.status, body };
    },

    async ready(): Promise<{ status: number; body: HealthResponse }> {
      const res = await fetch(`${opts.baseUrl}/readyz`, { method: 'GET' });
      const body = (await res.json()) as HealthResponse;
      return { status: res.status, body };
    },

    async whoami(headerOverride): Promise<{ status: number; body: unknown }> {
      const h: Record<string, string> = {};
      if (headerOverride?.debugPrincipal !== undefined) {
        h['X-Debug-Principal'] = headerOverride.debugPrincipal;
      } else if (headerOverride?.bearer !== undefined) {
        h['Authorization'] = `Bearer ${headerOverride.bearer}`;
      } else {
        h['X-Debug-Principal'] = debugPrincipalHeader(opts);
      }
      const res = await fetch(`${opts.baseUrl}/debug/whoami`, {
        method: 'GET',
        headers: h,
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // leave as text
      }
      return { status: res.status, body };
    },

    async close(): Promise<void> {
      // No persistent client state; HTTP layer is stateless across calls.
    },
  };

  return ingress;
}

let counter = 0;

export function uniqueServerTenantId(prefix: string): string {
  counter++;
  return `${prefix}-${counter}-${Date.now().toString(36)}`;
}

/**
 * Convenience wrapper that mints a unique tenantId + principal and returns
 * a server-backed ingress. Reads the base URL from `NODE_PARITY_BASE_URL`
 * which the test runner already exports for node-mode parity tests.
 */
export async function makeServerIngress(prefix: string): Promise<{
  ingress: BrowserIngress;
  tenantId: string;
  principalId: string;
}> {
  const baseUrl = process.env['NODE_PARITY_BASE_URL'];
  if (!baseUrl) {
    throw new Error(
      'NODE_PARITY_BASE_URL must be set for node-mode parity tests',
    );
  }
  const tenantId = uniqueServerTenantId(prefix);
  const principalId = `test-user-${tenantId}`;
  const ingress = await createServerIngress({ baseUrl, tenantId, principalId });
  return { ingress, tenantId, principalId };
}
