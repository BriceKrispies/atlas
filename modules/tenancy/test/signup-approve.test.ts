/**
 * Unit tests for `handleSignupApprove`.
 *
 * Covers the choreography contract — tenant + custom-domain + invite +
 * mailer + audit-event ordering — using in-memory port stubs. The
 * route-supplied callbacks (issueInvite, ensureTenantProvisioned,
 * buildMagicLinkUrl, revokeOutstandingInvites) are spied so each test
 * asserts both shape and order.
 */

import { describe, it, expect } from 'vitest';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { EventEnvelope } from '@atlas/platform-core';
import type {
  CreateSignupRequestInput,
  CreateTenantInput,
  CustomDomain,
  CustomDomainStore,
  EmailMessage,
  EventStore,
  Mailer,
  MailerSendResult,
  SignupRequest,
  SignupRequestStatus,
  SignupRequestStore,
  StoredEvent,
  TenantRecord,
  TenantStore,
} from '@atlas/ports';
import { handleSignupApprove, type SignupApproveDeps } from '../src/handlers/signup-approve.ts';
import { TenancyError } from '../src/errors.ts';
import {
  TENANCY_SIGNUP_APPROVED_EVENT_TYPE,
  TENANCY_SIGNUP_APPROVED_SCHEMA_ID,
} from '../src/types.ts';

// --- in-memory ports -------------------------------------------------

class InMemorySignupRequestStore implements SignupRequestStore {
  rows = new Map<string, SignupRequest>();

  seed(row: SignupRequest): void {
    this.rows.set(row.signupId, { ...row });
  }

  async create(input: CreateSignupRequestInput): Promise<SignupRequest> {
    for (const r of this.rows.values()) {
      if (r.email === input.email && r.tenantSlug === input.tenantSlug) {
        return { ...r };
      }
    }
    const row: SignupRequest = {
      signupId: input.signupId,
      email: input.email,
      tenantSlug: input.tenantSlug,
      organizationName: input.organizationName,
      status: 'pending',
      approvedTenantId: null,
      deniedReason: null,
      correlationId: input.correlationId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(row.signupId, row);
    return { ...row };
  }

  async get(signupId: string): Promise<SignupRequest | null> {
    const r = this.rows.get(signupId);
    return r ? { ...r } : null;
  }

  async list(filter?: { status?: SignupRequestStatus; limit?: number }): Promise<SignupRequest[]> {
    const all = Array.from(this.rows.values()).filter((r) =>
      filter?.status ? r.status === filter.status : true,
    );
    return all.slice(0, filter?.limit ?? 50).map((r) => ({ ...r }));
  }

  async markApproved(signupId: string, tenantId: string): Promise<SignupRequest> {
    const row = this.rows.get(signupId);
    if (!row) throw new Error(`signup ${signupId} not found`);
    if (row.status !== 'pending') {
      throw new Error(`signup ${signupId} is ${row.status}, cannot approve`);
    }
    row.status = 'approved';
    row.approvedTenantId = tenantId;
    row.updatedAt = new Date().toISOString();
    return { ...row };
  }

  async markDenied(signupId: string, reason: string): Promise<SignupRequest> {
    const row = this.rows.get(signupId);
    if (!row) throw new Error(`signup ${signupId} not found`);
    row.status = 'denied';
    row.deniedReason = reason;
    row.updatedAt = new Date().toISOString();
    return { ...row };
  }
}

class InMemoryTenantStore implements TenantStore {
  rows = new Map<string, TenantRecord>();
  createCalls: CreateTenantInput[] = [];

  async create(input: CreateTenantInput): Promise<TenantRecord> {
    if (this.rows.has(input.tenantId)) {
      throw new Error(`tenant ${input.tenantId} already exists`);
    }
    this.createCalls.push({ ...input });
    const row: TenantRecord = {
      tenantId: input.tenantId,
      name: input.name,
      status: input.status ?? 'active',
      region: input.region ?? null,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(row.tenantId, row);
    return { ...row };
  }

  async get(tenantId: string): Promise<TenantRecord | null> {
    const r = this.rows.get(tenantId);
    return r ? { ...r } : null;
  }
}

class InMemoryCustomDomainStore implements CustomDomainStore {
  byHostname = new Map<string, CustomDomain>();
  addCalls: { hostname: string; tenantId: string; isPrimary: boolean }[] = [];

  async getByHostname(hostname: string): Promise<CustomDomain | null> {
    const r = this.byHostname.get(hostname);
    return r ? { ...r } : null;
  }

  async getPrimary(tenantId: string): Promise<CustomDomain | null> {
    for (const r of this.byHostname.values()) {
      if (r.tenantId === tenantId && r.isPrimary && r.status === 'active') return { ...r };
    }
    return null;
  }

  async list(tenantId: string): Promise<CustomDomain[]> {
    return Array.from(this.byHostname.values())
      .filter((r) => r.tenantId === tenantId)
      .map((r) => ({ ...r }));
  }

  async add(input: { hostname: string; tenantId: string; isPrimary: boolean }): Promise<CustomDomain> {
    this.addCalls.push({ ...input });
    const row: CustomDomain = {
      hostname: input.hostname,
      tenantId: input.tenantId,
      status: 'active',
      isPrimary: input.isPrimary,
      createdAt: new Date().toISOString(),
    };
    this.byHostname.set(row.hostname, row);
    return { ...row };
  }

  async disable(hostname: string): Promise<void> {
    const r = this.byHostname.get(hostname);
    if (r) r.status = 'disabled';
  }
}

class MailerSpy implements Mailer {
  sends: EmailMessage[] = [];
  shouldThrow = false;

  async send(msg: EmailMessage): Promise<MailerSendResult> {
    if (this.shouldThrow) {
      throw new Error('smtp-down');
    }
    this.sends.push({ ...msg });
    return {
      messageId: `msg-${this.sends.length}`,
      sentAt: new Date().toISOString(),
    };
  }
}

class InMemoryEventStore implements EventStore {
  events: EventEnvelope[] = [];
  private nextSeq = 1n;

  async append(envelope: EventEnvelope): Promise<StoredEvent> {
    // Idempotency on (tenantId, idempotencyKey) — mirrors the real
    // adapter so retries don't double-append.
    const existing = this.events.find(
      (e) => e.tenantId === envelope.tenantId && e.idempotencyKey === envelope.idempotencyKey,
    );
    if (existing) {
      return { ...existing, seq: existing.seq ?? 0n } satisfies StoredEvent;
    }
    const stored: StoredEvent = { ...envelope, seq: this.nextSeq++ };
    this.events.push(stored);
    return stored;
  }

  async getEvent(eventId: string): Promise<EventEnvelope | null> {
    return this.events.find((e) => e.eventId === eventId) ?? null;
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<EventEnvelope | null> {
    return (
      this.events.find(
        (e) => e.tenantId === tenantId && e.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async readEvents(tenantId: string): Promise<EventEnvelope[]> {
    return this.events.filter((e) => e.tenantId === tenantId).map((e) => ({ ...e }));
  }
}

// --- harness ---------------------------------------------------------

interface Harness {
  signupRequests: InMemorySignupRequestStore;
  tenants: InMemoryTenantStore;
  customDomains: InMemoryCustomDomainStore;
  mailer: MailerSpy;
  eventStore: InMemoryEventStore;
  // recorded callback invocations
  ensureProvisionedCalls: string[];
  revokeCalls: { tenantId: string; email: string; correlationId: string }[];
  issueInviteCalls: { tenantId: string; email: string; correlationId: string }[];
  // ordered log of which side-effects happened, for ordering assertions
  callOrder: string[];
  // index into mocked plaintext tokens; one fresh value per issueInvite
  mintCount: number;
  deps: SignupApproveDeps;
}

function buildHarness(): Harness {
  const signupRequests = new InMemorySignupRequestStore();
  const tenants = new InMemoryTenantStore();
  const customDomains = new InMemoryCustomDomainStore();
  const mailer = new MailerSpy();
  const eventStore = new InMemoryEventStore();
  const ensureProvisionedCalls: string[] = [];
  const revokeCalls: { tenantId: string; email: string; correlationId: string }[] = [];
  const issueInviteCalls: { tenantId: string; email: string; correlationId: string }[] = [];
  const callOrder: string[] = [];
  // Boxed counter so the issueInvite closure can mutate it without
  // needing a reference to the Harness object (avoids the
  // construct-then-assign tangle that earlier versions resolved with an
  // `undefined as unknown as SignupApproveDeps` placeholder).
  const mintCounter = { count: 0 };

  // Wrap markApproved to record order
  const origMark = signupRequests.markApproved.bind(signupRequests);
  signupRequests.markApproved = async (signupId, tenantId) => {
    callOrder.push('markApproved');
    return origMark(signupId, tenantId);
  };

  // Wrap mailer.send to record order
  const origSend = mailer.send.bind(mailer);
  mailer.send = async (msg) => {
    callOrder.push('mailer.send');
    return origSend(msg);
  };

  // Wrap eventStore.append to record order
  const origAppend = eventStore.append.bind(eventStore);
  eventStore.append = async (env) => {
    callOrder.push(`event.append:${env.eventType}`);
    return origAppend(env);
  };

  const deps: SignupApproveDeps = {
    signupRequests,
    tenants,
    customDomains,
    mailer,
    appendEvent: async (env) => {
      await eventStore.append(env);
    },
    apexDomain: 'localhost',
    ensureTenantProvisioned: async (tenantId: string) => {
      callOrder.push('ensureTenantProvisioned');
      ensureProvisionedCalls.push(tenantId);
    },
    revokeOutstandingInvites: async (input) => {
      callOrder.push('revokeOutstandingInvites');
      revokeCalls.push({ ...input });
    },
    issueInvite: async (input) => {
      callOrder.push('issueInvite');
      issueInviteCalls.push({ ...input });
      mintCounter.count += 1;
      return { plaintextToken: `tok-${mintCounter.count}` };
    },
    buildMagicLinkUrl: ({ presentedToken, hostname, acceptedEmail }) =>
      `http://${hostname}/signup/confirm?token=${presentedToken}&email=${encodeURIComponent(acceptedEmail)}`,
  };

  return {
    signupRequests,
    tenants,
    customDomains,
    mailer,
    eventStore,
    ensureProvisionedCalls,
    revokeCalls,
    issueInviteCalls,
    callOrder,
    get mintCount() {
      return mintCounter.count;
    },
    deps,
  };
}

function seedPendingSignup(h: Harness): SignupRequest {
  const row: SignupRequest = {
    signupId: 'signup-abc',
    email: 'admin@acme.test',
    tenantSlug: 'acme',
    organizationName: 'Acme Inc',
    status: 'pending',
    approvedTenantId: null,
    deniedReason: null,
    correlationId: 'corr-original',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  h.signupRequests.seed(row);
  return row;
}

// --- tests -----------------------------------------------------------

describe('handleSignupApprove', () => {
  it('happy path: provisions tenant, mints invite, sends email, marks approved, emits audit event', async () => {
    const h = buildHarness();
    seedPendingSignup(h);

    const result = await handleSignupApprove(
      { signupId: 'signup-abc', principalId: 'user-admin', correlationId: 'corr-1' },
      h.deps,
    );

    // tenant.create called with the right args
    expect(h.tenants.createCalls).toEqual([
      { tenantId: 'acme', name: 'Acme Inc', status: 'active' },
    ]);

    // customDomains.add called with isPrimary: true
    expect(h.customDomains.addCalls).toEqual([
      { hostname: 'acme.localhost', tenantId: 'acme', isPrimary: true },
    ]);

    // ensureTenantProvisioned called once with the tenant id
    expect(h.ensureProvisionedCalls).toEqual(['acme']);

    // revokeOutstandingInvites called once before issueInvite
    expect(h.revokeCalls).toEqual([
      { tenantId: 'acme', email: 'admin@acme.test', correlationId: 'corr-1' },
    ]);

    // issueInvite called once with correct payload
    expect(h.issueInviteCalls).toEqual([
      { tenantId: 'acme', email: 'admin@acme.test', correlationId: 'corr-1' },
    ]);

    // mailer.send called once with the expected EmailMessage shape
    expect(h.mailer.sends).toHaveLength(1);
    const sent = assertDefined(
      h.mailer.sends[0],
      'mailer.sends asserted length === 1 immediately above',
    );
    expect(sent.to).toBe('admin@acme.test');
    expect(sent.subject).toContain('Acme Inc');
    expect(sent.body).toContain(result.magicLinkUrl);
    expect(sent.tenantId).toBe('acme');
    expect(sent.correlationId).toBe('corr-1');
    expect(sent.tags).toEqual(['magic-link', 'signup-approved']);

    // markApproved happened AFTER mailer.send
    const mailerIdx = h.callOrder.indexOf('mailer.send');
    const markIdx = h.callOrder.indexOf('markApproved');
    expect(mailerIdx).toBeGreaterThanOrEqual(0);
    expect(markIdx).toBeGreaterThan(mailerIdx);

    // revoke happened BEFORE issueInvite (I3 fix)
    const revokeIdx = h.callOrder.indexOf('revokeOutstandingInvites');
    const mintIdx = h.callOrder.indexOf('issueInvite');
    expect(revokeIdx).toBeGreaterThanOrEqual(0);
    expect(mintIdx).toBeGreaterThan(revokeIdx);

    // Tenancy.SignupApproved event appended with right tags + payload
    expect(h.eventStore.events).toHaveLength(1);
    const evt = assertDefined(
      h.eventStore.events[0],
      'eventStore.events asserted length === 1 immediately above',
    );
    expect(evt.eventType).toBe(TENANCY_SIGNUP_APPROVED_EVENT_TYPE);
    expect(evt.schemaId).toBe(TENANCY_SIGNUP_APPROVED_SCHEMA_ID);
    expect(evt.tenantId).toBe('acme');
    expect(evt.correlationId).toBe('corr-1');
    expect(evt.principalId).toBe('user-admin');
    expect(evt.cacheInvalidationTags).toEqual([
      'Tenant:acme',
      'Signup:signup-abc',
    ]);
    expect(evt.idempotencyKey).toBe('tenancy.signup.approve.signup-abc');
    expect(evt.payload).toMatchObject({
      signupId: 'signup-abc',
      tenantId: 'acme',
      hostname: 'acme.localhost',
      email: 'admin@acme.test',
      principalId: 'user-admin',
      organizationName: 'Acme Inc',
    });
    // Plaintext token MUST NOT be on the payload (secrets stay out of
    // event history).
    expect(JSON.stringify(evt.payload)).not.toContain('tok-');

    // Result shape sanity
    expect(result.signup.status).toBe('approved');
    expect(result.tenant.tenantId).toBe('acme');
    expect(result.hostname).toBe('acme.localhost');
    expect(result.magicLinkToken).toBe('tok-1');
    expect(result.magicLinkUrl).toContain('token=tok-1');
  });

  it('mailer rejection leaves the signup pending and propagates the error', async () => {
    const h = buildHarness();
    seedPendingSignup(h);
    h.mailer.shouldThrow = true;

    await expect(
      handleSignupApprove(
        { signupId: 'signup-abc', principalId: 'user-admin', correlationId: 'corr-2' },
        h.deps,
      ),
    ).rejects.toThrowError(/smtp-down/);

    // markApproved was never called
    expect(h.callOrder).not.toContain('markApproved');
    // and the signup is still pending
    const row = await h.signupRequests.get('signup-abc');
    expect(row?.status).toBe('pending');
    // and no audit event was appended (we only emit AFTER the row flips)
    expect(h.eventStore.events).toHaveLength(0);
  });

  it('idempotency on retry: revokes outstanding invites before minting a fresh one', async () => {
    // Simulate the failure-then-retry shape: first call mints + sends
    // but markApproved fails (DB blip), so the row stays pending and
    // the caller retries. The fix: each call calls
    // `revokeOutstandingInvites` BEFORE `issueInvite`, so the prior
    // token is dead by the time the second one is minted.

    const h = buildHarness();
    seedPendingSignup(h);

    // First attempt — break markApproved AFTER mailer.send.
    let breakMark = true;
    const realMark = h.signupRequests.markApproved.bind(h.signupRequests);
    h.signupRequests.markApproved = async (signupId, tenantId) => {
      h.callOrder.push('markApproved');
      if (breakMark) {
        throw new Error('db-blip');
      }
      return realMark(signupId, tenantId);
    };

    await expect(
      handleSignupApprove(
        { signupId: 'signup-abc', principalId: 'user-admin', correlationId: 'corr-3' },
        h.deps,
      ),
    ).rejects.toThrowError(/db-blip/);

    expect(h.issueInviteCalls).toHaveLength(1);
    expect(h.revokeCalls).toHaveLength(1);
    expect(h.mailer.sends).toHaveLength(1);

    // Second attempt — let markApproved succeed.
    breakMark = false;
    const result = await handleSignupApprove(
      { signupId: 'signup-abc', principalId: 'user-admin', correlationId: 'corr-3-retry' },
      h.deps,
    );

    // revokeOutstandingInvites was called a second time, BEFORE the
    // second mint.
    expect(h.revokeCalls).toHaveLength(2);
    expect(h.issueInviteCalls).toHaveLength(2);

    // The retry's revoke call ran before its mint (the order log is
    // shared across both attempts; check the second-attempt slice).
    const firstRetryRevoke = h.callOrder.lastIndexOf('revokeOutstandingInvites');
    const firstRetryMint = h.callOrder.lastIndexOf('issueInvite');
    expect(firstRetryRevoke).toBeGreaterThanOrEqual(0);
    expect(firstRetryMint).toBeGreaterThan(firstRetryRevoke);

    // Tenant create only ran once across both attempts (idempotent
    // load-or-create).
    expect(h.tenants.createCalls).toHaveLength(1);
    // Custom domain add only ran once for the same reason.
    expect(h.customDomains.addCalls).toHaveLength(1);

    // Audit event appended exactly once (only after a successful flip).
    expect(h.eventStore.events).toHaveLength(1);
    expect(result.signup.status).toBe('approved');
    expect(result.magicLinkToken).toBe('tok-2');
  });

  it('rejects with SIGNUP_NOT_PENDING when the row is already approved', async () => {
    const h = buildHarness();
    h.signupRequests.seed({
      signupId: 'signup-abc',
      email: 'admin@acme.test',
      tenantSlug: 'acme',
      organizationName: 'Acme Inc',
      status: 'approved',
      approvedTenantId: 'acme',
      deniedReason: null,
      correlationId: 'corr-orig',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await expect(
      handleSignupApprove(
        { signupId: 'signup-abc', principalId: 'user-admin', correlationId: 'corr-x' },
        h.deps,
      ),
    ).rejects.toMatchObject({
      name: 'TenancyError',
      code: 'SIGNUP_NOT_PENDING',
    });

    // Bonus: it must also be a TenancyError instance for routes to
    // catch + map.
    try {
      await handleSignupApprove(
        { signupId: 'signup-abc', principalId: 'user-admin', correlationId: 'corr-x' },
        h.deps,
      );
    } catch (e) {
      expect(e).toBeInstanceOf(TenancyError);
    }

    // No side-effects ran.
    expect(h.tenants.createCalls).toHaveLength(0);
    expect(h.issueInviteCalls).toHaveLength(0);
    expect(h.mailer.sends).toHaveLength(0);
    expect(h.eventStore.events).toHaveLength(0);
  });
});
