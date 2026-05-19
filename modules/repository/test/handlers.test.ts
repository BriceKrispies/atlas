/**
 * Repository handler unit tests. Covers the acceptance contract from the
 * `upload-tarball` capability spec:
 *
 *   - Repository.Create > emits Repository.Created with cacheInvalidationTags
 *   - Repository.Create > idempotent on (tenantId, repoSlug)
 *   - Repository.Upload > emits Repository.Uploaded with Revision: tag
 *   - Repository.Upload > rejects payload over 10 MB (UPLOAD_TOO_LARGE)
 *   - Repository.Upload > rejects when contentHash mismatches
 *   - Repository.Upload > rejects when repo does not exist (REPO_NOT_FOUND)
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes as nodeRandomBytes, scryptSync, timingSafeEqual as nodeTimingSafeEqual, } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { describe, it, expect } from 'vitest';
import type { EventEnvelope } from '@atlas/platform-core';
import { sha256Hex } from '@atlas/platform-core';
import type { Crypto, EventStore, RepositoryRecord, RepositoryRevisionStore, RepositoryStore, RevisionRecord, StoredEvent, } from '@atlas/ports';
function toPlain(buf: Buffer): Uint8Array {
    const out = new Uint8Array(buf.length);
    out.set(buf);
    return out;
}
const testCrypto: Crypto = {
    randomBytes: function (n) {
        return toPlain(nodeRandomBytes(n));
    },
    sha256: function (input) {
        const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
        return toPlain(createHash('sha256').update(data).digest());
    },
    hmacSha1: function (key, msg) {
        return toPlain(createHmac('sha1', key).update(msg).digest());
    },
    aesGcmEncrypt: function (key, iv, plaintext) {
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return { ciphertext: toPlain(ct), tag: toPlain(cipher.getAuthTag()) };
    },
    aesGcmDecrypt: function (key, iv, ciphertext, tag) {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return toPlain(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
    },
    scrypt: function (password, salt, dkLen, params) {
        return toPlain(scryptSync(password, salt, dkLen, params));
    },
    timingSafeEqual: function (a, b) {
        return a.length === b.length && nodeTimingSafeEqual(a, b);
    },
};
import { handleRepositoryCreate, handleRepositoryUpload, RepositoryError, REPOSITORY_CREATED_EVENT_TYPE, REPOSITORY_UPLOADED_EVENT_TYPE, UPLOAD_BYTE_LIMIT, } from '../src/index.ts';
import { assertDefined } from '@atlas/test-fixtures/assert';
// --- in-memory ports -------------------------------------------------
class InMemoryEventStore implements EventStore {
    events: EventEnvelope[] = [];
    private nextSeq = 1n;
    async append(envelope: EventEnvelope): Promise<StoredEvent> {
        const existing = this.events.find(function (e) {
            return e.tenantId === envelope.tenantId &&
                e.idempotencyKey === envelope.idempotencyKey;
        });
        if (existing) {
            return { ...existing, seq: existing.seq ?? 0n } satisfies StoredEvent;
        }
        const stored: StoredEvent = { ...envelope, seq: this.nextSeq++ };
        this.events.push(stored);
        return stored;
    }
    async getEvent(eventId: string): Promise<EventEnvelope | null> {
        return this.events.find(function (e) {
            return e.eventId === eventId;
        }) ?? null;
    }
    async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<EventEnvelope | null> {
        return (this.events.find(function (e) {
            return e.tenantId === tenantId && e.idempotencyKey === idempotencyKey;
        }) ?? null);
    }
    async readEvents(tenantId: string): Promise<EventEnvelope[]> {
        return this.events
            .filter(function (e) {
            return e.tenantId === tenantId;
        })
            .map(function (e) {
            return ({ ...e });
        });
    }
}
class InMemoryRepositoryStore implements RepositoryStore {
    rows = new Map<string, RepositoryRecord>();
    private k(tenantId: string, repoId: string): string {
        return `${tenantId}::${repoId}`;
    }
    async getBySlug(tenantId: string, repoSlug: string): Promise<RepositoryRecord | null> {
        for (const [key, r] of this.rows) {
            if (key.startsWith(`${tenantId}::`) && r.repoSlug === repoSlug) {
                return { ...r };
            }
        }
        return null;
    }
    async get(tenantId: string, repoId: string): Promise<RepositoryRecord | null> {
        const r = this.rows.get(this.k(tenantId, repoId));
        return r ? { ...r } : null;
    }
    async list(tenantId: string): Promise<readonly RepositoryRecord[]> {
        const out: RepositoryRecord[] = [];
        for (const [key, r] of this.rows) {
            if (key.startsWith(`${tenantId}::`))
                out.push({ ...r });
        }
        return out;
    }
    async create(tenantId: string, input: {
        repoId: string;
        repoSlug: string;
        name: string;
        description?: string;
        createdBy: string;
    }): Promise<void> {
        const key = this.k(tenantId, input.repoId);
        if (this.rows.has(key)) {
            throw new Error(`repo ${input.repoId} already exists`);
        }
        // also enforce unique (tenantId, repoSlug)
        for (const [k, r] of this.rows) {
            if (k.startsWith(`${tenantId}::`) && r.repoSlug === input.repoSlug) {
                throw new Error(`repo slug ${input.repoSlug} already taken`);
            }
        }
        this.rows.set(key, {
            repoId: input.repoId,
            repoSlug: input.repoSlug,
            name: input.name,
            description: input.description ?? null,
            createdAt: new Date().toISOString(),
            createdBy: input.createdBy,
        });
    }
}
class InMemoryRepositoryRevisionStore implements RepositoryRevisionStore {
    metadata = new Map<string, RevisionRecord>();
    bytes = new Map<string, Uint8Array>();
    private k(tenantId: string, revisionId: string): string {
        return `${tenantId}::${revisionId}`;
    }
    async getMetadata(tenantId: string, revisionId: string): Promise<RevisionRecord | null> {
        const r = this.metadata.get(this.k(tenantId, revisionId));
        return r ? { ...r } : null;
    }
    async listForRepo(tenantId: string, repoId: string): Promise<readonly RevisionRecord[]> {
        const out: RevisionRecord[] = [];
        for (const [key, r] of this.metadata) {
            if (key.startsWith(`${tenantId}::`) && r.repoId === repoId)
                out.push({ ...r });
        }
        return out.sort(function (a, b) {
            return (a.pushedAt < b.pushedAt ? 1 : -1);
        });
    }
    async getBytes(tenantId: string, revisionId: string): Promise<Uint8Array | null> {
        const b = this.bytes.get(this.k(tenantId, revisionId));
        return b ? new Uint8Array(b) : null;
    }
    async append(tenantId: string, input: {
        revisionId: string;
        repoId: string;
        bytes: Uint8Array;
        byteCount: number;
        contentHash: string;
        pushedBy: string;
        correlationId: string;
    }): Promise<void> {
        const key = this.k(tenantId, input.revisionId);
        if (this.metadata.has(key)) {
            throw new Error(`revision ${input.revisionId} already exists`);
        }
        this.metadata.set(key, {
            revisionId: input.revisionId,
            repoId: input.repoId,
            byteCount: input.byteCount,
            contentHash: input.contentHash,
            pushedAt: new Date().toISOString(),
            pushedBy: input.pushedBy,
            correlationId: input.correlationId,
        });
        this.bytes.set(key, new Uint8Array(input.bytes));
    }
}
// --- helpers ---------------------------------------------------------
function makeBytes(byteCount: number, fill = 0x41): Uint8Array {
    const out = new Uint8Array(byteCount);
    out.fill(fill);
    return out;
}
interface Fixture {
    events: InMemoryEventStore;
    repositories: InMemoryRepositoryStore;
    revisions: InMemoryRepositoryRevisionStore;
}
function newFixture(): Fixture {
    return {
        events: new InMemoryEventStore(),
        repositories: new InMemoryRepositoryStore(),
        revisions: new InMemoryRepositoryRevisionStore(),
    };
}
// --- tests -----------------------------------------------------------
describe('handleRepositoryCreate', function () {
    it('emits Repository.Created with cacheInvalidationTags [Tenant:..., Repository:...]', async function () {
        const fx = newFixture();
        const result = await handleRepositoryCreate({
            tenantId: 'acme',
            correlationId: 'corr-1',
            principalId: 'user-1',
            repoSlug: 'hello-world',
            name: 'hello-world',
        }, fx.repositories, fx.events);
        expect(result.preexisting).toBe(false);
        const env = assertDefined(result.envelope, 'first Repository.Create must emit an envelope (preexisting=false)');
        expect(env.eventType).toBe(REPOSITORY_CREATED_EVENT_TYPE);
        expect(env.tenantId).toBe('acme');
        expect(env.principalId).toBe('user-1');
        expect(env.cacheInvalidationTags).toEqual([
            'Tenant:acme',
            `Repository:${result.repository.repoId}`,
        ]);
        expect(env.idempotencyKey).toBe('repository.create.acme.hello-world');
        const payload = env.payload;
        expect(payload.repoId).toBe(result.repository.repoId);
        expect(payload.repoSlug).toBe('hello-world');
        expect(payload.name).toBe('hello-world');
        expect(payload.description).toBeNull();
        expect(fx.events.events).toHaveLength(1);
        const stored = await fx.repositories.get('acme', result.repository.repoId);
        expect(stored?.repoSlug).toBe('hello-world');
    });
    it('idempotent on (tenantId, repoSlug): returns existing repoId, emits no new event', async function () {
        const fx = newFixture();
        const first = await handleRepositoryCreate({
            tenantId: 'acme',
            correlationId: 'corr-1',
            principalId: 'user-1',
            repoSlug: 'hello-world',
            name: 'hello-world',
        }, fx.repositories, fx.events);
        expect(first.preexisting).toBe(false);
        const second = await handleRepositoryCreate({
            tenantId: 'acme',
            correlationId: 'corr-2',
            principalId: 'user-2',
            repoSlug: 'hello-world',
            name: 'a different name',
        }, fx.repositories, fx.events);
        expect(second.preexisting).toBe(true);
        expect(second.envelope).toBeNull();
        expect(second.repository.repoId).toBe(first.repository.repoId);
        // Only the first call's event was appended.
        expect(fx.events.events).toHaveLength(1);
    });
    it('different tenants with the same slug get distinct repos', async function () {
        const fx = newFixture();
        const a = await handleRepositoryCreate({
            tenantId: 'acme',
            correlationId: 'corr-a',
            principalId: 'user-a',
            repoSlug: 'shared',
            name: 'shared',
        }, fx.repositories, fx.events);
        const b = await handleRepositoryCreate({
            tenantId: 'beta',
            correlationId: 'corr-b',
            principalId: 'user-b',
            repoSlug: 'shared',
            name: 'shared',
        }, fx.repositories, fx.events);
        expect(a.preexisting).toBe(false);
        expect(b.preexisting).toBe(false);
        expect(a.repository.repoId).not.toBe(b.repository.repoId);
        expect(fx.events.events).toHaveLength(2);
    });
});
describe('handleRepositoryUpload', function () {
    async function seedRepo(fx: Fixture, tenantId = 'acme', repoSlug = 'hello-world'): Promise<string> {
        const r = await handleRepositoryCreate({
            tenantId,
            correlationId: 'corr-seed',
            principalId: 'user-1',
            repoSlug,
            name: repoSlug,
        }, fx.repositories, fx.events);
        return r.repository.repoId;
    }
    it('emits Repository.Uploaded with cacheInvalidationTags including Revision:...', async function () {
        const fx = newFixture();
        const repoId = await seedRepo(fx);
        const bytes = makeBytes(1024, 0x7a);
        const contentHash = sha256Hex(bytes, testCrypto);
        const bytesBase64 = Buffer.from(bytes).toString('base64');
        const result = await handleRepositoryUpload({
            tenantId: 'acme',
            correlationId: 'corr-up',
            principalId: 'user-1',
            repoId,
            byteCount: bytes.byteLength,
            contentHash,
            bytesBase64,
        }, fx.repositories, fx.revisions, fx.events, testCrypto);
        const env = result.envelope;
        expect(env.eventType).toBe(REPOSITORY_UPLOADED_EVENT_TYPE);
        expect(env.tenantId).toBe('acme');
        expect(env.cacheInvalidationTags).toEqual([
            'Tenant:acme',
            `Repository:${repoId}`,
            `Revision:${result.revision.revisionId}`,
        ]);
        const payload = env.payload;
        expect(payload.repoId).toBe(repoId);
        expect(payload.revisionId).toBe(result.revision.revisionId);
        expect(payload.byteCount).toBe(bytes.byteLength);
        expect(payload.contentHash).toBe(contentHash);
        expect(payload.pushedBy).toBe('user-1');
        // Bytes round-trip through the revision store.
        const stored = assertDefined(await fx.revisions.getBytes('acme', result.revision.revisionId), `revision bytes must be persisted for ${result.revision.revisionId}`);
        expect(stored.byteLength).toBe(bytes.byteLength);
        expect(sha256Hex(stored, testCrypto)).toBe(contentHash);
    });
    it('rejects payload over 10 MB with code UPLOAD_TOO_LARGE', async function () {
        const fx = newFixture();
        const repoId = await seedRepo(fx);
        const oversize = UPLOAD_BYTE_LIMIT + 1;
        // Don't actually allocate 10 MB+ of bytes; the byteCount check fires
        // before decoding so an empty bytesBase64 is fine.
        await expect(handleRepositoryUpload({
            tenantId: 'acme',
            correlationId: 'corr-up',
            principalId: 'user-1',
            repoId,
            byteCount: oversize,
            contentHash: 'deadbeef',
            bytesBase64: '',
        }, fx.repositories, fx.revisions, fx.events, testCrypto)).rejects.toMatchObject({
            name: 'RepositoryError',
            code: 'UPLOAD_TOO_LARGE',
            status: 413,
        });
    });
    it('rejects when contentHash mismatches the decoded bytes (CONTENT_HASH_MISMATCH)', async function () {
        const fx = newFixture();
        const repoId = await seedRepo(fx);
        const bytes = makeBytes(64, 0x55);
        const bytesBase64 = Buffer.from(bytes).toString('base64');
        // Wrong hash on purpose.
        const wrongHash = '0'.repeat(64);
        await expect(handleRepositoryUpload({
            tenantId: 'acme',
            correlationId: 'corr-up',
            principalId: 'user-1',
            repoId,
            byteCount: bytes.byteLength,
            contentHash: wrongHash,
            bytesBase64,
        }, fx.repositories, fx.revisions, fx.events, testCrypto)).rejects.toMatchObject({
            name: 'RepositoryError',
            code: 'CONTENT_HASH_MISMATCH',
            status: 400,
        });
        // No event was appended.
        const uploadedEvents = fx.events.events.filter(function (e) {
            return e.eventType === REPOSITORY_UPLOADED_EVENT_TYPE;
        });
        expect(uploadedEvents).toHaveLength(0);
    });
    it('rejects when repo does not exist (REPO_NOT_FOUND)', async function () {
        const fx = newFixture();
        const bytes = makeBytes(8, 0x10);
        const bytesBase64 = Buffer.from(bytes).toString('base64');
        const contentHash = sha256Hex(bytes, testCrypto);
        await expect(handleRepositoryUpload({
            tenantId: 'acme',
            correlationId: 'corr-up',
            principalId: 'user-1',
            repoId: 'repo-does-not-exist',
            byteCount: bytes.byteLength,
            contentHash,
            bytesBase64,
        }, fx.repositories, fx.revisions, fx.events, testCrypto)).rejects.toMatchObject({
            name: 'RepositoryError',
            code: 'REPO_NOT_FOUND',
            status: 404,
        });
    });
    it('uses RepositoryError class instances (for catch + map)', async function () {
        const fx = newFixture();
        try {
            await handleRepositoryUpload({
                tenantId: 'acme',
                correlationId: 'corr-up',
                principalId: 'user-1',
                repoId: 'missing',
                byteCount: 0,
                contentHash: 'x',
                bytesBase64: '',
            }, fx.repositories, fx.revisions, fx.events, testCrypto);
            throw new Error('expected throw');
        }
        catch (e) {
            expect(e).toBeInstanceOf(RepositoryError);
        }
    });
});
