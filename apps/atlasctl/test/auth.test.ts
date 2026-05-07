import { describe, it, expect } from 'vitest';
import { resolveCredential, AuthError } from '../src/auth.ts';

describe('resolveCredential precedence', () => {
  it('flag api-key wins over env and config', () => {
    const cred = resolveCredential(
      { apiKey: 'flag-key' },
      { ATLAS_API_KEY: 'env-key', ATLAS_TOKEN: 'env-tok' },
      { apiKey: 'cfg-key', token: 'cfg-tok' },
    );
    expect(cred).toEqual({ kind: 'api-key', key: 'flag-key' });
  });

  it('flag token wins over env and config', () => {
    const cred = resolveCredential(
      { token: 'flag-tok' },
      { ATLAS_API_KEY: 'env-key' },
      { apiKey: 'cfg-key' },
    );
    expect(cred).toEqual({ kind: 'token', token: 'flag-tok' });
  });

  it('env api-key wins over config', () => {
    const cred = resolveCredential(
      {},
      { ATLAS_API_KEY: 'env-key' },
      { apiKey: 'cfg-key' },
    );
    expect(cred).toEqual({ kind: 'api-key', key: 'env-key' });
  });

  it('falls through to config token when no flags or env', () => {
    const cred = resolveCredential({}, {}, { token: 'cfg-tok' });
    expect(cred).toEqual({ kind: 'token', token: 'cfg-tok' });
  });

  it('returns kind=none when nothing is configured', () => {
    expect(resolveCredential({}, {}, {})).toEqual({ kind: 'none' });
  });

  it('treats empty strings as absent', () => {
    const cred = resolveCredential(
      { apiKey: '' },
      { ATLAS_TOKEN: 'env-tok' },
      {},
    );
    expect(cred).toEqual({ kind: 'token', token: 'env-tok' });
  });

  it('throws AuthError when mtls cert path does not exist', () => {
    expect(() =>
      resolveCredential(
        {},
        {},
        { mtls: { cert: '/nonexistent/cert.pem', key: '/nonexistent/key.pem' } },
      ),
    ).toThrow(AuthError);
  });
});
