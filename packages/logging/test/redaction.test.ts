import { describe, it, expect } from 'vitest';
import { makeTestContext, makeTestRig } from './helpers.ts';
import { redact, sensitive, isSensitive } from '../src/index.ts';
import { assertDefined } from '@atlas/test-fixtures/assert';

/**
 * Narrow `redact()`'s `unknown` return to a record by runtime check.
 * `redact()` returns its input shape unchanged structurally — when we
 * feed it a plain object, it returns a plain object. This guard
 * collapses the boundary cast into one validated readback.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  if (!isRecord(v)) {
    throw new Error(`expected plain object record, got ${typeof v}`);
  }
  return v;
}

function asNestedRecord(v: unknown, key: string): Record<string, unknown> {
  const outer = asRecord(v);
  return asRecord(outer[key]);
}

function asArrayOfRecords(v: unknown, key: string): Array<Record<string, unknown>> {
  const outer = asRecord(v);
  const arr = outer[key];
  if (!Array.isArray(arr)) throw new Error(`expected array at "${key}"`);
  return arr.map((item) => asRecord(item));
}

describe('redaction', () => {
  describe('default key list', () => {
    it.each([
      'password',
      'secret',
      'token',
      'accessToken',
      'refreshToken',
      'authorization',
      'cookie',
      'set-cookie',
      'apiKey',
      'connectionString',
      'email',
      'phone',
    ])('redacts top-level key "%s"', (key) => {
      const out = asRecord(redact({ [key]: 'value-to-hide', other: 'kept' }));
      expect(out[key]).toBe('[REDACTED]');
      expect(out['other']).toBe('kept');
    });

    it('matches keys case-insensitively', () => {
      const out = asRecord(redact({ Password: 'secret', PASSWORD: 'also', token: 'x' }));
      expect(out['Password']).toBe('[REDACTED]');
      expect(out['PASSWORD']).toBe('[REDACTED]');
      expect(out['token']).toBe('[REDACTED]');
    });

    it('walks nested objects', () => {
      const out = redact({
        user: { email: 'a@example.com', name: 'Alice' },
      });
      const user = asNestedRecord(out, 'user');
      expect(user['email']).toBe('[REDACTED]');
      expect(user['name']).toBe('Alice');
    });

    it('walks arrays', () => {
      const out = redact({
        items: [{ token: 't1' }, { token: 't2' }, { name: 'safe' }],
      });
      const items = asArrayOfRecords(out, 'items');
      expect(assertDefined(items[0], 'items[0]')['token']).toBe('[REDACTED]');
      expect(assertDefined(items[1], 'items[1]')['token']).toBe('[REDACTED]');
      expect(assertDefined(items[2], 'items[2]')['name']).toBe('safe');
    });

    it('handles cycles without infinite recursion', () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj['self'] = obj;
      const out = asRecord(redact(obj));
      expect(out['a']).toBe(1);
      expect(out['self']).toBe('[Circular]');
    });

    it('passes primitives through', () => {
      expect(redact(42)).toBe(42);
      expect(redact('hello')).toBe('hello');
      expect(redact(null)).toBe(null);
      expect(redact(undefined)).toBe(undefined);
      expect(redact(true)).toBe(true);
    });
  });

  describe('sensitive() wrapper', () => {
    it('redacts a wrapped value regardless of key', () => {
      const out = asRecord(redact({ harmlessKey: sensitive('hidden') }));
      expect(out['harmlessKey']).toBe('[REDACTED]');
    });

    it('does not modify input', () => {
      const input = { password: 'p', other: 'o' };
      redact(input);
      expect(input.password).toBe('p');
      expect(input.other).toBe('o');
    });

    it('isSensitive identifies wrapped values', () => {
      expect(isSensitive(sensitive('x'))).toBe(true);
      expect(isSensitive('x')).toBe(false);
      expect(isSensitive({ value: 'x' })).toBe(false);
    });
  });

  describe('extra keys', () => {
    it('redacts custom extra keys when configured', () => {
      const out = asRecord(
        redact({ customKey: 'hide', other: 'keep' }, { extraKeys: ['customKey'] }),
      );
      expect(out['customKey']).toBe('[REDACTED]');
      expect(out['other']).toBe('keep');
    });
  });

  describe('integration — runs before sinks see the event', () => {
    it('properties are redacted before reaching the collector', () => {
      const rig = makeTestRig();
      const ctx = makeTestContext({ pipeline: rig.pipeline });
      ctx.logger.info('login attempt', {
        properties: {
          email: 'alice@acme.com',
          password: 'hunter2',
          attemptCount: 3,
          metadata: {
            authorization: 'Bearer abc',
            ok: 'visible',
          },
        },
      });
      const e = assertDefined(rig.collector.events[0], 'collector should have received one event');
      expect(e.properties).toEqual({
        email: '[REDACTED]',
        password: '[REDACTED]',
        attemptCount: 3,
        metadata: {
          authorization: '[REDACTED]',
          ok: 'visible',
        },
      });
    });

    it('error.message is NOT walked (stack-trace exemption)', () => {
      // Per the contract, error.stack and error.message stay as-is.
      // Reasoning: stack traces are internal-codebase content; redacting
      // them would lose debugging value. Callers control the error object.
      const rig = makeTestRig();
      const ctx = makeTestContext({ pipeline: rig.pipeline });
      ctx.logger.error('boom', {
        error: {
          code: 'BAD',
          message: 'password=hunter2 was rejected', // illustrative; not advised
        },
      });
      const e = assertDefined(rig.collector.events[0], 'collector should have received one event');
      expect(e.error?.message).toBe('password=hunter2 was rejected');
    });

    it('pipeline-level redactionExtraKeys are applied', () => {
      const rig = makeTestRig({ redactionExtraKeys: ['ssn'] });
      const ctx = makeTestContext({ pipeline: rig.pipeline });
      ctx.logger.info('record', { properties: { ssn: '123-45-6789', name: 'Alice' } });
      const e = assertDefined(rig.collector.events[0], 'collector should have received one event');
      expect(e.properties).toEqual({ ssn: '[REDACTED]', name: 'Alice' });
    });
  });
});
