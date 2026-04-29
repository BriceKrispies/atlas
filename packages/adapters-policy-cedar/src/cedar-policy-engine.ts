/**
 * Cedar-backed `PolicyEngine` adapter.
 *
 * Wraps `@cedar-policy/cedar-wasm`'s `isAuthorized` JSON FFI behind the
 * Atlas `PolicyEngine` port. Per-tenant bundles are loaded via a
 * `PolicyBundleLoader` (Postgres or fixture) on first use and cached
 * keyed by `(tenantId, version)`. Combination semantics are deny-overrides
 * (Invariant I4) — Cedar's evaluator already enforces that, so we just
 * surface its decision verbatim.
 *
 * Fall-back semantics when a tenant has no bundle: the engine falls
 * through to the same allow-all-with-tenant-scope behaviour as
 * `StubPolicyEngine`. Rationale: a tenant that hasn't authored policies
 * yet shouldn't lock themselves out at boot. Strict mode (deny-on-no-bundle)
 * is a future-config flag; the safer default for self-onboarding is the
 * permissive fallback.
 *
 * Schema is intentionally not passed to Cedar in this chunk — schema-aware
 * diagnostics + validation arrive in Chunk 6c (`schema-generator.ts`).
 *
 * Imports from `@cedar-policy/cedar-wasm/nodejs` are resolved lazily via a
 * dynamic import so consumers that never call `evaluate` (e.g. health
 * probes during boot) don't pay the ~12 MB WASM load cost. The first call
 * blocks on the import; subsequent calls are synchronous against the
 * cached module handle.
 */

import type {
  PolicyDecision,
  PolicyEngine,
  PolicyEvaluationRequest,
} from '@atlas/ports';

import { buildCedarRequest } from './entity-store.ts';
import type { ParsedBundle, PolicyBundleLoader } from './bundle-loader.ts';

/**
 * Cedar's `AuthorizationCall` — narrowed to the fields we send. The full
 * shape lives in `cedar-policy/src/ffi/is_authorized.rs::AuthorizationCall`.
 * We don't import Cedar's TS types here because cedar-wasm's nodejs
 * subpackage exports a `.d.ts` that requires WASM resolution, and we want
 * this module to typecheck without the WASM file present.
 */
interface AuthorizationCall {
  principal: { type: string; id: string };
  action: { type: string; id: string };
  resource: { type: string; id: string };
  context: Record<string, unknown>;
  policies: { staticPolicies: string };
  entities: Array<{
    uid: { type: string; id: string };
    attrs: Record<string, unknown>;
    parents: Array<{ type: string; id: string }>;
  }>;
}

interface CedarSuccessResponse {
  type: 'success';
  response: {
    decision: 'allow' | 'deny';
    diagnostics: {
      reason: string[];
      errors: Array<{ policyId: string; error: { message: string } }>;
    };
  };
  warnings: Array<{ message: string }>;
}

interface CedarFailureResponse {
  type: 'failure';
  errors: Array<{ message: string }>;
  warnings: Array<{ message: string }>;
}

type CedarResponse = CedarSuccessResponse | CedarFailureResponse;

/**
 * Subset of `@cedar-policy/cedar-wasm/nodejs` we depend on. Declared
 * explicitly so the rest of the codebase can mock it in tests without
 * pulling in the WASM artefact.
 */
export interface CedarWasm {
  isAuthorized(call: AuthorizationCall): CedarResponse;
}

export type CedarWasmLoader = () => Promise<CedarWasm>;

/**
 * Default loader — `import('@cedar-policy/cedar-wasm/nodejs')`. Wrapped in
 * a function so tests can inject a stub (avoids loading the WASM binary
 * in CI environments where it's not needed).
 */
const defaultLoader: CedarWasmLoader = async () => {
  // The nodejs subpackage is published as CommonJS but exposes named
  // exports. The dynamic import returns a namespace whose `default` is
  // the module record; named exports are also reachable directly.
  const mod = (await import(
    '@cedar-policy/cedar-wasm/nodejs'
  )) as unknown as Record<string, unknown> & { default?: Record<string, unknown> };
  const candidate = (mod['isAuthorized'] ?? mod.default?.['isAuthorized']) as
    | CedarWasm['isAuthorized']
    | undefined;
  if (typeof candidate !== 'function') {
    throw new Error(
      'cedar-wasm: failed to resolve isAuthorized from @cedar-policy/cedar-wasm/nodejs',
    );
  }
  return { isAuthorized: candidate };
};

export interface CedarPolicyEngineOptions {
  /**
   * Override the WASM loader — primarily for tests that want to inject a
   * fake `isAuthorized` rather than load the real binary.
   */
  cedarLoader?: CedarWasmLoader;
}

export class CedarPolicyEngine implements PolicyEngine {
  private cedar: CedarWasm | null = null;
  private cedarLoading: Promise<CedarWasm> | null = null;
  /** Cache of parsed bundles keyed by `tenantId` (version is part of the
   * cached value). Invalidation is per-tenant via {@link invalidate}. */
  private readonly bundleCache: Map<string, ParsedBundle> = new Map();
  private readonly loader: PolicyBundleLoader;
  private readonly cedarLoader: CedarWasmLoader;

  constructor(loader: PolicyBundleLoader, opts: CedarPolicyEngineOptions = {}) {
    this.loader = loader;
    this.cedarLoader = opts.cedarLoader ?? defaultLoader;
  }

  /**
   * Drop cached bundles for a single tenant. Wired to be called from the
   * event pipeline on `Tenant:{tenantId}` / `Policy:{policyId}` cache-tag
   * events; the wiring itself is deferred to a follow-up.
   */
  invalidate(tenantId: string): void {
    this.bundleCache.delete(tenantId);
  }

  /** Drop every cached bundle. Useful for tests; not wired to events. */
  invalidateAll(): void {
    this.bundleCache.clear();
  }

  async evaluate(request: PolicyEvaluationRequest): Promise<PolicyDecision> {
    // Shape validation — every adapter is expected to reject malformed
    // input rather than silently coerce. Mirrors `StubPolicyEngine` so the
    // contract suite passes both adapters with the same assertions.
    if (!request.principal.id) {
      throw new Error('PolicyEngine: principal.id must be non-empty');
    }
    if (!request.principal.tenantId) {
      throw new Error('PolicyEngine: principal.tenantId must be non-empty');
    }
    if (!request.resource.tenantId) {
      throw new Error('PolicyEngine: resource.tenantId must be non-empty');
    }

    // Defensive cross-tenant deny — the same check ingress's tenant-scope
    // middleware does at step 2. Mirrored here so the engine is safe to
    // call directly from tests + future surfaces.
    if (request.principal.tenantId !== request.resource.tenantId) {
      return {
        effect: 'deny',
        reasons: ['cedar: tenant mismatch'],
      };
    }

    const bundle = await this.loadBundle(request.principal.tenantId);
    if (!bundle) {
      // Permissive fallback: a tenant without a bundle gets the same
      // allow-all-with-tenant-scope semantics as the stub engine.
      // Document at module-level (file header) — DO NOT change this
      // without coordinating with platform-ops.
      return {
        effect: 'permit',
        reasons: ['cedar: no policy bundle for tenant — permissive fallback'],
      };
    }

    const cedar = await this.ensureCedar();
    const refs = buildCedarRequest(request);
    const call: AuthorizationCall = {
      principal: refs.principal,
      action: refs.action,
      resource: refs.resource,
      context: refs.context,
      policies: { staticPolicies: bundle.cedarText },
      entities: refs.entities,
    };

    let answer: CedarResponse;
    try {
      answer = cedar.isAuthorized(call);
    } catch (e) {
      // Cedar throws on internal errors (rare — typically wasm-binding
      // issues). Surface as deny so a flaky engine doesn't accidentally
      // permit, but include the error in `reasons` for diagnostics.
      const message = e instanceof Error ? e.message : String(e);
      return {
        effect: 'deny',
        reasons: [`cedar: evaluator threw: ${message}`],
      };
    }

    if (answer.type === 'failure') {
      // Parse-level failure (e.g. malformed bundle). Treat as deny — a
      // tenant whose bundle won't parse is locked down rather than
      // silently allowed. This matches the principle that broken policy
      // is more dangerous than no policy.
      const messages = answer.errors.map((e) => `cedar parse error: ${e.message}`);
      return {
        effect: 'deny',
        reasons: messages.length > 0 ? messages : ['cedar: bundle failed to parse'],
      };
    }

    const { decision, diagnostics } = answer.response;
    const reasons: string[] = [];
    for (const err of diagnostics.errors ?? []) {
      reasons.push(`policy ${err.policyId}: ${err.error.message}`);
    }
    if (reasons.length === 0) {
      reasons.push(
        decision === 'allow'
          ? `cedar: permit by ${diagnostics.reason.length} matching polic${diagnostics.reason.length === 1 ? 'y' : 'ies'}`
          : 'cedar: deny (no permit, or forbid overrode permit)',
      );
    }

    return {
      effect: decision === 'allow' ? 'permit' : 'deny',
      reasons,
      matchedPolicies: [...diagnostics.reason],
    };
  }

  private async loadBundle(tenantId: string): Promise<ParsedBundle | null> {
    const cached = this.bundleCache.get(tenantId);
    if (cached) return cached;
    const fresh = await this.loader.load(tenantId);
    if (fresh) {
      this.bundleCache.set(tenantId, fresh);
    }
    return fresh;
  }

  private async ensureCedar(): Promise<CedarWasm> {
    if (this.cedar) return this.cedar;
    // Coalesce concurrent evaluators on first hit so we never load the
    // WASM module twice.
    if (!this.cedarLoading) {
      this.cedarLoading = this.cedarLoader().then((c) => {
        this.cedar = c;
        return c;
      });
    }
    return this.cedarLoading;
  }
}
