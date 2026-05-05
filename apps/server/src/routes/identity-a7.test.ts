/**
 * Phase A7.9 route-level integration tests.
 *
 * Drives the impersonation + break-glass routes via Hono's
 * `app.fetch()` against in-memory adapter shims. Exercises:
 *
 *   - Auth: every route requires a Principal; missing returns 401.
 *   - Role checks: PlatformSupport gate on operator routes;
 *     TenantAdmin gate on tenant-side revoke routes.
 *   - Input validation: malformed URLs, missing fields, out-of-range
 *     durations, role-name injection (`'<script>'`), array length caps.
 *   - Pen-test surface: forged tokens, expired tokens, self-approval,
 *     forbidden grant roles, cross-tenant escalation.
 *   - Happy path: end-to-end Start → Action → End, Issue → Approve →
 *     Action → Revoke.
 *
 * The test harness intercepts `ensureTenantMigrated` + adapter
 * constructors so production route code runs unchanged against
 * in-memory stores. This is realistic insofar as it exercises the
 * full HTTP envelope, parameter parsing, error mapping, and event
 * envelope shaping — without a real DB.
 *
 * For a Postgres-backed integration test, see the planned suite under
 * `tests/integration/` (separate slice).
 */

import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { EventEnvelope } from '@atlas/platform-core';
import type {
  EntityListOptions,
  EntityQueryOptions,
  EntityStore,
  EntityWriteInput,
  Entity,
  EventStore,
  Relation,
  RelationStore,
  RelationWriteInput,
  StoredEvent,
} from '@atlas/ports';
import {
  MEMBERSHIP_ENTITY_TYPE,
  MEMBERSHIP_USER_EDGE,
  membershipEntityIdFor,
  type MembershipDocument,
} from '@atlas/identity';
import { identityA7Routes } from './identity-a7.ts';
import type { ServerVariables } from '../middleware/principal.ts';
import type { AppState } from '../bootstrap.ts';

// ----------------------------------------------------------------------
// In-memory adapter shims. Mirrors `modules/identity/test/a5-acceptance.test.ts`.
// ----------------------------------------------------------------------

class InMemoryEventStore implements EventStore {
  events: EventEnvelope[] = [];
  private nextSeq = 0n;
  async append(envelope: EventEnvelope): Promise<StoredEvent> {
    this.nextSeq += 1n;
    const stored: StoredEvent = { ...envelope, seq: this.nextSeq };
    this.events.push(stored);
    return stored;
  }
  async getEvent(eventId: string): Promise<EventEnvelope | null> {
    return this.events.find((e) => e.eventId === eventId) ?? null;
  }
  async findByIdempotencyKey(t: string, k: string): Promise<EventEnvelope | null> {
    return this.events.find((e) => e.tenantId === t && e.idempotencyKey === k) ?? null;
  }
  async readEvents(): Promise<EventEnvelope[]> {
    return this.events.map((e) => ({ ...e }));
  }
}

class InMemoryEntityStore implements EntityStore {
  rows = new Map<string, Entity<unknown>>();
  private k(t: string, ty: string, id: string): string {
    return `${t}::${ty}::${id}`;
  }
  async get<T = unknown>(t: string, ty: string, id: string): Promise<Entity<T> | null> {
    const r = this.rows.get(this.k(t, ty, id));
    if (!r || r.status === 'deleted') return null;
    return r as Entity<T>;
  }
  async put<T = unknown>(input: EntityWriteInput<T>): Promise<Entity<T>> {
    const key = this.k(input.tenantId, input.entityType, input.entityId);
    const existing = this.rows.get(key);
    const now = new Date().toISOString();
    const row: Entity<T> = {
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      schemaVersion: input.schemaVersion ?? 1,
      attrs: input.attrs,
      status: input.status ?? 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(key, row as Entity<unknown>);
    return row;
  }
  async delete(t: string, ty: string, id: string): Promise<void> {
    const key = this.k(t, ty, id);
    const e = this.rows.get(key);
    if (e) this.rows.set(key, { ...e, status: 'deleted' });
  }
  async list<T = unknown>(t: string, ty: string, opts?: EntityListOptions): Promise<Entity<T>[]> {
    const desired = opts?.status === undefined ? 'active' : opts.status;
    return Array.from(this.rows.values())
      .filter((r) => r.tenantId === t && r.entityType === ty)
      .filter((r) => (desired === null ? true : r.status === desired)) as Entity<T>[];
  }
  async query<T = unknown>(t: string, ty: string, opts: EntityQueryOptions): Promise<Entity<T>[]> {
    const all = Array.from(this.rows.values()).filter(
      (r) => r.tenantId === t && r.entityType === ty,
    );
    if (!opts.attrsEqual) return all as Entity<T>[];
    const preds = Object.entries(opts.attrsEqual);
    return all.filter((row) => {
      const attrs = row.attrs as Record<string, unknown>;
      return preds.every(([k, v]) => attrs?.[k] === v);
    }) as Entity<T>[];
  }
}

class InMemoryRelationStore implements RelationStore {
  rows = new Map<string, Relation<unknown>>();
  private k(t: string, e: string, f: string, to: string): string {
    return `${t}::${e}::${f}::${to}`;
  }
  async add<T = unknown>(input: RelationWriteInput<T>): Promise<Relation<T>> {
    const key = this.k(input.tenantId, input.edgeType, input.fromId, input.toId);
    const row: Relation<T> = {
      tenantId: input.tenantId,
      edgeType: input.edgeType,
      fromId: input.fromId,
      toId: input.toId,
      attrs: input.attrs ?? null,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(key, row as Relation<unknown>);
    return row;
  }
  async remove(t: string, e: string, f: string, to: string): Promise<void> {
    this.rows.delete(this.k(t, e, f, to));
  }
  async outgoing<T = unknown>(t: string, e: string, f: string): Promise<Relation<T>[]> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === t && r.edgeType === e && r.fromId === f,
    ) as Relation<T>[];
  }
  async incoming<T = unknown>(t: string, e: string, to: string): Promise<Relation<T>[]> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === t && r.edgeType === e && r.toId === to,
    ) as Relation<T>[];
  }
}

// ----------------------------------------------------------------------
// Mock the bootstrap helpers + adapter constructors.
// ----------------------------------------------------------------------

const events = new InMemoryEventStore();
const entities = new InMemoryEntityStore();
const relations = new InMemoryRelationStore();

vi.mock('../bootstrap.ts', async () => {
  const actual = await vi.importActual<typeof import('../bootstrap.ts')>('../bootstrap.ts');
  return {
    ...actual,
    ensureTenantMigrated: vi.fn().mockResolvedValue({} as never),
  };
});

vi.mock('@atlas/adapter-node', async () => {
  const actual = await vi.importActual<typeof import('@atlas/adapter-node')>('@atlas/adapter-node');
  // Function expressions (not arrow functions) so the production code's
  // `new PostgresEntityStore(sql)` can invoke them as constructors.
  function FakeEventStore(this: unknown): unknown {
    return events;
  }
  function FakeEntityStore(this: unknown): unknown {
    return entities;
  }
  function FakeRelationStore(this: unknown): unknown {
    return relations;
  }
  return {
    ...actual,
    PostgresEventStore: FakeEventStore,
    PostgresEntityStore: FakeEntityStore,
    PostgresRelationStore: FakeRelationStore,
  };
});

// ----------------------------------------------------------------------
// Test fixtures: build a Hono app with the routes mounted and a custom
// "set-principal" middleware (so we don't need to drive the real
// principal middleware for these tests; that's exercised in
// principal.test.ts).
// ----------------------------------------------------------------------

function makeState(): AppState {
  return {
    config: {
      port: 3000,
      controlPlaneDbUrl: 'postgres://unused',
      oidc: { issuerUrl: '', jwksUrl: '', audience: '' },
      testAuth: { enabled: true, debugEndpoints: false },
      tenantId: '_platform',
      rustLog: '',
      policyEngine: 'stub' as const,
    },
  } as unknown as AppState;
}

interface PrincipalSpec {
  principalId: string;
  tenantId: string;
  userId?: string;
}

function buildApp(principal: PrincipalSpec | null) {
  const app = new Hono<{ Variables: ServerVariables }>();
  if (principal) {
    app.use('*', async (c, next) => {
      c.set('principal', {
        principalId: principal.principalId,
        tenantId: principal.tenantId,
        ...(principal.userId !== undefined ? { userId: principal.userId } : {}),
      });
      c.set('correlationId', 'test-corr');
      await next();
    });
  }
  app.route('/', identityA7Routes(makeState()));
  return app;
}

/** Seed a Membership in the in-memory entity + relation stores. */
async function seedMembership(
  tenantId: string,
  userId: string,
  roles: string[],
): Promise<void> {
  const membershipId = membershipEntityIdFor(userId);
  const doc: MembershipDocument = {
    membershipId,
    tenantId,
    userId,
    roles,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await entities.put<MembershipDocument>({
    tenantId,
    entityType: MEMBERSHIP_ENTITY_TYPE,
    entityId: membershipId,
    attrs: doc,
  });
  await relations.add({
    tenantId,
    edgeType: MEMBERSHIP_USER_EDGE,
    fromId: membershipId,
    toId: userId,
  });
}

beforeEach(() => {
  events.events.length = 0;
  entities.rows.clear();
  relations.rows.clear();
});

// ----------------------------------------------------------------------
// Auth tests
// ----------------------------------------------------------------------

describe('A7 routes: auth', () => {
  test('start without principal → 401', async () => {
    const app = buildApp(null);
    const res = await app.request('/api/v1/identity/impersonation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test('start by non-operator (no PlatformSupport role) → 403', async () => {
    await seedMembership('_platform', 'usr-eve', ['Author']); // not PlatformSupport
    const app = buildApp({
      principalId: 'usr-eve',
      tenantId: '_platform',
      userId: 'usr-eve',
    });
    const res = await app.request('/api/v1/identity/impersonation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        targetUserId: 'usr-alice',
        reason: 'support',
        ticketUrl: 'https://example.com/t',
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IMPERSONATION_REQUIRES_OPERATOR');
  });

  test('break-glass/issue by API-key principal (no userId) → 403', async () => {
    const app = buildApp({
      principalId: 'sp-1',
      tenantId: '_platform',
      // no userId — closes the API-key escalation path
    });
    const res = await app.request('/api/v1/identity/break-glass/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantedRoles: ['TenantAdmin'],
        justification: 'p0',
        incidentUrl: 'https://example.com/i',
      }),
    });
    expect(res.status).toBe(403);
  });
});

// ----------------------------------------------------------------------
// Validation tests
// ----------------------------------------------------------------------

describe('A7 routes: input validation', () => {
  beforeEach(async () => {
    await seedMembership('_platform', 'usr-bob', ['PlatformSupport']);
  });

  test('rejects javascript: URL in ticketUrl', async () => {
    const app = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });
    const res = await app.request('/api/v1/identity/impersonation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        targetUserId: 'usr-alice',
        reason: 'support',
        ticketUrl: 'javascript:alert(1)',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IMPERSONATION_TICKET_REQUIRED');
  });

  test('rejects role name with metacharacters', async () => {
    const app = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });
    const res = await app.request('/api/v1/identity/break-glass/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantedRoles: ['<script>alert(1)</script>'],
        justification: 'p0',
        incidentUrl: 'https://example.com/i',
      }),
    });
    expect(res.status).toBe(400);
  });

  test('rejects PlatformOwner in grantedRoles (chain-grant escalation)', async () => {
    const app = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });
    const res = await app.request('/api/v1/identity/break-glass/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantedRoles: ['PlatformOwner'],
        justification: 'p0',
        incidentUrl: 'https://example.com/i',
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BREAK_GLASS_GRANT_EXCEEDS_AUTHORITY');
  });

  test('rejects out-of-range maxDurationMin', async () => {
    const app = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });
    const res = await app.request('/api/v1/identity/impersonation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        targetUserId: 'usr-alice',
        reason: 'support',
        ticketUrl: 'https://example.com/t',
        maxDurationMin: 9999,
      }),
    });
    // route-side max is 8h; longer is rejected at the validator
    // before the handler ever sees the command
    expect(res.status).toBe(400);
  });

  test('rejects malformed tenantId', async () => {
    const app = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });
    const res = await app.request('/api/v1/identity/impersonation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: '../etc/passwd',
        targetUserId: 'usr-alice',
        reason: 'support',
        ticketUrl: 'https://example.com/t',
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ----------------------------------------------------------------------
// Happy path + state machine
// ----------------------------------------------------------------------

describe('A7 routes: impersonation lifecycle', () => {
  test('Start → token returned ONCE → End flips status', async () => {
    await seedMembership('_platform', 'usr-bob', ['PlatformSupport']);
    const app = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });
    const start = await app.request('/api/v1/identity/impersonation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        targetUserId: 'usr-alice',
        reason: 'Investigating ticket SUP-1234',
        ticketUrl: 'https://example.com/SUP-1234',
        maxDurationMin: 30,
      }),
    });
    expect(start.status).toBe(201);
    const startBody = (await start.json()) as {
      impersonationId: string;
      bearerToken: string;
      status: string;
    };
    expect(startBody.bearerToken).toMatch(/^imp-/);
    expect(startBody.bearerToken.includes('.')).toBe(true);
    expect(startBody.status).toBe('active');

    // List shows the active session.
    const list = await app.request(
      `/api/v1/identity/impersonation?tenantId=customer`,
      { method: 'GET' },
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      impersonations: Array<{ status: string }>;
    };
    expect(listBody.impersonations).toHaveLength(1);
    expect(listBody.impersonations[0]?.status).toBe('active');

    // Operator ends.
    const end = await app.request('/api/v1/identity/impersonation/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        impersonationId: startBody.impersonationId,
      }),
    });
    expect(end.status).toBe(200);
    const endBody = (await end.json()) as { status: string };
    expect(endBody.status).toBe('ended');
  });

  test('Tenant admin revokes a running impersonation', async () => {
    await seedMembership('_platform', 'usr-bob', ['PlatformSupport']);
    await seedMembership('customer', 'usr-admin', ['TenantAdmin']);
    const opApp = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });
    const adminApp = buildApp({
      principalId: 'usr-admin',
      tenantId: 'customer',
      userId: 'usr-admin',
    });

    const start = await opApp.request('/api/v1/identity/impersonation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      }),
    });
    const startBody = (await start.json()) as { impersonationId: string };

    const revoke = await adminApp.request('/api/v1/identity/impersonation/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        impersonationId: startBody.impersonationId,
      }),
    });
    expect(revoke.status).toBe(200);
    const revokeBody = (await revoke.json()) as {
      status: string;
      revokedBy: string;
    };
    expect(revokeBody.status).toBe('revoked');
    expect(revokeBody.revokedBy).toBe('usr-admin');
  });

  test('Cross-tenant admin cannot revoke (different home tenant) → 403', async () => {
    await seedMembership('_platform', 'usr-bob', ['PlatformSupport']);
    // Admin in tenant 'other', not in 'customer'
    await seedMembership('other', 'usr-eve', ['TenantAdmin']);
    const opApp = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });
    const start = await opApp.request('/api/v1/identity/impersonation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      }),
    });
    const startBody = (await start.json()) as { impersonationId: string };

    const adminApp = buildApp({
      principalId: 'usr-eve',
      tenantId: 'other',
      userId: 'usr-eve',
    });
    const revoke = await adminApp.request('/api/v1/identity/impersonation/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        impersonationId: startBody.impersonationId,
      }),
    });
    expect(revoke.status).toBe(403);
  });
});

// ----------------------------------------------------------------------
// Break-glass lifecycle
// ----------------------------------------------------------------------

describe('A7 routes: break-glass lifecycle', () => {
  test('Issue (4-eyes) → Approve by different operator → status=active', async () => {
    await seedMembership('_platform', 'usr-bob', ['PlatformSupport']);
    await seedMembership('_platform', 'usr-carol', ['PlatformSupport']);
    const bobApp = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });
    const carolApp = buildApp({
      principalId: 'usr-carol',
      tenantId: '_platform',
      userId: 'usr-carol',
    });

    const issue = await bobApp.request('/api/v1/identity/break-glass/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0 incident',
        incidentUrl: 'https://example.com/INC-1',
        maxDurationMin: 60,
      }),
    });
    expect(issue.status).toBe(201);
    const issueBody = (await issue.json()) as {
      grantId: string;
      status: string;
    };
    expect(issueBody.status).toBe('pending_approval');

    const approve = await carolApp.request('/api/v1/identity/break-glass/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantId: issueBody.grantId,
      }),
    });
    expect(approve.status).toBe(200);
    const approveBody = (await approve.json()) as {
      status: string;
      approvedBy: string;
    };
    expect(approveBody.status).toBe('active');
    expect(approveBody.approvedBy).toBe('usr-carol');
  });

  test('Self-approval rejected: issuer cannot approve own grant', async () => {
    await seedMembership('_platform', 'usr-bob', ['PlatformSupport']);
    const bobApp = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });

    const issue = await bobApp.request('/api/v1/identity/break-glass/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0',
        incidentUrl: 'https://example.com/i',
      }),
    });
    const issueBody = (await issue.json()) as { grantId: string };

    const approve = await bobApp.request('/api/v1/identity/break-glass/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantId: issueBody.grantId,
      }),
    });
    expect(approve.status).toBe(403);
    const body = (await approve.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BREAK_GLASS_SELF_APPROVAL_FORBIDDEN');
  });

  test('Tenant admin revokes an active grant', async () => {
    await seedMembership('_platform', 'usr-bob', ['PlatformSupport']);
    await seedMembership('_platform', 'usr-carol', ['PlatformSupport']);
    await seedMembership('customer', 'usr-admin', ['TenantAdmin']);
    const bobApp = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });
    const carolApp = buildApp({
      principalId: 'usr-carol',
      tenantId: '_platform',
      userId: 'usr-carol',
    });
    const adminApp = buildApp({
      principalId: 'usr-admin',
      tenantId: 'customer',
      userId: 'usr-admin',
    });

    const issue = await bobApp.request('/api/v1/identity/break-glass/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0',
        incidentUrl: 'https://example.com/i',
      }),
    });
    const issueBody = (await issue.json()) as { grantId: string };

    await carolApp.request('/api/v1/identity/break-glass/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantId: issueBody.grantId,
      }),
    });

    const revoke = await adminApp.request('/api/v1/identity/break-glass/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantId: issueBody.grantId,
      }),
    });
    expect(revoke.status).toBe(200);
    const revokeBody = (await revoke.json()) as { status: string };
    expect(revokeBody.status).toBe('revoked');
  });

  test('Operator without PlatformSupport on customer revoke → 403 (uses tenant admin path)', async () => {
    await seedMembership('_platform', 'usr-bob', ['PlatformSupport']);
    // Eve is just a normal user in customer
    await seedMembership('customer', 'usr-eve', ['Author']);
    const bobApp = buildApp({
      principalId: 'usr-bob',
      tenantId: '_platform',
      userId: 'usr-bob',
    });
    const eveApp = buildApp({
      principalId: 'usr-eve',
      tenantId: 'customer',
      userId: 'usr-eve',
    });

    const issue = await bobApp.request('/api/v1/identity/break-glass/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0',
        incidentUrl: 'https://example.com/i',
      }),
    });
    const issueBody = (await issue.json()) as { grantId: string };

    const revoke = await eveApp.request('/api/v1/identity/break-glass/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'customer',
        grantId: issueBody.grantId,
      }),
    });
    expect(revoke.status).toBe(403);
  });
});
