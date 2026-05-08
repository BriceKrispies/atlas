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

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { EmailMessage } from '@atlas/ports';

// Hoisted spies so the `vi.mock` factory below can reference them and
// the test bodies can assert against them. `vi.hoisted` is the official
// vitest escape-hatch for this exact pattern.
const transportSpies = vi.hoisted(() => ({
  sendMail: vi.fn(),
  close: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: transportSpies.sendMail,
    close: transportSpies.close,
  })),
}));

// Import AFTER the mock so the adapter sees the stubbed module.
const { SmtpMailer } = await import('../src/mailer-smtp.ts');

interface SqlCall {
  strings: TemplateStringsArray;
  values: unknown[];
}

/**
 * Build a tagged-template `vi.fn()` that records every call. The real
 * `postgres.Sql` is also a function; we mimic enough of the surface
 * (`(strings, ...values)` plus `.json(value)`) for the adapter's
 * INSERT to compile and run.
 */
function fakeSql() {
  const calls: SqlCall[] = [];
  const fn = vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ strings, values });
      return Promise.resolve([]);
    },
  );
  // Adapter calls `this.sql.json(row.tags)` — we record the original
  // array so column-shape assertions can read it back directly.
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => ({
    __json: v,
  });
  return { sql: fn, calls };
}

const cfg = { host: 'smtp.example.test', port: 25, from: 'noreply@atlas.test' };

beforeEach(() => {
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

describe('SmtpMailer', () => {
  it('writes to email_log with correct row shape', async () => {
    transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'smtp-id-123' });
    const { sql, calls } = fakeSql();
    const mailer = new SmtpMailer(sql as never, cfg);

    const result = await mailer.send(baseMsg());

    expect(calls).toHaveLength(1);
    // Tagged-template values are positional in postgres.js; assert each
    // slot matches the INSERT column order in the adapter source.
    const v = calls[0]!.values;
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

  it('returns SMTP-supplied messageId when present', async () => {
    transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'smtp-id-123' });
    const { sql, calls } = fakeSql();
    const mailer = new SmtpMailer(sql as never, cfg);

    const result = await mailer.send(baseMsg());

    expect(result.messageId).toBe('smtp-id-123');
    expect(calls[0]!.values[0]).toBe('smtp-id-123');
  });

  it('falls back to locally-minted messageId when SMTP omits', async () => {
    transportSpies.sendMail.mockResolvedValueOnce({ messageId: undefined });
    const { sql, calls } = fakeSql();
    const mailer = new SmtpMailer(sql as never, cfg);

    const result = await mailer.send(baseMsg());

    expect(result.messageId).toMatch(/^smtp-/);
    // Row insert MUST use the same id we returned — otherwise the read
    // side and the caller would disagree about what was sent.
    expect(calls[0]!.values[0]).toBe(result.messageId);
  });

  it('sets X-Atlas-Correlation-Id on the SMTP envelope', async () => {
    transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'm1' });
    const { sql } = fakeSql();
    const mailer = new SmtpMailer(sql as never, cfg);

    await mailer.send(baseMsg({ correlationId: 'corr-xyz' }));

    const arg = transportSpies.sendMail.mock.calls[0]![0] as {
      headers: Record<string, string>;
    };
    expect(arg.headers['X-Atlas-Correlation-Id']).toBe('corr-xyz');
  });

  it('sets X-Atlas-Tenant-Id when tenantId present, omits when null', async () => {
    transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'm1' });
    transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'm2' });
    const { sql } = fakeSql();
    const mailer = new SmtpMailer(sql as never, cfg);

    await mailer.send(baseMsg({ tenantId: 'tenant-xyz' }));
    const argWith = transportSpies.sendMail.mock.calls[0]![0] as {
      headers: Record<string, string>;
    };
    expect(argWith.headers['X-Atlas-Tenant-Id']).toBe('tenant-xyz');

    await mailer.send(baseMsg({ tenantId: null }));
    const argWithout = transportSpies.sendMail.mock.calls[1]![0] as {
      headers: Record<string, string>;
    };
    expect(argWithout.headers).not.toHaveProperty('X-Atlas-Tenant-Id');
    // Correlation header must still be there regardless.
    expect(argWithout.headers['X-Atlas-Correlation-Id']).toBeDefined();
  });

  it('throws and skips email_log insert when SMTP rejects', async () => {
    transportSpies.sendMail.mockRejectedValueOnce(new Error('relay refused'));
    const { sql, calls } = fakeSql();
    const mailer = new SmtpMailer(sql as never, cfg);

    await expect(mailer.send(baseMsg())).rejects.toThrow(/relay refused/);
    // No phantom row — the contract is "logged iff sent".
    expect(calls).toHaveLength(0);
  });

  it('defaults tags to [] when omitted on the EmailMessage', async () => {
    transportSpies.sendMail.mockResolvedValueOnce({ messageId: 'm1' });
    const { sql, calls } = fakeSql();
    const mailer = new SmtpMailer(sql as never, cfg);

    const msg: EmailMessage = {
      to: 'a@b.test',
      subject: 's',
      body: 'b',
      tenantId: null,
      correlationId: 'c',
      // no tags
    };
    await mailer.send(msg);

    expect(calls[0]!.values[7]).toEqual({ __json: [] });
  });

  it('close() invokes transport.close()', async () => {
    const { sql } = fakeSql();
    const mailer = new SmtpMailer(sql as never, cfg);

    await mailer.close();

    expect(transportSpies.close).toHaveBeenCalledTimes(1);
  });
});
