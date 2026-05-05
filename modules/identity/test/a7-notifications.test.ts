/**
 * Phase A7 — Notifications dispatcher tests.
 *
 * Covers `emitNotificationsForA7Event` + `identityNotificationDispatcher`:
 *   - default channel fan-out per source event type
 *   - retention tag inheritance (7y impersonation, 10y break-glass)
 *   - deterministic idempotency-key shape (`notif.<sourceEventId>.<channel>`)
 *   - source-event causation linking
 *   - no-op for non-A7 events and for `Action`-shaped events
 *   - audit-metadata-only payloads (no plaintext token / hash leaks)
 */

import { describe, it, expect } from 'vitest';
import type {
  EventStore,
  StoredEvent,
} from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import {
  BREAK_GLASS_RETENTION_TAG,
  IMPERSONATION_RETENTION_TAG,
  emitNotificationsForA7Event,
  handleBreakGlassIssue,
  handleImpersonationEnd,
  handleImpersonationStart,
  identityNotificationDispatcher,
} from '../src/index.ts';
import type {
  Entity,
  EntityListOptions,
  EntityQueryOptions,
  EntityStore as PortEntityStore,
  EntityWriteInput,
} from '@atlas/ports';

// ---------------------------------------------------------------------
// Fixtures (mirroring a7-acceptance.test.ts)
// ---------------------------------------------------------------------

class InMemoryEventStore implements EventStore {
  events: EventEnvelope[] = [];
  private nextSeq = 0n;
  async append(envelope: EventEnvelope): Promise<StoredEvent> {
    const existing = this.events.find(
      (e) =>
        e.tenantId === envelope.tenantId &&
        e.idempotencyKey === envelope.idempotencyKey,
    );
    if (existing) {
      return existing as StoredEvent;
    }
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

class InMemoryEntityStore implements PortEntityStore {
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

interface Fx {
  events: InMemoryEventStore;
  entities: InMemoryEntityStore;
  tenantId: string;
}
function fx(): Fx {
  return {
    events: new InMemoryEventStore(),
    entities: new InMemoryEntityStore(),
    tenantId: 'customer',
  };
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe('a7-notifications: ImpersonationStarted', () => {
  it('emits 2 follow-ups (tenant_admin + ops_pager) at retention:7y', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'SUP-1234',
        ticketUrl: 'https://example.com/SUP-1234',
      },
      f.events,
      f.entities,
    );
    const followups = await emitNotificationsForA7Event(
      start.envelope,
      f.events,
    );
    expect(followups).toHaveLength(2);
    const channels = followups.map((e) => (e.payload as { channel: string }).channel);
    expect(channels).toEqual(['tenant_admin', 'ops_pager']);
    for (const e of followups) {
      expect(e.eventType).toBe('Notifications.ImpersonationStarted');
      expect(e.retentionTag).toBe(IMPERSONATION_RETENTION_TAG);
      expect(e.retentionTag).toBe('retention:7y');
      expect(e.causationId).toBe(start.envelope.eventId);
      expect(e.correlationId).toBe(start.envelope.correlationId);
      expect(e.tenantId).toBe(f.tenantId);
    }
  });
});

describe('a7-notifications: ImpersonationEnded reason=tenant_revoked', () => {
  it('emits to tenant_admin AND ops_pager (out-of-band ops notification)', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      },
      f.events,
      f.entities,
    );
    const end = await handleImpersonationEnd(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-2',
        impersonationId: start.document.impersonationId,
        principalId: 'usr-tenant-admin',
        reason: 'tenant_revoked',
      },
      f.events,
      f.entities,
    );
    const followups = await emitNotificationsForA7Event(end.envelope, f.events);
    const channels = followups.map((e) => (e.payload as { channel: string }).channel);
    expect(channels).toContain('tenant_admin');
    expect(channels).toContain('ops_pager');
    expect(followups).toHaveLength(2);
  });

  it('emits only to tenant_admin on operator_ended (no ops fan-out)', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      },
      f.events,
      f.entities,
    );
    const end = await handleImpersonationEnd(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-2',
        impersonationId: start.document.impersonationId,
        principalId: 'ops:bob',
        reason: 'operator_ended',
      },
      f.events,
      f.entities,
    );
    const followups = await emitNotificationsForA7Event(end.envelope, f.events);
    expect(followups).toHaveLength(1);
    expect((followups[0]!.payload as { channel: string }).channel).toBe('tenant_admin');
  });
});

describe('a7-notifications: BreakGlassIssued', () => {
  it('emits 2 follow-ups (tenant_admin + security_pager) at retention:10y', async () => {
    const f = fx();
    const issued = await handleBreakGlassIssue(
      {
        tenantId: 'ledger',
        correlationId: 'corr-1',
        issuedBy: 'ops:bob',
        grantedTo: 'ops:bob',
        grantedRoles: ['TenantAdmin'],
        justification: 'INC-9001',
        incidentUrl: 'https://example.com/INC-9001',
      },
      f.events,
      f.entities,
    );
    const followups = await emitNotificationsForA7Event(
      issued.envelope,
      f.events,
    );
    expect(followups).toHaveLength(2);
    const channels = followups.map((e) => (e.payload as { channel: string }).channel);
    expect(channels).toEqual(['tenant_admin', 'security_pager']);
    for (const e of followups) {
      expect(e.eventType).toBe('Notifications.BreakGlassIssued');
      expect(e.retentionTag).toBe(BREAK_GLASS_RETENTION_TAG);
      expect(e.retentionTag).toBe('retention:10y');
      expect(e.causationId).toBe(issued.envelope.eventId);
    }
  });
});

describe('a7-notifications: non-A7 events are ignored', () => {
  it('returns empty array for an unrelated event type', async () => {
    const f = fx();
    const fake: EventEnvelope = {
      eventId: 'evt-unrelated',
      eventType: 'Identity.UserCreated',
      schemaId: 'domain.identity.user_created.v1',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      tenantId: f.tenantId,
      correlationId: 'corr-1',
      idempotencyKey: 'identity.user.create.usr-x',
      causationId: null,
      principalId: 'sys',
      userId: 'usr-x',
      payload: { document: { userId: 'usr-x' } },
    };
    const followups = await emitNotificationsForA7Event(fake, f.events);
    expect(followups).toHaveLength(0);
  });

  it('returns empty array for Action-shaped A7 events (too noisy)', async () => {
    const f = fx();
    const action: EventEnvelope = {
      eventId: 'evt-action',
      eventType: 'Authorization.ImpersonationAction',
      schemaId: 'domain.authorization.impersonation_action.v1',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      tenantId: f.tenantId,
      correlationId: 'corr-1',
      idempotencyKey: 'authz.impersonation.action.x.y',
      causationId: null,
      principalId: 'ops:bob',
      userId: 'usr-alice',
      retentionTag: IMPERSONATION_RETENTION_TAG,
      payload: { actionId: 'ContentPages.Page.Update' },
    };
    const followups = await emitNotificationsForA7Event(action, f.events);
    expect(followups).toHaveLength(0);
  });
});

describe('a7-notifications: idempotency-key shape', () => {
  it('emits keys of the form notif.<sourceEventId>.<channel>', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      },
      f.events,
      f.entities,
    );
    const followups = await emitNotificationsForA7Event(start.envelope, f.events);
    expect(followups).toHaveLength(2);
    const keys = followups.map((e) => e.idempotencyKey).sort();
    expect(keys).toEqual(
      [
        `notif.${start.envelope.eventId}.ops_pager`,
        `notif.${start.envelope.eventId}.tenant_admin`,
      ].sort(),
    );
  });

  it('respects channel override via opts.channels', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      },
      f.events,
      f.entities,
    );
    const followups = await emitNotificationsForA7Event(
      start.envelope,
      f.events,
      { channels: ['security_pager'] },
    );
    expect(followups).toHaveLength(1);
    expect((followups[0]!.payload as { channel: string }).channel).toBe('security_pager');
  });
});

describe('a7-notifications: payload secrecy', () => {
  it('never leaks plaintext bearer / token / tokenHash / tokenLookup into payloads', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      },
      f.events,
      f.entities,
    );
    const plaintext = start.plaintextToken;
    const bearer = start.bearerToken;
    const tokenHash = start.document.tokenHash;
    const tokenLookup = start.document.tokenLookup;
    expect(plaintext.length).toBeGreaterThan(0);
    expect(bearer.length).toBeGreaterThan(0);

    const followups = await emitNotificationsForA7Event(start.envelope, f.events);
    for (const e of followups) {
      const json = JSON.stringify(e.payload);
      expect(json).not.toContain(plaintext);
      expect(json).not.toContain(bearer);
      expect(json).not.toContain(tokenHash);
      expect(json).not.toContain(tokenLookup);
      // Spot-check: no field literally named token-something.
      const payload = e.payload as Record<string, unknown>;
      expect(payload['tokenHash']).toBeUndefined();
      expect(payload['tokenLookup']).toBeUndefined();
      expect(payload['plaintextToken']).toBeUndefined();
      expect(payload['bearerToken']).toBeUndefined();
    }
  });
});

describe('a7-notifications: identityNotificationDispatcher', () => {
  it('appends follow-ups when invoked as a dispatcher closure', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      },
      f.events,
      f.entities,
    );
    const dispatch = identityNotificationDispatcher(f.events);
    await dispatch(start.envelope);
    const notifEvents = f.events.events.filter((e) =>
      e.eventType.startsWith('Notifications.'),
    );
    expect(notifEvents).toHaveLength(2);
  });

  it('is a no-op for non-A7 events', async () => {
    const f = fx();
    const dispatch = identityNotificationDispatcher(f.events);
    const fake: EventEnvelope = {
      eventId: 'evt-unrelated',
      eventType: 'Identity.UserCreated',
      schemaId: 'domain.identity.user_created.v1',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      tenantId: f.tenantId,
      correlationId: 'corr-1',
      idempotencyKey: 'identity.user.create.usr-x',
      causationId: null,
      principalId: 'sys',
      userId: 'usr-x',
      payload: { document: { userId: 'usr-x' } },
    };
    await dispatch(fake);
    expect(f.events.events).toHaveLength(0);
  });
});
