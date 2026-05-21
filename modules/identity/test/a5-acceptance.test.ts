/**
 * Phase A5 acceptance — MFA stack (partial).
 *
 * Covers @phase-a5 scenarios from `mfa-totp.feature` +
 * `mfa-recovery.feature` end-to-end. WebAuthn / Passkey scenarios
 * await the A5.4 + A5.5 slice.
 */
import { describe, it, expect } from '@atlas/test';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { EventStore, StoredEvent, Entity, EntityListOptions, EntityQueryOptions, EntityStore as PortEntityStore, EntityWriteInput, Relation, RelationStore, RelationWriteInput, } from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import { TestSecretStore } from './lib/fixtures.ts';
import { buildOtpauthUri, decryptSecret, dispatchIdentityEvent, encryptSecret, getAuthFactorEntity, generateTotpSecret, handleGenerateRecoveryCodes, handleRedeemRecoveryCode, handleRegenerateRecoveryCodes, handleTotpChallenge, handleTotpEnroll, hotp, identityErrorCodes, IdentityError, listRecoveryCodesForUser, type AuthFactorDocument, type TotpFactorAttrs, } from '../src/index.ts';
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
        return this.events.find(function (e) {
            return e.eventId === eventId;
        }) ?? null;
    }
    async findByIdempotencyKey(t: string, k: string): Promise<EventEnvelope | null> {
        return this.events.find(function (e) {
            return e.tenantId === t && e.idempotencyKey === k;
        }) ?? null;
    }
    async readEvents(): Promise<EventEnvelope[]> {
        return this.events.map(function (e) {
            return ({ ...e });
        });
    }
}
// Mirror of `a4-acceptance.test.ts`'s shim — same type-erasure boundary
// the port `EntityStore` exposes through its `<T = unknown>` generic.
// The disables are intentional: this is a test fixture, the rows are
// stored as `Entity<unknown>` at the substrate, and the read path
// narrows back to the caller-supplied `T`. The shared `lib/fixtures.ts`
// uses the same pattern.
class InMemoryEntityStore implements PortEntityStore {
    rows = new Map<string, Entity<unknown>>();
    private k(t: string, ty: string, id: string): string {
        return `${t}::${ty}::${id}`;
    }
    async get<T = unknown>(t: string, ty: string, id: string): Promise<Entity<T> | null> {
        const r = this.rows.get(this.k(t, ty, id));
        if (!r || r.status === 'deleted')
            return null;
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
        this.rows.set(key, row);
        return row;
    }
    async delete(t: string, ty: string, id: string): Promise<void> {
        const key = this.k(t, ty, id);
        const e = this.rows.get(key);
        if (e)
            this.rows.set(key, { ...e, status: 'deleted' });
    }
    async list<T = unknown>(t: string, ty: string, opts?: EntityListOptions): Promise<Entity<T>[]> {
        const desired = opts?.status === undefined ? 'active' : opts.status;
        const filtered = Array.from(this.rows.values())
            .filter(function (r) {
            return r.tenantId === t && r.entityType === ty;
        })
            .filter(function (r) {
            return (desired === null ? true : r.status === desired);
        });
        return filtered as Entity<T>[];
    }
    async query<T = unknown>(t: string, ty: string, opts: EntityQueryOptions): Promise<Entity<T>[]> {
        const all = Array.from(this.rows.values()).filter(function (r) {
            return r.tenantId === t && r.entityType === ty;
        });
        if (!opts.attrsEqual) {
            return all as Entity<T>[];
        }
        const preds = Object.entries(opts.attrsEqual);
        const matched = all.filter(function (row) {
            if (row.attrs == null || typeof row.attrs !== 'object')
                return false;
            const attrs = row.attrs as Record<string, unknown>;
            return preds.every(function ([k, v]) {
                return attrs[k] === v;
            });
        });
        return matched as Entity<T>[];
    }
}
// Same type-erasure boundary as `InMemoryEntityStore` — see comment above.
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
        this.rows.set(key, row);
        return row;
    }
    async remove(t: string, e: string, f: string, to: string): Promise<void> {
        this.rows.delete(this.k(t, e, f, to));
    }
    async outgoing<T = unknown>(t: string, e: string, f: string): Promise<Relation<T>[]> {
        const filtered = Array.from(this.rows.values()).filter(function (r) {
            return r.tenantId === t && r.edgeType === e && r.fromId === f;
        });
        return filtered as Relation<T>[];
    }
    async incoming<T = unknown>(t: string, e: string, to: string): Promise<Relation<T>[]> {
        const filtered = Array.from(this.rows.values()).filter(function (r) {
            return r.tenantId === t && r.edgeType === e && r.toId === to;
        });
        return filtered as Relation<T>[];
    }
}
interface Fx {
    events: InMemoryEventStore;
    entities: InMemoryEntityStore;
    relations: InMemoryRelationStore;
    secrets: TestSecretStore;
    tenantId: string;
}
function fx(): Fx {
    return {
        events: new InMemoryEventStore(),
        entities: new InMemoryEntityStore(),
        relations: new InMemoryRelationStore(),
        secrets: new TestSecretStore({
            IDENTITY_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        }),
        tenantId: 'sec',
    };
}
async function dispatchAll(f: Fx): Promise<void> {
    for (const e of f.events.events) {
        await dispatchIdentityEvent(e, { entities: f.entities, relations: f.relations });
    }
}
/**
 * Narrow a `AuthFactorDocument`'s discriminated `attrs` union to its
 * TOTP arm by `kind`. The substrate types `attrs` as the wide union
 * (`TotpFactorAttrs | WebAuthnFactorAttrs`) so a runtime `kind` check is
 * required to recover the per-arm shape — using a typed guard funnels
 * every test-side TOTP read through one checked boundary.
 */
function totpAttrs(doc: {
    kind: string;
    attrs: unknown;
}): TotpFactorAttrs {
    if (doc.kind !== 'totp') {
        throw new Error(`test invariant: expected totp factor, got ${doc.kind}`);
    }
    return doc.attrs as TotpFactorAttrs;
}
// =====================================================================
// TOTP crypto primitives
// =====================================================================
describe('crypto/totp: HOTP test vector', function () {
    it('matches RFC 4226 §5.3 reference for the canonical secret', function () {
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
describe('crypto/totp: secret encryption roundtrip', function () {
    const secrets = new TestSecretStore({
        IDENTITY_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    it('encryptSecret + decryptSecret recover the plaintext under the same tenant', function () {
        const secret = generateTotpSecret();
        const enc = encryptSecret(secret, 'sec', secrets);
        const dec = decryptSecret(enc, 'sec', secrets);
        expect(dec).toEqual(secret);
    });
    it('decrypting under a different tenant fails (AEAD)', function () {
        const secret = generateTotpSecret();
        const enc = encryptSecret(secret, 'tenant-a', secrets);
        expect(function () {
            return decryptSecret(enc, 'tenant-b', secrets);
        }).toThrow();
    });
});
// =====================================================================
// mfa-totp.feature
// =====================================================================
describe('mfa-totp.feature: enrollment + challenge', function () {
    it('Enroll mints an active factor, returns plaintext secret + otpauth URI ONCE', async function () {
        const f = fx();
        const result = await handleTotpEnroll({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'usr-alice',
            issuer: 'Atlas',
            accountLabel: 'alice@example.com',
            name: 'iPhone',
        }, f.events, f.secrets);
        await dispatchAll(f);
        expect(result.document.kind).toBe('totp');
        expect(result.document.status).toBe('active');
        expect(result.plaintextBase32).toMatch(/^[A-Z2-7]+$/);
        expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
        const stored = await getAuthFactorEntity(f.entities, f.tenantId, result.document.factorId);
        expect(stored?.kind).toBe('totp');
    });
    it('Challenge succeeds with a valid TOTP code; advances lastUsedCounter', async function () {
        const f = fx();
        const enroll = await handleTotpEnroll({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'usr-alice',
            issuer: 'Atlas',
            accountLabel: 'alice@example.com',
            name: 'iPhone',
        }, f.events, f.secrets);
        await dispatchAll(f);
        // Reach into the encrypted secret to compute the current code.
        const attrs = totpAttrs(enroll.document);
        const secret = decryptSecret(attrs.encryptedSecret, f.tenantId, f.secrets);
        const code = hotp(secret, Math.floor(Date.now() / 1000 / 30));
        const result = await handleTotpChallenge({
            tenantId: f.tenantId,
            correlationId: 'c2',
            principalId: 'usr-alice',
            factorId: enroll.document.factorId,
            presentedCode: code,
        }, f.events, f.entities, f.secrets);
        await dispatchAll(f);
        expect(result.envelope.eventType).toBe('Identity.MfaChallengeSucceeded');
        // I10 — MFA-success tags Tenant + User + Session.
        assertEventTags(result.envelope, [
            `Tenant:${f.tenantId}`,
            `User:${enroll.document.userId}`,
        ]);
        const stored = assertDefined(await getAuthFactorEntity(f.entities, f.tenantId, enroll.document.factorId), 'TOTP enrollment dispatched the factor onto the entity store');
        const sa = totpAttrs(stored);
        expect(sa.lastUsedCounter).toBeGreaterThan(0);
        expect(sa.failedAttempts).toBe(0);
    });
    it('Challenge with bad code throws TOTP_INVALID_CODE', async function () {
        const f = fx();
        const enroll = await handleTotpEnroll({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'usr-alice',
            issuer: 'Atlas',
            accountLabel: 'alice@example.com',
            name: 'iPhone',
        }, f.events, f.secrets);
        await dispatchAll(f);
        await expect(handleTotpChallenge({
            tenantId: f.tenantId,
            correlationId: 'c2',
            principalId: 'usr-alice',
            factorId: enroll.document.factorId,
            presentedCode: '000000',
        }, f.events, f.entities, f.secrets)).rejects.toMatchObject({ code: identityErrorCodes.TOTP_INVALID_CODE });
    });
    it('5 consecutive bad codes trip MFA_FACTOR_LOCKED', async function () {
        const f = fx();
        const enroll = await handleTotpEnroll({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'usr-alice',
            issuer: 'Atlas',
            accountLabel: 'alice@example.com',
            name: 'iPhone',
        }, f.events, f.secrets);
        await dispatchAll(f);
        let lastErr: unknown = null;
        for (let i = 0; i < 5; i += 1) {
            try {
                await handleTotpChallenge({
                    tenantId: f.tenantId,
                    correlationId: `c-${i}`,
                    principalId: 'usr-alice',
                    factorId: enroll.document.factorId,
                    presentedCode: '000000',
                }, f.events, f.entities, f.secrets);
            }
            catch (e) {
                lastErr = e;
            }
            await dispatchAll(f);
        }
        if (!(lastErr instanceof IdentityError)) {
            throw new Error(`expected IdentityError from challenge loop, got ${String(lastErr)}`);
        }
        expect(lastErr.code).toBe(identityErrorCodes.MFA_FACTOR_LOCKED);
        const stored = await getAuthFactorEntity(f.entities, f.tenantId, enroll.document.factorId);
        expect(stored?.status).toBe('locked');
        expect(stored?.lockedUntil).toBeTruthy();
    });
    it('otpauth URI shape contains issuer + account label', function () {
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
describe('mfa-recovery.feature: generate + redeem', function () {
    it('Generate mints 10 codes, returns plaintexts ONCE; subsequent generate refuses', async function () {
        const f = fx();
        const result = await handleGenerateRecoveryCodes({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'usr-alice',
        }, f.events, f.entities);
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
        await expect(handleGenerateRecoveryCodes({
            tenantId: f.tenantId,
            correlationId: 'c2',
            principalId: 'admin',
            userId: 'usr-alice',
        }, f.events, f.entities)).rejects.toMatchObject({ code: identityErrorCodes.RECOVERY_CODE_INVALID });
    });
    it('Redeem accepts a presented plaintext, flips that code to consumed', async function () {
        const f = fx();
        const gen = await handleGenerateRecoveryCodes({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'usr-alice',
        }, f.events, f.entities);
        await dispatchAll(f);
        const code = assertDefined(gen.plaintextCodes[0], 'generate mints 10 codes');
        const result = await handleRedeemRecoveryCode({
            tenantId: f.tenantId,
            correlationId: 'c2',
            principalId: 'usr-alice',
            userId: 'usr-alice',
            presentedCode: code,
        }, f.events, f.entities);
        await dispatchAll(f);
        expect(result.envelope.eventType).toBe('Identity.RecoveryCodeConsumed');
        expect(result.document.status).toBe('consumed');
        expect(result.remaining).toBe(9);
        // I10 — recovery-code consume tags Tenant + User.
        assertEventTags(result.envelope, [`Tenant:${f.tenantId}`, `User:usr-alice`]);
        // Reuse rejected.
        await expect(handleRedeemRecoveryCode({
            tenantId: f.tenantId,
            correlationId: 'c3',
            principalId: 'usr-alice',
            userId: 'usr-alice',
            presentedCode: code,
        }, f.events, f.entities)).rejects.toMatchObject({ code: identityErrorCodes.RECOVERY_CODE_INVALID });
    });
    it('Regenerate invalidates the prior batch', async function () {
        const f = fx();
        const gen = await handleGenerateRecoveryCodes({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'usr-alice',
        }, f.events, f.entities);
        await dispatchAll(f);
        await handleRegenerateRecoveryCodes({
            tenantId: f.tenantId,
            correlationId: 'c2',
            principalId: 'admin',
            userId: 'usr-alice',
        }, f.events, f.entities);
        await dispatchAll(f);
        const all = await listRecoveryCodesForUser(f.entities, f.tenantId, 'usr-alice');
        const firstDoc = assertDefined(gen.documents[0], 'generate mints 10 docs');
        const oldBatch = all.filter(function (c) {
            return c.batchId === firstDoc.batchId;
        });
        expect(oldBatch.every(function (c) {
            return c.status === 'invalidated';
        })).toBe(true);
        const newBatch = all.filter(function (c) {
            return c.status === 'active';
        });
        expect(newBatch.length).toBe(10);
        // Old plaintext no longer redeems.
        const oldCode = assertDefined(gen.plaintextCodes[0], 'generate mints 10 codes');
        await expect(handleRedeemRecoveryCode({
            tenantId: f.tenantId,
            correlationId: 'c3',
            principalId: 'usr-alice',
            userId: 'usr-alice',
            presentedCode: oldCode,
        }, f.events, f.entities)).rejects.toMatchObject({ code: identityErrorCodes.RECOVERY_CODE_INVALID });
    });
});
void Buffer; // ensure node Buffer import resolves cleanly for the helpers
type _F = AuthFactorDocument;
