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
} from '@atlas/catalog';
import type {
  PageDocument,
  PageSummary,
  RenderTree,
} from '@atlas/content-pages';

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

    async readEventTags(eventId: string): Promise<string[] | null> {
      // Hits the test-only `/debug/events/:eventId` endpoint shipped in
      // Chunk 7.2. Available only when the server runs with both
      // `TEST_AUTH_ENABLED=true` and `DEBUG_AUTH_ENDPOINT_ENABLED=true`.
      // 404 → null (mirrors the sim adapter contract). When the gate is
      // off the route isn't mounted; tests should be guarded by
      // `NODE_PARITY_BASE_URL` describe-skip so they don't run there.
      const r = await get<{ cacheInvalidationTags?: string[] | null }>(
        `/debug/events/${encodeURIComponent(eventId)}`,
      );
      if (!r.ok) {
        if (r.failure.status === 404) return null;
        if (r.failure.status === 401) {
          throw new UnsupportedInMode('readEventTags', 'node');
        }
        throw new IngressFailureError(r.failure);
      }
      return r.value.cacheInvalidationTags ?? null;
    },

    async listContentPages(): Promise<readonly PageSummary[]> {
      const r = await get<readonly PageSummary[]>('/api/v1/pages');
      if (r.ok) return r.value;
      throw new IngressFailureError(r.failure);
    },

    async getContentPage(pageId: string): Promise<PageDocument | null> {
      const r = await get<PageDocument>(
        `/api/v1/pages/${encodeURIComponent(pageId)}`,
      );
      if (r.ok) return r.value;
      if (r.failure.status === 404) return null;
      throw new IngressFailureError(r.failure);
    },

    async getContentPageRenderTree(pageId: string): Promise<RenderTree | null> {
      const r = await get<RenderTree>(
        `/api/v1/pages/${encodeURIComponent(pageId)}/render-tree`,
      );
      if (r.ok) return r.value;
      if (r.failure.status === 404) return null;
      throw new IngressFailureError(r.failure);
    },

    async clearRenderTreeFastPath(pageId: string): Promise<void> {
      // Hits the test-only `/debug/render-tree/clear?pageId=...` endpoint
      // shipped in Chunk 10. Available only when the server runs with both
      // `TEST_AUTH_ENABLED=true` and `DEBUG_AUTH_ENDPOINT_ENABLED=true`.
      // Tests should be guarded by `NODE_PARITY_BASE_URL` describe-skip.
      const url = `${opts.baseUrl}/debug/render-tree/clear?pageId=${encodeURIComponent(pageId)}`;
      const res = await fetch(url, { method: 'POST', headers: headers() });
      if (res.status === 404 || res.status === 401) {
        throw new UnsupportedInMode('clearRenderTreeFastPath', 'node');
      }
      if (!res.ok) {
        throw new IngressFailureError(await parseErrorBody(res));
      }
    },

    async truncateSearch(): Promise<void> {
      const res = await fetch(`${opts.baseUrl}/debug/search/rebuild`, {
        method: 'POST',
        headers: headers(),
      });
      if (res.status === 404 || res.status === 401) {
        throw new UnsupportedInMode('truncateSearch', 'node');
      }
      if (!res.ok) {
        throw new IngressFailureError(await parseErrorBody(res));
      }
    },

    async indexSearchDocument(doc: SearchDocument): Promise<void> {
      const res = await fetch(`${opts.baseUrl}/debug/search/index`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(doc),
      });
      if (res.status === 404 || res.status === 401) {
        throw new UnsupportedInMode('indexSearchDocument', 'node');
      }
      if (!res.ok) {
        throw new IngressFailureError(await parseErrorBody(res));
      }
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

    async registerWasmPlugin(_pluginRef: string, _bytes: Uint8Array): Promise<void> {
      throw new UnsupportedInMode('registerWasmPlugin', 'node');
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
