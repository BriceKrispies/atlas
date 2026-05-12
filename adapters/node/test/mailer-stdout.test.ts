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

import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import type postgres from 'postgres';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { EmailMessage } from '@atlas/ports';
import { StdoutEventMailer } from '../src/mailer-stdout.ts';

interface SqlCall {
  strings: TemplateStringsArray;
  values: unknown[];
}

/**
 * Build a tagged-template `vi.fn()` that records every call plus a `.json`
 * pass-through helper. The single boundary cast funnels `postgres.Sql`'s
 * enormous callable surface — too wide to faithfully reconstruct — into a
 * fake the adapter happily consumes.
 */
function fakeSql(): { sql: postgres.Sql; calls: SqlCall[] } {
  const calls: SqlCall[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings, values });
    return Promise.resolve([]);
  });
  const withJson = Object.assign(fn, {
    json: (v: unknown): unknown => ({ __json: v }),
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, atlas-widgets/no-double-cast -- library: postgres.js `Sql` is a callable with hundreds of overloads we can't faithfully reconstruct in a test; this single shielded cast funnels the fake-sql shape into the adapter constructor.
  const sql = withJson as unknown as postgres.Sql;
  return { sql, calls };
}

interface SentEvent {
  event: string;
  messageId: string;
  to: string;
  subject: string;
  tenantId: string | null;
  correlationId: string;
  tags: string[];
  sentAt: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate-and-narrow the JSON line emitted to stdout. Throws if a required
 * field is missing so a regression in the adapter fails the test loudly
 * rather than hiding behind a bare `as SentEvent`.
 */
function parseSentEvent(raw: string): SentEvent & Record<string, unknown> {
  const v: unknown = JSON.parse(raw);
  if (!isRecord(v)) {
    throw new Error(`Test invariant violation: stdout line not a JSON object: ${raw}`);
  }
  const requireString = (k: string): string => {
    const x = v[k];
    if (typeof x !== 'string') {
      throw new Error(`Test invariant violation: stdout JSON missing string field "${k}"`);
    }
    return x;
  };
  const rawTags = v['tags'];
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((t): t is string => typeof t === 'string')
    : [];
  return {
    ...v,
    event: requireString('event'),
    messageId: requireString('messageId'),
    to: requireString('to'),
    subject: requireString('subject'),
    tenantId: typeof v['tenantId'] === 'string' ? v['tenantId'] : null,
    correlationId: requireString('correlationId'),
    tags,
    sentAt: requireString('sentAt'),
  };
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

let consoleLogSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
});

describe('StdoutEventMailer', () => {
  it('persists body to email_log so the in-app mailbox panel still works', async () => {
    const { sql, calls } = fakeSql();
    const mailer = new StdoutEventMailer(sql);

    await mailer.send(baseMsg());

    expect(calls).toHaveLength(1);
    // Positional values in INSERT column order:
    // message_id, to_address, subject, body, tenant_id, correlation_id, sent_at, tags
    const v = assertDefined(calls[0], 'first sql call recorded').values;
    expect(v[1]).toBe('recipient@example.com');
    expect(v[2]).toBe('Welcome');
    expect(v[3]).toBe(baseMsg().body);
    expect(v[4]).toBe('tenant-1');
    expect(v[5]).toBe('corr-abc');
    expect(v[7]).toEqual({ __json: ['magic-link'] });
  });

  it('does NOT include body on the stdout JSON line (credential-leak regression guard)', async () => {
    const { sql } = fakeSql();
    const mailer = new StdoutEventMailer(sql);

    const msg = baseMsg();
    await mailer.send(msg);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const firstCall = assertDefined(consoleLogSpy.mock.calls[0], 'console.log was called once');
    const firstArg = firstCall[0];
    if (typeof firstArg !== 'string') {
      throw new Error('Test invariant violation: console.log first arg should be a JSON string');
    }
    const parsed = parseSentEvent(firstArg);

    // The leak: `body` must not be a property on the emitted JSON object.
    expect(parsed).not.toHaveProperty('body');

    // Belt-and-braces: the magic-link token from the body must not be in
    // the raw line at all (catches accidental interpolation into other
    // fields like subject or tags during refactors).
    expect(firstArg).not.toContain('secret-magic-link-token');

    // The non-secret fields are still present so log-streamers can correlate.
    expect(parsed).toMatchObject({
      event: 'mailer.sent',
      to: msg.to,
      subject: msg.subject,
      tenantId: 'tenant-1',
      correlationId: 'corr-abc',
      tags: ['magic-link'],
    });
    expect(parsed.messageId).toEqual(expect.any(String));
    expect(parsed.sentAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });

  it('returns the same messageId that was inserted into email_log', async () => {
    const { sql, calls } = fakeSql();
    const mailer = new StdoutEventMailer(sql);

    const result = await mailer.send(baseMsg());

    expect(result.messageId).toMatch(/^msg-/);
    const firstCallValues = assertDefined(calls[0], 'first sql call recorded').values;
    expect(firstCallValues[0]).toBe(result.messageId);
    expect(result.sentAt).toBe(firstCallValues[6]);
  });
});
