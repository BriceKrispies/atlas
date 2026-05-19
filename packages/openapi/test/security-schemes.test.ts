import { describe, it, expect } from '@atlas/test';
import { buildSecuritySchemes } from '../src/security-schemes.ts';
describe('buildSecuritySchemes', function () {
    it('tenant has bearerAuth + apiKeyAuth + oauth2ClientCredentials', function () {
        const schemes = buildSecuritySchemes('tenant');
        expect(Object.keys(schemes).sort()).toEqual([
            'apiKeyAuth',
            'bearerAuth',
            'oauth2ClientCredentials',
        ]);
    });
    it('operator additionally has debugPrincipal', function () {
        const schemes = buildSecuritySchemes('operator');
        expect(Object.keys(schemes).sort()).toEqual([
            'apiKeyAuth',
            'bearerAuth',
            'debugPrincipal',
            'oauth2ClientCredentials',
        ]);
    });
    it('debugPrincipal documents the test-auth bypass', function () {
        const schemes = buildSecuritySchemes('operator');
        const dp = schemes['debugPrincipal'];
        if (!dp || typeof dp !== 'object')
            throw new Error('debugPrincipal scheme missing');
        const record: Record<string, unknown> = { ...dp };
        expect(record['type']).toBe('apiKey');
        expect(record['in']).toBe('header');
        expect(record['name']).toBe('X-Debug-Principal');
        expect(String(record['description']).toLowerCase()).toContain('dev');
    });
});
