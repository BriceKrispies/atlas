/**
 * Test harness for `apps/server/src/routes/intents.ts`.
 *
 * The production `buildRequestBundle` (in `middleware/state.ts`) constructs
 * Postgres-backed adapters, runs migrations, and enriches principals from
 * the per-tenant entity store. Booting that chain in a unit test would
 * require a real Postgres pool — which is exactly what the route test is
 * trying to avoid.
 *
 * Instead we expose a `buildFakeAppState(opts)` helper that:
 *
 *   - constructs a minimal `AppState` with a logging pipeline backed by a
 *     `CollectorSink` so tests can assert log lines emitted by the route;
 *   - hands back a `RequestBundle`-shaped object whose `IngressState` uses
 *     in-memory ports + a stub permit/deny policy engine + a configurable
 *     handler registry + ControlPlaneRegistry;
 *   - is composable via `vi.mock('../../src/middleware/state.ts', ...)` —
 *     each test installs its own bundle, the route runs unchanged.
 *
 * Future route tests (e.g. for the catalog read paths) can reuse the same
 * helper.
 */

import { vi } from 'vitest';
import type { Context } from 'hono';
import type {
  ActionEntry,
  Cache,
  CatalogStateStore,
  ControlPlaneRegistry,
  EntityStore,
  EventStore,
  HandlerRegistry,
  IntentHandler,
  PolicyDecision,
  PolicyEngine,
  PolicyEvaluationRequest,
  ProjectionStore,
  SearchEngine,
  StoredEvent,
} from '@atlas/ports';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import type { EventEnvelope } from '@atlas/platform-core';
import {
  CollectorSink,
  InMemoryLevelController,
  LogPipeline,
  createSystemContext,
} from '@atlas/logging';
import type { AppState } from '../../src/bootstrap.ts';
import type {
  RequestBundle,
} from '../../src/middleware/state.ts';
import type { ServerVariables } from '../../src/middleware/principal.ts';
import type { IngressState, EventDispatcher } from '@atlas/ingress';

// --------------------------------------------------------------------
// In-memory ports (the bare minimum submitIntent touches).
// --------------------------------------------------------------------

export class FakeEventStore implements EventStore {
  appended: EventEnvelope[] = [];
  byIdemKey = new Map<string, EventEnvelope>();
  private nextSeq = 1n;
  async append(envelope: EventEnvelope): Promise<StoredEvent> {
    const stored: StoredEvent = {
      ...envelope,
      eventId: envelope.eventId || `evt-${this.appended.length + 1}`,
      seq: this.nextSeq++,
    } as StoredEvent;
    this.appended.push(stored);
    if (envelope.idempotencyKey) {
      this.byIdemKey.set(`${envelope.tenantId}::${envelope.idempotencyKey}`, stored);
    }
    return stored;
  }
  async getEvent(): Promise<EventEnvelope | null> {
    return null;
  }
  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<EventEnvelope | null> {
    return this.byIdemKey.get(`${tenantId}::${idempotencyKey}`) ?? null;
  }
  async readEvents(): Promise<EventEnvelope[]> {
    return [...this.appended];
  }
}

const fakeCache = (): Cache =>
  ({
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    invalidateTags: async () => {},
  }) as unknown as Cache;

const fakeProjections = (): ProjectionStore =>
  ({
    get: async () => null,
    put: async () => {},
    delete: async () => {},
    list: async () => [],
  }) as unknown as ProjectionStore;

const fakeSearch = (): SearchEngine =>
  ({
    index: async () => {},
    search: async () => ({ hits: [], total: 0 }),
    delete: async () => {},
  }) as unknown as SearchEngine;

const fakeCatalogState = (): CatalogStateStore =>
  ({
    get: async () => null,
    put: async () => {},
  }) as unknown as CatalogStateStore;

// --------------------------------------------------------------------
// Validators + registry.
// --------------------------------------------------------------------

type LocalValidator = ((data: unknown) => boolean) & {
  errors?: ReadonlyArray<{ instancePath?: string; message?: string }> | null;
};

export function makeValidator(
  ok: boolean,
  errors: ReadonlyArray<{ instancePath?: string; message?: string }> = [],
): LocalValidator {
  const fn = ((_d: unknown) => ok) as LocalValidator;
  (fn as { errors: LocalValidator['errors'] }).errors = ok ? null : errors;
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
      return v as unknown as ValidateFunction | null;
    },
  };
}

// --------------------------------------------------------------------
// Policy engines.
// --------------------------------------------------------------------

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

// --------------------------------------------------------------------
// AppState scaffolding.
// --------------------------------------------------------------------

export interface FakeAppStateOptions {
  tenantId?: string;
  principalId?: string;
}

export interface FakeAppState {
  state: AppState;
  collector: CollectorSink;
}

export function buildFakeAppState(opts: FakeAppStateOptions = {}): FakeAppState {
  const collector = new CollectorSink();
  const levelController = new InMemoryLevelController('debug');
  const logPipeline = new LogPipeline([collector], levelController);
  const config = {
    port: 3000,
    controlPlaneDbUrl: 'postgres://unused',
    oidc: { issuerUrl: '', jwksUrl: '', audience: '' },
    testAuth: { enabled: true, debugEndpoints: false },
    tenantId: opts.tenantId ?? 'tenant-a',
    rustLog: '',
    environment: 'test' as const,
    policyEngine: 'stub' as const,
    workerMode: 'inline' as const,
  };
  const state = {
    config,
    logPipeline,
    levelController,
    inspectionSink: null as never,
    controlPlaneSql: null as never,
    tenantDb: null as never,
    controlPlaneRegistry: null as never,
    customDomains: null as never,
    customDomainCache: null as never,
    entityTypeRegistry: null as never,
    upcasterRegistry: null as never,
    jwks: null,
    migratedTenants: new Set<string>(),
    policyEngine: new StubAllowEngine(),
    wasmHost: null as never,
    serverEvents: null as never,
    signupRequests: null as never,
    tenants: null as never,
    mailer: null as never,
    emailLog: null as never,
  } as unknown as AppState;
  return { state, collector };
}

// --------------------------------------------------------------------
// RequestBundle scaffolding.
// --------------------------------------------------------------------

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
  events: FakeEventStore;
  dispatchSpy: { calls: EventEnvelope[] };
}

export function buildFakeBundle(opts: FakeBundleOptions): FakeBundle {
  const tenantId = opts.tenantId ?? opts.state.config.tenantId ?? 'tenant-a';
  const principalId = opts.principalId ?? 'user-1';
  const events = new FakeEventStore();
  for (const e of opts.priorEvents ?? []) {
    if (e.idempotencyKey) {
      events.byIdemKey.set(`${e.tenantId}::${e.idempotencyKey}`, e);
    }
  }
  const cache = fakeCache();
  const projections = fakeProjections();
  const search = fakeSearch();
  const catalogState = fakeCatalogState();
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
    get: (actionId) => opts.handlers?.[actionId],
  };
  const dispatchSpy: { calls: EventEnvelope[] } = { calls: [] };
  const dispatch: EventDispatcher = async (envelope) => {
    dispatchSpy.calls.push(envelope);
    await opts.onDispatch?.(envelope);
  };
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
    logger: createSystemContext({
      pipeline: opts.state.logPipeline,
      environment: opts.state.config.environment,
      tenantId,
      moduleId: '@atlas/ingress',
      correlationId: opts.correlationId,
    }).logger,
  } as unknown as IngressState;

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
    } as unknown as RequestBundle['catalogDeps'],
    contentPagesDeps: {
      tenantId,
      principalId,
      correlationId: opts.correlationId,
      entities: null as unknown as EntityStore,
      relations: null as never,
    } as unknown as RequestBundle['contentPagesDeps'],
    identityDeps: {
      tenantId,
      principalId,
      correlationId: opts.correlationId,
      entities: null as unknown as EntityStore,
      relations: null as never,
    } as unknown as RequestBundle['identityDeps'],
    principal: principal as unknown as RequestBundle['principal'],
    events,
    dispatchSpy,
  };
  return bundle;
}

// --------------------------------------------------------------------
// Hono test-app builder. Sets the variables intents.ts reads
// (`principal`, `correlationId`, `ctx`).
// --------------------------------------------------------------------

export interface AttachOptions {
  /** Override the principal middleware result. When undefined, no principal is set (simulates 401-style flow). */
  principal?: { principalId: string; tenantId: string };
  correlationId?: string;
  state: AppState;
}

export function attachTestPrincipalMiddleware(
  app: import('hono').Hono<{ Variables: ServerVariables }>,
  opts: AttachOptions,
): void {
  app.use('*', async (c: Context<{ Variables: ServerVariables }>, next) => {
    if (opts.principal) {
      c.set('principal', opts.principal);
    }
    const corr =
      c.req.header('X-Correlation-Id') ??
      c.req.header('x-correlation-id') ??
      opts.correlationId ??
      'corr-test';
    c.set('correlationId', corr);
    c.set(
      'ctx',
      createSystemContext({
        pipeline: opts.state.logPipeline,
        environment: opts.state.config.environment,
        tenantId: opts.principal?.tenantId ?? 'tenant-a',
        moduleId: '@atlas/server',
        correlationId: corr,
      }),
    );
    await next();
  });
}
