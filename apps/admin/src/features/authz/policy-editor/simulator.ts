/**
 * Client-side Cedar simulator.
 *
 * Lazy-loads `@cedar-policy/cedar-wasm/web` (~1.5MB gzipped) only on
 * first use so the cost is paid once and only on the editor surface.
 * The rest of the admin bundle is unaffected.
 *
 * The simulator builds a `staticPolicies` payload by splitting the
 * editor's Cedar text via `policySetTextToParts`, then calls
 * `isAuthorized` with a hand-crafted request envelope. Round-trip
 * stays in the browser; no server hop.
 */
export interface SimulatorRequest {
    principalId: string;
    principalType?: string;
    principalAttributes?: Record<string, unknown>;
    action: string;
    resourceType: string;
    resourceId: string;
    resourceAttributes?: Record<string, unknown>;
    context?: Record<string, unknown>;
}
export interface SimulatorResult {
    decision: 'allow' | 'deny';
    matchedPolicies: readonly string[];
    reasons: readonly string[];
    warnings?: readonly string[];
}
interface CedarWasmWeb {
    isAuthorized(call: unknown): unknown;
    policySetTextToParts(text: string): unknown;
}
let cedarPromise: Promise<CedarWasmWeb> | null = null;
/**
 * Lazy import. Keeps the WASM artefact out of the rest of the admin
 * bundle — Vite splits the dynamic import into its own chunk. The
 * promise is cached so repeated simulator runs don't re-init the WASM.
 *
 * The WASM module exports `unknown` from `import(...)`'s perspective.
 * We narrow each named export through `typeof === 'function'` checks
 * and wrap them in `unknown`-in/out adapter functions — that keeps the
 * `CedarWasmWeb` surface honest without per-export `as` casts.
 */
async function loadCedar(): Promise<CedarWasmWeb> {
    if (!cedarPromise) {
        cedarPromise = (async function (): Promise<CedarWasmWeb> {
            // The web subpackage exports a default init() function for browsers;
            // calling the named exports directly works once the module's been
            // imported because the module-eval initialises the wasm via fetch.
            const mod: Record<string, unknown> = await import('@cedar-policy/cedar-wasm/web');
            const init = mod['default'];
            if (typeof init === 'function') {
                // Some builds require `await init()` to fetch the .wasm file.
                await (init as () => Promise<unknown>)();
            }
            const isAuthorizedFn = mod['isAuthorized'];
            const policySetTextToPartsFn = mod['policySetTextToParts'];
            if (typeof isAuthorizedFn !== 'function'
                || typeof policySetTextToPartsFn !== 'function') {
                throw new Error('cedar-wasm/web: failed to resolve isAuthorized or policySetTextToParts');
            }
            // Boundary: the cedar-wasm/web exports are `unknown`; we wrap each
            // function so the rest of the simulator consumes the typed
            // `CedarWasmWeb` surface. The justified casts are concentrated here.
            return {
                isAuthorized(call: unknown): unknown {
                    return (isAuthorizedFn as CedarWasmWeb['isAuthorized'])(call);
                },
                policySetTextToParts(text: string): unknown {
                    return (policySetTextToPartsFn as CedarWasmWeb['policySetTextToParts'])(text);
                },
            };
        })();
    }
    return cedarPromise;
}
/** Pre-warm the WASM module — call once when the editor mounts. */
export async function warmupSimulator(): Promise<void> {
    await loadCedar();
}
interface PolicySetTextToPartsAnswer {
    type: 'success' | 'failure';
    policies?: string[];
    policy_templates?: string[];
    errors?: Array<{
        message: string;
    }>;
}
interface IsAuthorizedSuccess {
    type: 'success';
    response: {
        decision: 'allow' | 'deny';
        diagnostics: {
            reason: string[];
            errors: Array<{
                policyId: string;
                error: {
                    message: string;
                };
            }>;
        };
    };
    warnings: Array<{
        message: string;
    }>;
}
interface IsAuthorizedFailure {
    type: 'failure';
    errors: Array<{
        message: string;
    }>;
    warnings?: Array<{
        message: string;
    }>;
}
type IsAuthorizedAnswer = IsAuthorizedSuccess | IsAuthorizedFailure;
/**
 * Boundary validator: narrow an `unknown` value (the return of a
 * cedar-wasm/web call) into the `PolicySetTextToPartsAnswer` shape we
 * consume. Anything off-shape throws — the WASM contract is fixed and
 * we'd rather fail loudly than mis-render.
 */
function asPolicySetTextToPartsAnswer(raw: unknown): PolicySetTextToPartsAnswer {
    if (raw === null || typeof raw !== 'object') {
        throw new Error('cedar policySetTextToParts: expected object answer');
    }
    const obj = raw as {
        type?: unknown;
        policies?: unknown;
        policy_templates?: unknown;
        errors?: unknown;
    };
    if (obj.type !== 'success' && obj.type !== 'failure') {
        throw new Error('cedar policySetTextToParts: missing/invalid `type`');
    }
    const out: PolicySetTextToPartsAnswer = { type: obj.type };
    if (Array.isArray(obj.policies)) {
        const strs: string[] = [];
        for (const p of obj.policies) {
            if (typeof p === 'string')
                strs.push(p);
        }
        out.policies = strs;
    }
    if (Array.isArray(obj.policy_templates)) {
        const strs: string[] = [];
        for (const p of obj.policy_templates) {
            if (typeof p === 'string')
                strs.push(p);
        }
        out.policy_templates = strs;
    }
    if (Array.isArray(obj.errors)) {
        const errs: Array<{
            message: string;
        }> = [];
        for (const eAny of obj.errors) {
            const e: unknown = eAny;
            if (e === null || typeof e !== 'object')
                continue;
            const msg = (e as {
                message?: unknown;
            }).message;
            if (typeof msg === 'string')
                errs.push({ message: msg });
        }
        out.errors = errs;
    }
    return out;
}
/**
 * Boundary validator: narrow an `unknown` value (the return of a
 * cedar-wasm/web `isAuthorized` call) into the `IsAuthorizedAnswer`
 * shape. Validates only the discriminating fields here; downstream
 * field access trusts the schema documented in the cedar-wasm/web
 * surface — anything mis-shaped fails fast with a thrown error.
 */
function asIsAuthorizedAnswer(raw: unknown): IsAuthorizedAnswer {
    if (raw === null || typeof raw !== 'object') {
        throw new Error('cedar isAuthorized: expected object answer');
    }
    const t = (raw as {
        type?: unknown;
    }).type;
    if (t !== 'success' && t !== 'failure') {
        throw new Error('cedar isAuthorized: missing/invalid `type`');
    }
    return raw as IsAuthorizedAnswer;
}
const ID_ANNOTATION = /@id(?!\w)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)/;
function buildStaticPolicies(cedarText: string, cedar: CedarWasmWeb): string | Record<string, string> {
    const parts = asPolicySetTextToPartsAnswer(cedar.policySetTextToParts(cedarText));
    if (parts.type !== 'success' || !parts.policies || parts.policies.length === 0) {
        return cedarText;
    }
    if ((parts.policy_templates ?? []).length > 0)
        return cedarText;
    const map: Record<string, string> = {};
    for (const policyText of parts.policies) {
        const match = ID_ANNOTATION.exec(policyText);
        if (!match || match[1] === undefined)
            return cedarText;
        if (Object.prototype.hasOwnProperty.call(map, match[1]))
            return cedarText;
        map[match[1]] = policyText;
    }
    return map;
}
const DEFAULT_PRINCIPAL_TYPE = 'User';
const ACTION_ENTITY_TYPE = 'Action';
export async function evaluateRequest(cedarText: string, request: SimulatorRequest): Promise<SimulatorResult> {
    const cedar = await loadCedar();
    const staticPolicies = buildStaticPolicies(cedarText, cedar);
    const principalType = request.principalType ?? DEFAULT_PRINCIPAL_TYPE;
    const call = {
        principal: { type: principalType, id: request.principalId },
        action: { type: ACTION_ENTITY_TYPE, id: request.action },
        resource: { type: request.resourceType, id: request.resourceId },
        context: request.context ?? {},
        policies: { staticPolicies },
        entities: [
            {
                uid: { type: principalType, id: request.principalId },
                attrs: request.principalAttributes ?? {},
                parents: [] as unknown[],
            },
            {
                uid: { type: request.resourceType, id: request.resourceId },
                attrs: request.resourceAttributes ?? {},
                parents: [] as unknown[],
            },
        ],
    };
    const answer = asIsAuthorizedAnswer(cedar.isAuthorized(call));
    if (answer.type === 'failure') {
        return {
            decision: 'deny',
            matchedPolicies: [],
            reasons: answer.errors.map(function (e) {
                return e.message;
            }),
            warnings: (answer.warnings ?? []).map(function (w) {
                return w.message;
            }),
        };
    }
    const reasons: string[] = [];
    for (const err of answer.response.diagnostics.errors ?? []) {
        reasons.push(`policy ${err.policyId}: ${err.error.message}`);
    }
    return {
        decision: answer.response.decision,
        matchedPolicies: [...answer.response.diagnostics.reason],
        reasons,
        warnings: answer.warnings.map(function (w) {
            return w.message;
        }),
    };
}
/**
 * Validate a Cedar bundle parses. Returns an empty array on success
 * or a list of human-readable error messages on parse failure.
 */
export async function validateCedarText(cedarText: string): Promise<readonly string[]> {
    const cedar = await loadCedar();
    const parts = asPolicySetTextToPartsAnswer(cedar.policySetTextToParts(cedarText));
    if (parts.type === 'success')
        return [];
    return (parts.errors ?? []).map(function (e) {
        return e.message;
    });
}
