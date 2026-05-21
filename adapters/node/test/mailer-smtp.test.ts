/**
 * Unit tests for `SmtpMailer`.
 *
 * The transport is faked rather than spun up against a real SMTP server.
 * `nodemailer.createTransport` is mocked at module load so the adapter
 * receives a `Transporter`-shaped stub whose `sendMail` and `close`
 * methods are `vi.fn()` spies. This keeps the suite hermetic — no
 * network, no smtp4dev container — while still exercising every code
 * path that observably depends on the transport (header construction,
 * messageId fallback, throw-on-rejection).
 *
 * The Postgres `Sql` is also faked: a tagged-template `vi.fn()` records
 * each invocation so the test can assert the exact column shape written
 * to `control_plane.email_log`. The adapter's `send` calls
 * `this.sql.json(tags)` so the fake exposes a `.json` helper that just
 * passes the value through (the real driver wraps it in a serializer
 * sentinel, but the tagged-template fake just records the values).
 */
import { describe, expect, it, vi, beforeEach } from '@atlas/test';
import type postgres from 'postgres';
import type { createTransport as RealCreateTransport } from 'nodemailer';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { EmailMessage } from '@atlas/ports';
import { SmtpMailer } from '../src/mailer-smtp.ts';
// Transport spies shared across the test suite. The `vi.mock`-on-nodemailer
// pattern (with `vi.hoisted` to share state across the factory + test bodies)
// only works under vitest; under node:test we instead inject the spies
// through the `SmtpMailer` constructor's transport-factory parameter.
const transportSpies = {
    sendMail: vi.fn(),
    close: vi.fn(),
};
// A `createTransport`-shaped factory that hands the adapter a transport whose
// methods are our spies. The cast funnels the spy bundle into nodemailer's
// `Transporter` shape — the adapter only consumes `sendMail`, so the
// remaining surface (verify, use, etc.) is intentionally absent.
const fakeTransportFactory = ((..._args: Parameters<typeof RealCreateTransport>) => ({
    sendMail: transportSpies.sendMail,
    close: transportSpies.close,
})) as unknown as typeof RealCreateTransport;
/** Constructs an SmtpMailer wired to the test transport spies. */
function makeMailer(sql: postgres.Sql, cfg: ConstructorParameters<typeof SmtpMailer>[1]): SmtpMailer {
    return new SmtpMailer(sql, cfg, undefined, fakeTransportFactory);
}
interface SqlCall {
    strings: TemplateStringsArray;
    values: unknown[];
}
/**
 * Build a tagged-template `vi.fn()` that records every call. The real
 * `postgres.Sql` is also a function; we mimic enough of the surface
 * (`(strings, ...values)` plus `.json(value)`) for the adapter's
 * INSERT to compile and run.
 *
 * Adapter calls `this.sql.json(row.tags)` — we record the original
 * array so column-shape assertions can read it back directly.
 *
 * The single boundary cast funnels `postgres.Sql`'s enormous callable
 * surface — too wide to faithfully reconstruct — into a fake the adapter
 * happily consumes.
 */
function fakeSql(): {
    sql: postgres.Sql;
    calls: SqlCall[];
} {
    const calls: SqlCall[] = [];
    const fn = vi.fn(function (strings: TemplateStringsArray, ...values: unknown[]) {
        calls.push({ strings, values });
        return Promise.resolve([]);
    });
    const withJson = Object.assign(fn, {
        json: function (v: unknown): unknown {
            return ({ __json: v });
        },
    });
    const sql = withJson as unknown as postgres.Sql;
    return { sql, calls };
}
interface SendMailArg {
    headers: Record<string, string>;
}
/**
 * Validate-and-narrow the first arg passed to the mocked `sendMail`. Throws
 * if the shape is wrong so a regression in the adapter fails the test
 * loudly rather than hiding behind a bare `as`.
 */
function lastSendMailArg(callIndex: number): SendMailArg {
    const call = assertDefined(transportSpies.sendMail.mock.calls[callIndex], `sendMail call ${String(callIndex)} recorded`);
    const arg: unknown = call[0];
    if (typeof arg !== 'object' || arg === null || !('headers' in arg)) {
        throw new Error(`Test invariant violation: sendMail arg missing "headers" property: ${JSON.stringify(arg)}`);
    }
    const headersRaw: unknown = (arg as {
        headers: unknown;
    }).headers;
    if (typeof headersRaw !== 'object' || headersRaw === null) {
        throw new Error('Test invariant violation: sendMail headers not an object');
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(headersRaw)) {
        if (typeof v === 'string')
            headers[k] = v;
    }
    return { headers };
}
const cfg = { host: 'smtp.example.test', port: 25, from: 'noreply@atlas.test' };
beforeEach(function () {
    transportSpies.sendMail.mockReset();
    transportSpies.close.mockReset();
});
function baseMsg(overrides: Partial<EmailMessage> = {}): EmailMessage {
    return {
        to: 'Recipient@Example.COM',
        subject: 'Welcome',
        body: 'Hello there',
        tenantId: 'tenant-1',
        correlationId: 'corr-abc',
        tags: ['magic-link'],
        ...overrides,
    };
}
describe('SmtpMailer', function () {
    it('writes to email_log with correct row shape', async function () {
        transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'smtp-id-123' });
        const { sql, calls } = fakeSql();
        const mailer = makeMailer(sql, cfg);
        const result = await mailer.send(baseMsg());
        expect(calls).toHaveLength(1);
        // Tagged-template values are positional in postgres.js; assert each
        // slot matches the INSERT column order in the adapter source.
        const v = assertDefined(calls[0], 'first sql call recorded').values;
        expect(v[0]).toBe('smtp-id-123'); // message_id
        expect(v[1]).toBe('recipient@example.com'); // to_address (lowercased)
        expect(v[2]).toBe('Welcome'); // subject
        expect(v[3]).toBe('Hello there'); // body
        expect(v[4]).toBe('tenant-1'); // tenant_id
        expect(v[5]).toBe('corr-abc'); // correlation_id
        // sent_at is an ISO timestamp produced by the adapter — just check shape.
        expect(v[6]).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
        expect(v[6]).toBe(result.sentAt);
        // tags are wrapped via sql.json(); fake passes through as { __json }.
        expect(v[7]).toEqual({ __json: ['magic-link'] });
    });
    it('returns SMTP-supplied messageId when present', async function () {
        transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'smtp-id-123' });
        const { sql, calls } = fakeSql();
        const mailer = makeMailer(sql, cfg);
        const result = await mailer.send(baseMsg());
        expect(result.messageId).toBe('smtp-id-123');
        expect(assertDefined(calls[0], 'first sql call recorded').values[0]).toBe('smtp-id-123');
    });
    it('falls back to locally-minted messageId when SMTP omits', async function () {
        transportSpies.sendMail.mockResolvedValueOnce({ messageId: undefined });
        const { sql, calls } = fakeSql();
        const mailer = makeMailer(sql, cfg);
        const result = await mailer.send(baseMsg());
        expect(result.messageId).toMatch(/^smtp-/);
        // Row insert MUST use the same id we returned — otherwise the read
        // side and the caller would disagree about what was sent.
        expect(assertDefined(calls[0], 'first sql call recorded').values[0]).toBe(result.messageId);
    });
    it('sets X-Atlas-Correlation-Id on the SMTP envelope', async function () {
        transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'm1' });
        const { sql } = fakeSql();
        const mailer = makeMailer(sql, cfg);
        await mailer.send(baseMsg({ correlationId: 'corr-xyz' }));
        const arg = lastSendMailArg(0);
        expect(arg.headers['X-Atlas-Correlation-Id']).toBe('corr-xyz');
    });
    it('sets X-Atlas-Tenant-Id when tenantId present, omits when null', async function () {
        transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'm1' });
        transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'm2' });
        const { sql } = fakeSql();
        const mailer = makeMailer(sql, cfg);
        await mailer.send(baseMsg({ tenantId: 'tenant-xyz' }));
        const argWith = lastSendMailArg(0);
        expect(argWith.headers['X-Atlas-Tenant-Id']).toBe('tenant-xyz');
        await mailer.send(baseMsg({ tenantId: null }));
        const argWithout = lastSendMailArg(1);
        expect(argWithout.headers).not.toHaveProperty('X-Atlas-Tenant-Id');
        // Correlation header must still be there regardless.
        expect(argWithout.headers['X-Atlas-Correlation-Id']).toBeDefined();
    });
    it('throws and skips email_log insert when SMTP rejects', async function () {
        transportSpies.sendMail.mockRejectedValueOnce(new Error('relay refused'));
        const { sql, calls } = fakeSql();
        const mailer = makeMailer(sql, cfg);
        await expect(mailer.send(baseMsg())).rejects.toThrow(/relay refused/);
        // No phantom row — the contract is "logged iff sent".
        expect(calls).toHaveLength(0);
    });
    it('defaults tags to [] when omitted on the EmailMessage', async function () {
        transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'm1' });
        const { sql, calls } = fakeSql();
        const mailer = makeMailer(sql, cfg);
        const msg: EmailMessage = {
            to: 'a@b.test',
            subject: 's',
            body: 'b',
            tenantId: null,
            correlationId: 'c',
            // no tags
        };
        await mailer.send(msg);
        expect(assertDefined(calls[0], 'first sql call recorded').values[7]).toEqual({ __json: [] });
    });
    it('close() invokes transport.close()', async function () {
        const { sql } = fakeSql();
        const mailer = makeMailer(sql, cfg);
        await mailer.close();
        expect(transportSpies.close).toHaveBeenCalledTimes(1);
    });
});
