/**
 * Unit tests for `StdoutEventMailer`.
 *
 * Primary purpose: regression guard for the magic-link credential leak
 * where `body` was emitted on the stdout JSON line. Body must persist
 * to `control_plane.email_log` (in-app mailbox panel reads from there)
 * but must NOT appear on stdout — magic-link tokens are credentials per
 * specs/crosscut/logging.md.
 *
 * The Postgres `Sql` is faked the same way as in `mailer-smtp.test.ts`:
 * a tagged-template `vi.fn()` records each invocation so the test can
 * assert the column shape written to `control_plane.email_log`.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { EmailMessage } from '@atlas/ports';
import { StdoutEventMailer } from '../src/mailer-stdout.ts';

interface SqlCall {
  strings: TemplateStringsArray;
  values: unknown[];
}

function fakeSql() {
  const calls: SqlCall[] = [];
  const fn = vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ strings, values });
      return Promise.resolve([]);
    },
  );
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => ({
    __json: v,
  });
  return { sql: fn, calls };
}

function baseMsg(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: 'Recipient@Example.COM',
    subject: 'Welcome',
    body: 'Hi,\n\nClick https://acme.atlas.test/accept?token=secret-magic-link-token to finish setup.',
    tenantId: 'tenant-1',
    correlationId: 'corr-abc',
    tags: ['magic-link'],
    ...overrides,
  };
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
});

describe('StdoutEventMailer', () => {
  it('persists body to email_log so the in-app mailbox panel still works', async () => {
    const { sql, calls } = fakeSql();
    const mailer = new StdoutEventMailer(sql as never);

    await mailer.send(baseMsg());

    expect(calls).toHaveLength(1);
    // Positional values in INSERT column order:
    // message_id, to_address, subject, body, tenant_id, correlation_id, sent_at, tags
    const v = calls[0]!.values;
    expect(v[1]).toBe('recipient@example.com');
    expect(v[2]).toBe('Welcome');
    expect(v[3]).toBe(baseMsg().body);
    expect(v[4]).toBe('tenant-1');
    expect(v[5]).toBe('corr-abc');
    expect(v[7]).toEqual({ __json: ['magic-link'] });
  });

  it('does NOT include body on the stdout JSON line (credential-leak regression guard)', async () => {
    const { sql } = fakeSql();
    const mailer = new StdoutEventMailer(sql as never);

    const msg = baseMsg();
    await mailer.send(msg);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const line = consoleLogSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;

    // The leak: `body` must not be a property on the emitted JSON object.
    expect(parsed).not.toHaveProperty('body');

    // Belt-and-braces: the magic-link token from the body must not be in
    // the raw line at all (catches accidental interpolation into other
    // fields like subject or tags during refactors).
    expect(line).not.toContain('secret-magic-link-token');

    // The non-secret fields are still present so log-streamers can correlate.
    expect(parsed).toMatchObject({
      event: 'mailer.sent',
      to: msg.to,
      subject: msg.subject,
      tenantId: 'tenant-1',
      correlationId: 'corr-abc',
      tags: ['magic-link'],
    });
    expect(parsed['messageId']).toEqual(expect.any(String));
    expect(parsed['sentAt']).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });

  it('returns the same messageId that was inserted into email_log', async () => {
    const { sql, calls } = fakeSql();
    const mailer = new StdoutEventMailer(sql as never);

    const result = await mailer.send(baseMsg());

    expect(result.messageId).toMatch(/^msg-/);
    expect(calls[0]!.values[0]).toBe(result.messageId);
    expect(result.sentAt).toBe(calls[0]!.values[6]);
  });
});
