/**
 * Typed test-double factories for `apps/server` unit/route tests.
 *
 * Replaces previous in-file `{ ... } as unknown as <Port>` casts. Each
 * factory builds a `base` typed as the FULL port — TypeScript fails the
 * build if a new method lands on the port and isn't stubbed here. That
 * compile-time exhaustiveness is the whole point: silent-skip casts hide
 * port drift, typed factories surface it.
 *
 * Default stubs return a sensible empty value (`null` / `[]` / void).
 * Callers pass `Partial<Port>` overrides to swap specific methods. Stubs
 * are `vi.fn(...)` where the port surface allows (non-generic methods);
 * generic methods (`EntityStore.put<T>`) use plain async fns because
 * vi.fn cannot express per-call generics without an `as` cast.
 *
 * Mirrored at `packages/ingress/test/lib/factories.ts` — cross-package
 * test-folder imports are not exposed by the workspace exports map, so
 * the two files deliberately carry the same basic port factories. The
 * composite `AppState` / `RequestBundle` factories below are server-only
 * because they reference apps/server types.
 */
import { vi } from '@atlas/test';
import type { Context } from 'hono';
import type { ActionEntry, Cache, CatalogStateStore, ControlPlaneRegistry, Entity, EntityStore, EventStore, HandlerRegistry, IntentHandler, PolicyDecision, PolicyEngine, PolicyEvaluationRequest, ProjectionStore, Relation, RelationStore, SearchEngine, StoredEvent, } from '@atlas/ports';
import type { ValidateFunction } from '@atlas/schemas';
import type { EventEnvelope } from '@atlas/platform-core';
import { CollectorSink, InMemoryLevelController, LogPipeline, createSystemContext, } from '@atlas/logging';
import type { IngressState, EventDispatcher } from '@atlas/ingress';
import type { AppState } from '../../src/bootstrap.ts';
import type { AppConfig } from '../../src/config.ts';
import type { RequestBundle } from '../../src/middleware/state.ts';
import type { ServerVariables } from '../../src/middleware/principal.ts';
// ── Cache ───────────────────────────────────────────────────────────
export function makeFakeCache(overrides: Partial<Cache> = {}): Cache {
    const base: Cache = {
        get: vi.fn(async function () {
            return null;
        }),
        set: vi.fn(async function () { }),
        invalidateByKey: vi.fn(async function () {
            return false;
        }),
        invalidateByTags: vi.fn(async function () {
            return 0;
        }),
    };
    return { ...base, ...overrides };
}
// ── ProjectionStore ─────────────────────────────────────────────────
export function makeFakeProjections(overrides: Partial<ProjectionStore> = {}): ProjectionStore {
    const base: ProjectionStore = {
        get: vi.fn(async function () {
            return null;
        }),
        set: vi.fn(async function () { }),
        delete: vi.fn(async function () {
            return false;
        }),
    };
    return { ...base, ...overrides };
}
// ── SearchEngine ────────────────────────────────────────────────────
export function makeFakeSearch(overrides: Partial<SearchEngine> = {}): SearchEngine {
    const base: SearchEngine = {
        index: vi.fn(async function () { }),
        deleteByDocument: vi.fn(async function () { }),
        search: vi.fn(async function () {
            return [];
        }),
    };
    return { ...base, ...overrides };
}
// ── CatalogStateStore ───────────────────────────────────────────────
export function makeFakeCatalogState(overrides: Partial<CatalogStateStore> = {}): CatalogStateStore {
    const base: CatalogStateStore = {
        get: vi.fn(async function () {
            return null;
        }),
        put: vi.fn(async function () { }),
    };
    return { ...base, ...overrides };
}
// ── EntityStore ─────────────────────────────────────────────────────
export function makeFakeEntityStore(overrides: Partial<EntityStore> = {}): EntityStore {
    const base: EntityStore = {
        async get() {
            return null;
        },
        async put<TAttrs = unknown>(input: import('@atlas/ports').EntityWriteInput<TAttrs>): Promise<Entity<TAttrs>> {
            const now = new Date().toISOString();
            return {
                tenantId: input.tenantId,
                entityType: input.entityType,
                entityId: input.entityId,
                schemaVersion: input.schemaVersion ?? 1,
                attrs: input.attrs,
                status: input.status ?? 'active',
                createdAt: now,
                updatedAt: now,
            };
        },
        async delete() { },
        async list() {
            return [];
        },
        async query() {
            return [];
        },
    };
    return { ...base, ...overrides };
}
// ── RelationStore ───────────────────────────────────────────────────
export function makeFakeRelationStore(overrides: Partial<RelationStore> = {}): RelationStore {
    const base: RelationStore = {
        async add<TAttrs = unknown>(input: import('@atlas/ports').RelationWriteInput<TAttrs>): Promise<Relation<TAttrs>> {
            return {
                tenantId: input.tenantId,
                edgeType: input.edgeType,
                fromId: input.fromId,
                toId: input.toId,
                attrs: input.attrs ?? null,
                createdAt: new Date().toISOString(),
            };
        },
        async remove() { },
        async outgoing() {
            return [];
        },
        async incoming() {
            return [];
        },
    };
    return { ...base, ...overrides };
}
// ── EventStore (stateful) ───────────────────────────────────────────
export interface StatefulEventStore extends EventStore {
    readonly appended: EventEnvelope[];
    /** Seed a prior event so the next `findByIdempotencyKey` returns it. */
    seedIdempotent(envelope: EventEnvelope): void;
}
export function makeFakeEventStore(overrides: Partial<EventStore> = {}): StatefulEventStore {
    const appended: EventEnvelope[] = [];
    const byIdemKey = new Map<string, EventEnvelope>();
    let nextSeq = 1n;
    const base: EventStore = {
        async append(envelope: EventEnvelope): Promise<StoredEvent> {
            const stored: StoredEvent = {
                ...envelope,
                eventId: envelope.eventId || `evt-${appended.length + 1}`,
                seq: nextSeq++,
            };
            appended.push(stored);
            if (envelope.idempotencyKey) {
                byIdemKey.set(`${envelope.tenantId}::${envelope.idempotencyKey}`, stored);
            }
            return stored;
        },
        async getEvent() {
            return null;
        },
        async findByIdempotencyKey(tenantId, idempotencyKey) {
            return byIdemKey.get(`${tenantId}::${idempotencyKey}`) ?? null;
        },
        async readEvents() {
            return [...appended];
        },
    };
    const merged = { ...base, ...overrides };
    return Object.assign(merged, {
        appended,
        seedIdempotent(envelope: EventEnvelope): void {
            if (!envelope.idempotencyKey) {
                throw new Error('seedIdempotent: envelope must have idempotencyKey');
            }
            byIdemKey.set(`${envelope.tenantId}::${envelope.idempotencyKey}`, envelope);
        },
    });
}
// ── ControlPlaneRegistry + validators ───────────────────────────────
export type LocalValidator = ((data: unknown) => boolean) & {
    errors?: ReadonlyArray<{
        instancePath?: string;
        message?: string;
    }> | null;
};
export function makeValidator(ok: boolean, errors: ReadonlyArray<{
    instancePath?: string;
    message?: string;
}> = []): LocalValidator {
    const fn = (function (_d: unknown) {
        return ok;
    }) as LocalValidator;
    fn.errors = ok ? null : errors;
    return fn;
}
export function makeRegistry(opts: {
    validators?: Record<string, LocalValidator>;
    actions?: Record<string, ActionEntry>;
}): ControlPlaneRegistry {
    return {
        hasAction(id) {
            return Boolean(opts.actions?.[id]);
        },
        getAction(id) {
            return opts.actions?.[id] ?? null;
        },
        getSchemaValidator(schemaId, version) {
            const v = opts.validators?.[`${schemaId}:${version}`] ?? null;
            // The contract expects Ajv's `ValidateFunction`; the test's local
            // `LocalValidator` is structurally a narrower surface (callable +
            // `.errors`). Production call sites only invoke the call signature
            // and read `.errors`, so the substitution is safe. This is the
            // one remaining double-cast in this file — it tracks Ajv's
            // type-only impedance, not a port-fake escape hatch.
            return v as unknown as ValidateFunction | null;
        },
    };
}
// ── Policy engines ──────────────────────────────────────────────────
export class StubAllowEngine implements PolicyEngine {
    async evaluate(_req: PolicyEvaluationRequest): Promise<PolicyDecision> {
        return { effect: 'permit', reasons: ['stub allow'] };
    }
}
export class StubDenyEngine implements PolicyEngine {
    async evaluate(_req: PolicyEvaluationRequest): Promise<PolicyDecision> {
        return { effect: 'deny', reasons: ['stub deny'] };
    }
}
// ── AppState scaffolding ────────────────────────────────────────────
export interface FakeAppStateOptions {
    tenantId?: string;
    principalId?: string;
}
export interface FakeAppState {
    state: AppState;
    collector: CollectorSink;
}
/**
 * Build a minimal `AppState` for route tests. Most fields are populated
 * with a typed throw-on-access proxy because route tests should never
 * exercise the long-lived adapter surface (Postgres pools, JWKS, the
 * WASM host) — if a test hits one it's an honest bug, not a missing fake.
 *
 * The two fields tests legitimately need — `config`, `logPipeline`,
 * `levelController`, and `policyEngine` — are populated with real
 * lightweight values; everything else throws on access. The throw-on-
 * access pattern keeps the AppState type honest while still being a
 * "fake" in the test sense.
 */
export function buildFakeAppState(opts: FakeAppStateOptions = {}): FakeAppState {
    const collector = new CollectorSink();
    const levelController = new InMemoryLevelController('debug');
    const logPipeline = new LogPipeline([collector], levelController);
    const tenantApex = 'localhost';
    const port = 3000;
    const config: AppConfig = {
        port,
        controlPlaneDbUrl: 'postgres://unused',
        oidc: { issuerUrl: '', jwksUrl: '', audience: '' },
        testAuth: { enabled: true, debugEndpoints: false },
        tenantId: opts.tenantId ?? 'tenant-a',
        rustLog: '',
        environment: 'test' as const,
        policyEngine: 'stub' as const,
        workerMode: 'inline' as const,
        insecureCookies: true,
        cookieDomain: '',
        tenantApex,
        publicBaseUrl: `http://localhost:${port.toString()}`,
        tenantBaseUrl: function (tenantId: string) { return `http://${tenantId}.${tenantApex}:${port.toString()}`; },
        mailerMode: 'noop',
        smtp: null,
        devMode: {
            enabled: false,
            principalId: 'dev-admin',
            tenantId: 'dev-tenant',
            roles: ['admin'],
        },
    };
    // Build a throw-on-access proxy for the fields tests should not be
    // touching. Reading any of them throws with the field name so a stray
    // test pulling on (say) `state.tenantDb` produces an honest error
    // rather than a `Cannot read property X of null`.
    const notWired = function <T>(field: string): T {
        const handler: ProxyHandler<object> = {
            get(_target, prop) {
                throw new Error(`AppState.${field}.${String(prop)} accessed in test — buildFakeAppState does not wire ${field}; pass a real value if the test needs it`);
            },
        };
        return new Proxy({}, handler) as T;
    };
    const state: AppState = {
        config,
        logPipeline,
        levelController,
        inspectionSink: notWired('inspectionSink'),
        controlPlaneSql: notWired('controlPlaneSql'),
        tenantDb: notWired('tenantDb'),
        controlPlaneRegistry: notWired('controlPlaneRegistry'),
        customDomains: notWired('customDomains'),
        customDomainCache: notWired('customDomainCache'),
        principalCache: notWired('principalCache'),
        entityTypeRegistry: notWired('entityTypeRegistry'),
        upcasterRegistry: notWired('upcasterRegistry'),
        jwks: null,
        migratedTenants: new Set<string>(),
        policyEngine: new StubAllowEngine(),
        wasmHost: notWired('wasmHost'),
        serverEvents: notWired('serverEvents'),
        signupRequests: notWired('signupRequests'),
        tenants: notWired('tenants'),
        mailer: notWired('mailer'),
        emailLog: notWired('emailLog'),
        secrets: notWired('secrets'),
        compression: notWired('compression'),
        crypto: notWired('crypto'),
    };
    return { state, collector };
}
// ── RequestBundle scaffolding ───────────────────────────────────────
export interface FakeBundleOptions {
    tenantId?: string;
    principalId?: string;
    policyEngine?: PolicyEngine;
    /** Pre-seed entries by `${tenantId}::${idempotencyKey}` → envelope. */
    priorEvents?: Array<EventEnvelope>;
    /** Schemas the registry recognises. Default: a single permissive validator for `test.action.v1`. */
    validators?: Record<string, LocalValidator>;
    /** Actions the registry recognises. */
    actions?: Record<string, ActionEntry>;
    /** Handlers keyed by actionId. When omitted, the generic-fallthrough event path runs. */
    handlers?: Record<string, IntentHandler>;
    /** Capture the dispatcher invocations. */
    onDispatch?: (envelope: EventEnvelope) => void | Promise<void>;
    state: AppState;
    correlationId: string;
}
export interface FakeBundle extends RequestBundle {
    events: StatefulEventStore;
    dispatchSpy: {
        calls: EventEnvelope[];
    };
}
export function buildFakeBundle(opts: FakeBundleOptions): FakeBundle {
    const tenantId = opts.tenantId ?? opts.state.config.tenantId ?? 'tenant-a';
    const principalId = opts.principalId ?? 'user-1';
    const events = makeFakeEventStore();
    for (const e of opts.priorEvents ?? []) {
        if (e.idempotencyKey) {
            events.seedIdempotent(e);
        }
    }
    const cache = makeFakeCache();
    const projections = makeFakeProjections();
    const search = makeFakeSearch();
    const catalogState = makeFakeCatalogState();
    const entities = makeFakeEntityStore();
    const relations = makeFakeRelationStore();
    const registry = makeRegistry({
        validators: opts.validators ?? {
            'test.action.v1:1': makeValidator(true),
        },
        actions: opts.actions ?? {
            'Test.Action.Do': {
                actionId: 'Test.Action.Do',
                resourceType: 'TestResource',
                schemaId: 'test.action.v1',
                schemaVersion: 1,
            },
        },
    });
    const handlers: HandlerRegistry = {
        get: function (actionId) {
            return opts.handlers?.[actionId];
        },
    };
    const dispatchSpy: {
        calls: EventEnvelope[];
    } = { calls: [] };
    const dispatch: EventDispatcher = async function (envelope) {
        dispatchSpy.calls.push(envelope);
        await opts.onDispatch?.(envelope);
    };
    const ingressCtx = createSystemContext({
        pipeline: opts.state.logPipeline,
        environment: opts.state.config.environment,
        tenantId,
        moduleId: '@atlas/ingress',
        correlationId: opts.correlationId,
    });
    const ingress: IngressState = {
        tenantId,
        principalId,
        correlationId: opts.correlationId,
        eventStore: events,
        cache,
        projections,
        search,
        registry,
        catalogState,
        handlers,
        dispatch,
        policyEngine: opts.policyEngine ?? new StubAllowEngine(),
        logger: ingressCtx.logger,
    };
    const principal = {
        principalId,
        tenantId,
        userId: principalId,
        roles: [] as string[],
        attributes: {} as Record<string, unknown>,
    };
    const bundle: FakeBundle = {
        ingress,
        catalogDeps: {
            tenantId,
            principalId,
            correlationId: opts.correlationId,
            projections,
            search,
        },
        contentPagesDeps: {
            tenantId,
            principalId,
            correlationId: opts.correlationId,
            entities,
            relations,
        },
        identityDeps: {
            tenantId,
            principalId,
            correlationId: opts.correlationId,
            entities,
            relations,
        },
        principal,
        events,
        dispatchSpy,
    };
    return bundle;
}
// ── Hono test-app middleware ────────────────────────────────────────
export interface AttachOptions {
    /** Override the principal middleware result. When undefined, no principal is set (simulates 401-style flow). */
    principal?: {
        principalId: string;
        tenantId: string;
    };
    correlationId?: string;
    state: AppState;
}
export function attachTestPrincipalMiddleware(app: import('hono').Hono<{
    Variables: ServerVariables;
}>, opts: AttachOptions): void {
    app.use('*', async function (c: Context<{
        Variables: ServerVariables;
    }>, next) {
        if (opts.principal) {
            c.set('principal', opts.principal);
        }
        const corr = c.req.header('X-Correlation-Id') ??
            c.req.header('x-correlation-id') ??
            opts.correlationId ??
            'corr-test';
        c.set('correlationId', corr);
        c.set('ctx', createSystemContext({
            pipeline: opts.state.logPipeline,
            environment: opts.state.config.environment,
            tenantId: opts.principal?.tenantId ?? 'tenant-a',
            moduleId: '@atlas/server',
            correlationId: corr,
        }));
        await next();
    });
}
