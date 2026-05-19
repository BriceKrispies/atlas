import { describe, it, expect } from '@atlas/test';
import { resolveCredential, AuthError } from '../src/auth.ts';
describe('resolveCredential precedence', function () {
    it('flag api-key wins over env and config', function () {
        const cred = resolveCredential({ apiKey: 'flag-key' }, { ATLAS_API_KEY: 'env-key', ATLAS_TOKEN: 'env-tok' }, { apiKey: 'cfg-key', token: 'cfg-tok' });
        expect(cred).toEqual({ kind: 'api-key', key: 'flag-key' });
    });
    it('flag token wins over env and config', function () {
        const cred = resolveCredential({ token: 'flag-tok' }, { ATLAS_API_KEY: 'env-key' }, { apiKey: 'cfg-key' });
        expect(cred).toEqual({ kind: 'token', token: 'flag-tok' });
    });
    it('env api-key wins over config', function () {
        const cred = resolveCredential({}, { ATLAS_API_KEY: 'env-key' }, { apiKey: 'cfg-key' });
        expect(cred).toEqual({ kind: 'api-key', key: 'env-key' });
    });
    it('falls through to config token when no flags or env', function () {
        const cred = resolveCredential({}, {}, { token: 'cfg-tok' });
        expect(cred).toEqual({ kind: 'token', token: 'cfg-tok' });
    });
    it('returns kind=none when nothing is configured', function () {
        expect(resolveCredential({}, {}, {})).toEqual({ kind: 'none' });
    });
    it('treats empty strings as absent', function () {
        const cred = resolveCredential({ apiKey: '' }, { ATLAS_TOKEN: 'env-tok' }, {});
        expect(cred).toEqual({ kind: 'token', token: 'env-tok' });
    });
    it('debug-principal flag wins over api-key flag', function () {
        const cred = resolveCredential({ debugPrincipal: 'user:tester:dev-tenant', apiKey: 'flag-key' }, {}, {});
        expect(cred).toEqual({
            kind: 'debug-principal',
            value: 'user:tester:dev-tenant',
        });
    });
    it('debug-principal flag wins over env credentials', function () {
        const cred = resolveCredential({ debugPrincipal: 'user:tester' }, { ATLAS_API_KEY: 'env-key', ATLAS_TOKEN: 'env-tok' }, {});
        expect(cred).toEqual({ kind: 'debug-principal', value: 'user:tester' });
    });
    it('ATLAS_DEBUG_PRINCIPAL env wins over ATLAS_API_KEY', function () {
        const cred = resolveCredential({}, { ATLAS_DEBUG_PRINCIPAL: 'user:tester', ATLAS_API_KEY: 'env-key' }, {});
        expect(cred).toEqual({ kind: 'debug-principal', value: 'user:tester' });
    });
    it('throws AuthError when mtls cert path does not exist', function () {
        expect(function () {
            return resolveCredential({}, {}, { mtls: { cert: '/nonexistent/cert.pem', key: '/nonexistent/key.pem' } });
        }).toThrow(AuthError);
    });
});
