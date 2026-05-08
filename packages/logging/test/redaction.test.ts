import { describe, it, expect } from 'vitest';
import { makeTestContext, makeTestRig } from './helpers.ts';
import { redact, sensitive, isSensitive } from '../src/index.ts';

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
      const out = redact({ [key]: 'value-to-hide', other: 'kept' }) as Record<string, unknown>;
      expect(out[key]).toBe('[REDACTED]');
      expect(out['other']).toBe('kept');
    });

    it('matches keys case-insensitively', () => {
      const out = redact({ Password: 'secret', PASSWORD: 'also', token: 'x' }) as Record<
        string,
        unknown
      >;
      expect(out['Password']).toBe('[REDACTED]');
      expect(out['PASSWORD']).toBe('[REDACTED]');
      expect(out['token']).toBe('[REDACTED]');
    });

    it('walks nested objects', () => {
      const out = redact({
        user: { email: 'a@example.com', name: 'Alice' },
      }) as Record<string, Record<string, unknown>>;
      expect(out['user']!['email']).toBe('[REDACTED]');
      expect(out['user']!['name']).toBe('Alice');
    });

    it('walks arrays', () => {
      const out = redact({
        items: [{ token: 't1' }, { token: 't2' }, { name: 'safe' }],
      }) as Record<string, Array<Record<string, unknown>>>;
      expect(out['items']![0]!['token']).toBe('[REDACTED]');
      expect(out['items']![1]!['token']).toBe('[REDACTED]');
      expect(out['items']![2]!['name']).toBe('safe');
    });

    it('handles cycles without infinite recursion', () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj['self'] = obj;
      const out = redact(obj) as Record<string, unknown>;
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
      const out = redact({ harmlessKey: sensitive('hidden') }) as Record<string, unknown>;
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
      const out = redact(
        { customKey: 'hide', other: 'keep' },
        { extraKeys: ['customKey'] },
      ) as Record<string, unknown>;
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
      const e = rig.collector.events[0]!;
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
      const e = rig.collector.events[0]!;
      expect(e.error?.message).toBe('password=hunter2 was rejected');
    });

    it('pipeline-level redactionExtraKeys are applied', () => {
      const rig = makeTestRig({ redactionExtraKeys: ['ssn'] });
      const ctx = makeTestContext({ pipeline: rig.pipeline });
      ctx.logger.info('record', { properties: { ssn: '123-45-6789', name: 'Alice' } });
      const e = rig.collector.events[0]!;
      expect(e.properties).toEqual({ ssn: '[REDACTED]', name: 'Alice' });
    });
  });
});
