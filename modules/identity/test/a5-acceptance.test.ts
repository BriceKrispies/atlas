/**
 * Phase A5 acceptance — MFA stack (partial).
 *
 * Covers @phase-a5 scenarios from `mfa-totp.feature` +
 * `mfa-recovery.feature` end-to-end. WebAuthn / Passkey scenarios
 * await the A5.4 + A5.5 slice.
 */

import { describe, it, expect } from 'vitest';
import type {
  EventStore,
  StoredEvent,
  Entity,
  EntityListOptions,
  EntityQueryOptions,
  EntityStore as PortEntityStore,
  EntityWriteInput,
  Relation,
  RelationStore,
  RelationWriteInput,
} from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import {
  buildOtpauthUri,
  decryptSecret,
  dispatchIdentityEvent,
  encryptSecret,
  getAuthFactorEntity,
  generateTotpSecret,
  handleGenerateRecoveryCodes,
  handleRedeemRecoveryCode,
  handleRegenerateRecoveryCodes,
  handleTotpChallenge,
  handleTotpEnroll,
  hotp,
  identityErrorCodes,
  IdentityError,
  listRecoveryCodesForUser,
  type AuthFactorDocument,
  type TotpFactorAttrs,
} from '../src/index.ts';
import { assertEventTags } from './lib/fixtures.ts';

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

interface Fx {
  events: InMemoryEventStore;
  entities: InMemoryEntityStore;
  relations: InMemoryRelationStore;
  tenantId: string;
}
function fx(): Fx {
  return {
    events: new InMemoryEventStore(),
    entities: new InMemoryEntityStore(),
    relations: new InMemoryRelationStore(),
    tenantId: 'sec',
  };
}
async function dispatchAll(f: Fx): Promise<void> {
  for (const e of f.events.events) {
    await dispatchIdentityEvent(e, { entities: f.entities, relations: f.relations });
  }
}

// =====================================================================
// TOTP crypto primitives
// =====================================================================

describe('crypto/totp: HOTP test vector', () => {
  it('matches RFC 4226 §5.3 reference for the canonical secret', () => {
    // RFC 4226 §5.3 — secret = ASCII "12345678901234567890",
    // counter 0..9 → known 6-digit codes.
    const secret = Buffer.from('12345678901234567890', 'utf8');
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    for (let c = 0; c < expected.length; c += 1) {
      expect(hotp(secret, c)).toBe(expected[c]);
    }
  });
});

describe('crypto/totp: secret encryption roundtrip', () => {
  it('encryptSecret + decryptSecret recover the plaintext under the same tenant', () => {
    const secret = generateTotpSecret();
    const enc = encryptSecret(secret, 'sec');
    const dec = decryptSecret(enc, 'sec');
    expect(dec.equals(secret)).toBe(true);
  });

  it('decrypting under a different tenant fails (AEAD)', () => {
    const secret = generateTotpSecret();
    const enc = encryptSecret(secret, 'tenant-a');
    expect(() => decryptSecret(enc, 'tenant-b')).toThrow();
  });
});

// =====================================================================
// mfa-totp.feature
// =====================================================================

describe('mfa-totp.feature: enrollment + challenge', () => {
  it('Enroll mints an active factor, returns plaintext secret + otpauth URI ONCE', async () => {
    const f = fx();
    const result = await handleTotpEnroll(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId: 'usr-alice',
        issuer: 'Atlas',
        accountLabel: 'alice@example.com',
        name: 'iPhone',
      },
      f.events,
    );
    await dispatchAll(f);
    expect(result.document.kind).toBe('totp');
    expect(result.document.status).toBe('active');
    expect(result.plaintextBase32).toMatch(/^[A-Z2-7]+$/);
    expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const stored = await getAuthFactorEntity(f.entities, f.tenantId, result.document.factorId);
    expect(stored?.kind).toBe('totp');
  });

  it('Challenge succeeds with a valid TOTP code; advances lastUsedCounter', async () => {
    const f = fx();
    const enroll = await handleTotpEnroll(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId: 'usr-alice',
        issuer: 'Atlas',
        accountLabel: 'alice@example.com',
        name: 'iPhone',
      },
      f.events,
    );
    await dispatchAll(f);
    // Reach into the encrypted secret to compute the current code.
    const attrs = enroll.document.attrs as TotpFactorAttrs;
    const secret = decryptSecret(attrs.encryptedSecret, f.tenantId);
    const code = hotp(secret, Math.floor(Date.now() / 1000 / 30));
    const result = await handleTotpChallenge(
      {
        tenantId: f.tenantId,
        correlationId: 'c2',
        principalId: 'usr-alice',
        factorId: enroll.document.factorId,
        presentedCode: code,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    expect(result.envelope.eventType).toBe('Identity.MfaChallengeSucceeded');
    // I10 — MFA-success tags Tenant + User + Session.
    assertEventTags(result.envelope, [
      `Tenant:${f.tenantId}`,
      `User:${enroll.document.userId}`,
    ]);
    const stored = await getAuthFactorEntity(f.entities, f.tenantId, enroll.document.factorId);
    const sa = stored?.attrs as TotpFactorAttrs;
    expect(sa.lastUsedCounter).toBeGreaterThan(0);
    expect(sa.failedAttempts).toBe(0);
  });

  it('Challenge with bad code throws TOTP_INVALID_CODE', async () => {
    const f = fx();
    const enroll = await handleTotpEnroll(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId: 'usr-alice',
        issuer: 'Atlas',
        accountLabel: 'alice@example.com',
        name: 'iPhone',
      },
      f.events,
    );
    await dispatchAll(f);
    await expect(
      handleTotpChallenge(
        {
          tenantId: f.tenantId,
          correlationId: 'c2',
          principalId: 'usr-alice',
          factorId: enroll.document.factorId,
          presentedCode: '000000',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.TOTP_INVALID_CODE });
  });

  it('5 consecutive bad codes trip MFA_FACTOR_LOCKED', async () => {
    const f = fx();
    const enroll = await handleTotpEnroll(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId: 'usr-alice',
        issuer: 'Atlas',
        accountLabel: 'alice@example.com',
        name: 'iPhone',
      },
      f.events,
    );
    await dispatchAll(f);
    let lastErr: unknown = null;
    for (let i = 0; i < 5; i += 1) {
      try {
        await handleTotpChallenge(
          {
            tenantId: f.tenantId,
            correlationId: `c-${i}`,
            principalId: 'usr-alice',
            factorId: enroll.document.factorId,
            presentedCode: '000000',
          },
          f.events,
          f.entities,
        );
      } catch (e) {
        lastErr = e;
      }
      await dispatchAll(f);
    }
    expect((lastErr as IdentityError).code).toBe(identityErrorCodes.MFA_FACTOR_LOCKED);
    const stored = await getAuthFactorEntity(f.entities, f.tenantId, enroll.document.factorId);
    expect(stored?.status).toBe('locked');
    expect(stored?.lockedUntil).toBeTruthy();
  });

  it('otpauth URI shape contains issuer + account label', () => {
    const uri = buildOtpauthUri({
      issuer: 'Atlas',
      accountLabel: 'alice@example.com',
      secret: Buffer.alloc(20, 1),
    });
    expect(uri).toContain('issuer=Atlas');
    expect(uri).toContain('alice%40example.com');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

// =====================================================================
// mfa-recovery.feature
// =====================================================================

describe('mfa-recovery.feature: generate + redeem', () => {
  it('Generate mints 10 codes, returns plaintexts ONCE; subsequent generate refuses', async () => {
    const f = fx();
    const result = await handleGenerateRecoveryCodes(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId: 'usr-alice',
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    expect(result.documents).toHaveLength(10);
    expect(result.plaintextCodes).toHaveLength(10);
    // Plaintexts unique.
    expect(new Set(result.plaintextCodes).size).toBe(10);
    // Hashes are SHA-256 hex (64 chars). High-entropy + short-lived
    // → KDF (Argon2id) is wasted; same hash pattern as InviteToken.
    for (const d of result.documents) {
      expect(d.codeHash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Subsequent generate refuses.
    await expect(
      handleGenerateRecoveryCodes(
        {
          tenantId: f.tenantId,
          correlationId: 'c2',
          principalId: 'admin',
          userId: 'usr-alice',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.RECOVERY_CODE_INVALID });
  });

  it('Redeem accepts a presented plaintext, flips that code to consumed', async () => {
    const f = fx();
    const gen = await handleGenerateRecoveryCodes(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId: 'usr-alice',
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const code = gen.plaintextCodes[0]!;
    const result = await handleRedeemRecoveryCode(
      {
        tenantId: f.tenantId,
        correlationId: 'c2',
        principalId: 'usr-alice',
        userId: 'usr-alice',
        presentedCode: code,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    expect(result.envelope.eventType).toBe('Identity.RecoveryCodeConsumed');
    expect(result.document.status).toBe('consumed');
    expect(result.remaining).toBe(9);
    // I10 — recovery-code consume tags Tenant + User.
    assertEventTags(result.envelope, [`Tenant:${f.tenantId}`, `User:usr-alice`]);
    // Reuse rejected.
    await expect(
      handleRedeemRecoveryCode(
        {
          tenantId: f.tenantId,
          correlationId: 'c3',
          principalId: 'usr-alice',
          userId: 'usr-alice',
          presentedCode: code,
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.RECOVERY_CODE_INVALID });
  });

  it('Regenerate invalidates the prior batch', async () => {
    const f = fx();
    const gen = await handleGenerateRecoveryCodes(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId: 'usr-alice',
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    await handleRegenerateRecoveryCodes(
      {
        tenantId: f.tenantId,
        correlationId: 'c2',
        principalId: 'admin',
        userId: 'usr-alice',
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const all = await listRecoveryCodesForUser(f.entities, f.tenantId, 'usr-alice');
    const oldBatch = all.filter((c) => c.batchId === gen.documents[0]!.batchId);
    expect(oldBatch.every((c) => c.status === 'invalidated')).toBe(true);
    const newBatch = all.filter((c) => c.status === 'active');
    expect(newBatch.length).toBe(10);
    // Old plaintext no longer redeems.
    await expect(
      handleRedeemRecoveryCode(
        {
          tenantId: f.tenantId,
          correlationId: 'c3',
          principalId: 'usr-alice',
          userId: 'usr-alice',
          presentedCode: gen.plaintextCodes[0]!,
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.RECOVERY_CODE_INVALID });
  });
});

void Buffer; // ensure node Buffer import resolves cleanly for the helpers
type _F = AuthFactorDocument;
