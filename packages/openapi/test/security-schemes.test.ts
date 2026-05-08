import { describe, it, expect } from 'vitest';
import { buildSecuritySchemes } from '../src/security-schemes.ts';

describe('buildSecuritySchemes', () => {
  it('tenant has bearerAuth + apiKeyAuth + oauth2ClientCredentials', () => {
    const schemes = buildSecuritySchemes('tenant');
    expect(Object.keys(schemes).sort()).toEqual([
      'apiKeyAuth',
      'bearerAuth',
      'oauth2ClientCredentials',
    ]);
  });

  it('operator additionally has debugPrincipal', () => {
    const schemes = buildSecuritySchemes('operator');
    expect(Object.keys(schemes).sort()).toEqual([
      'apiKeyAuth',
      'bearerAuth',
      'debugPrincipal',
      'oauth2ClientCredentials',
    ]);
  });

  it('debugPrincipal documents the test-auth bypass', () => {
    const schemes = buildSecuritySchemes('operator');
    const dp = schemes['debugPrincipal'] as Record<string, unknown>;
    expect(dp['type']).toBe('apiKey');
    expect(dp['in']).toBe('header');
    expect(dp['name']).toBe('X-Debug-Principal');
    expect(String(dp['description']).toLowerCase()).toContain('dev');
  });
});
