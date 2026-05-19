import { describe, test, expect } from 'vitest';
import { buildCacheKey, renderTags, validateCacheArtifact, extractPlaceholder, extractAllPlaceholders, CacheError, type CacheArtifact, } from '@atlas/platform-core';
/**
 * TS parity tests for `crates/core/src/cache.rs`. Each test mirrors the
 * Rust `#[cfg(test)] mod tests` golden vectors so the on-the-wire
 * cache-key string and tag strings stay byte-identical across runtimes
 * (Invariants I9 + I10).
 */
function createTestArtifact(): CacheArtifact {
    return {
        artifactId: 'RenderPageModel',
        varyBy: ['LOCALE'],
        ttlSeconds: 300,
        tags: ['tenant:{tenantId}', 'page:{pageId}'],
        privacy: 'TENANT',
    };
}
describe('cache-key parity (mirrors crates/core/src/cache.rs tests)', function () {
    test('build_cache_key_deterministic', function () {
        const artifact = createTestArtifact();
        const keyValues = { tenantId: 'acme', pageId: 'page-123' };
        const varyValues = { locale: 'en-US' };
        const key1 = buildCacheKey(artifact, keyValues, varyValues);
        const key2 = buildCacheKey(artifact, keyValues, varyValues);
        expect(key1).toBe(key2);
        expect(key1.startsWith('cache:RenderPageModel@v300:')).toBe(true);
        expect(key1).toContain('acme');
        expect(key1).toContain('page-123');
        // Byte-for-byte exact form (locked against the Rust spec):
        expect(key1).toBe('cache:RenderPageModel@v300:acme:page-123:vary(locale=en-US)');
    });
    test('build_cache_key without vary values omits vary segment', function () {
        const artifact = createTestArtifact();
        const keyValues = { tenantId: 'acme', pageId: 'page-123' };
        expect(buildCacheKey(artifact, keyValues)).toBe('cache:RenderPageModel@v300:acme:page-123');
    });
    test('build_cache_key with empty vary map omits vary segment', function () {
        const artifact = createTestArtifact();
        const keyValues = { tenantId: 'acme', pageId: 'page-123' };
        expect(buildCacheKey(artifact, keyValues, {})).toBe('cache:RenderPageModel@v300:acme:page-123');
    });
    test('build_cache_key with vary values that miss every dimension yields none', function () {
        const artifact = createTestArtifact();
        const keyValues = { tenantId: 'acme', pageId: 'page-123' };
        // varyBy=[LOCALE] but the only vary value is for `role` (not in varyBy)
        // → sorted is empty → varyHash is the literal "none". Mirrors Rust.
        expect(buildCacheKey(artifact, keyValues, { role: 'admin' })).toBe('cache:RenderPageModel@v300:acme:page-123:none');
    });
    test('build_cache_key_missing_key_part', function () {
        const artifact = createTestArtifact();
        const keyValues = { tenantId: 'acme' }; // missing pageId
        expect(function () {
            return buildCacheKey(artifact, keyValues);
        }).toThrow(CacheError);
        try {
            buildCacheKey(artifact, keyValues);
        }
        catch (e) {
            if (!(e instanceof CacheError)) {
                throw new Error(`expected CacheError, got ${String(e)}`);
            }
            expect(e.kind).toBe('MissingRequiredKeyPart');
            expect(e.detail.placeholder).toBe('pageId');
        }
    });
    test('render_tags', function () {
        const artifact = createTestArtifact();
        const keyValues = { tenantId: 'acme', pageId: 'page-123' };
        const tags = renderTags(artifact, keyValues);
        expect(tags).toHaveLength(2);
        expect(tags[0]).toBe('tenant:acme');
        expect(tags[1]).toBe('page:page-123');
    });
    test('render_tags_missing_placeholder', function () {
        const artifact = createTestArtifact();
        const keyValues = { tenantId: 'acme' }; // missing pageId
        try {
            renderTags(artifact, keyValues);
            throw new Error('expected throw');
        }
        catch (e) {
            if (!(e instanceof CacheError)) {
                throw new Error(`expected CacheError, got ${String(e)}`);
            }
            // render_tags hits the per-tag placeholder check before
            // validate_cache_key_inputs is reached, matching Rust's ordering:
            // it reports MissingPlaceholder, not MissingRequiredKeyPart.
            expect(e.kind).toBe('MissingPlaceholder');
            expect(e.detail.placeholder).toBe('pageId');
        }
    });
    test('validate_cache_artifact_tenant_privacy_requires_tenant_tag', function () {
        const artifact: CacheArtifact = {
            ...createTestArtifact(),
            tags: ['page:{pageId}'], // missing tenant
        };
        try {
            validateCacheArtifact(artifact);
            throw new Error('expected throw');
        }
        catch (e) {
            if (!(e instanceof CacheError)) {
                throw new Error(`expected CacheError, got ${String(e)}`);
            }
            expect(e.kind).toBe('InvalidPrivacyConfiguration');
        }
    });
    test('validate_cache_artifact_user_privacy_requires_principal', function () {
        const artifact: CacheArtifact = {
            ...createTestArtifact(),
            privacy: 'USER',
            varyBy: ['LOCALE'], // missing USER dimension
        };
        expect(function () {
            return validateCacheArtifact(artifact);
        }).toThrow(CacheError);
    });
    test('validate_cache_artifact_public_privacy_ok_without_tenant', function () {
        const artifact: CacheArtifact = {
            ...createTestArtifact(),
            privacy: 'PUBLIC',
            tags: ['global:config'], // no tenant
        };
        expect(function () {
            return validateCacheArtifact(artifact);
        }).not.toThrow();
    });
    test('extract_placeholder', function () {
        expect(extractPlaceholder('tenant:{tenantId}')).toBe('tenantId');
        expect(extractPlaceholder('page:{pageId}')).toBe('pageId');
        expect(extractPlaceholder('no-placeholder')).toBeUndefined();
    });
    test('extract_all_placeholders', function () {
        expect(extractAllPlaceholders('tenant:{tenantId}:page:{pageId}')).toEqual([
            'tenantId',
            'pageId',
        ]);
        expect(extractAllPlaceholders('only:{one}')).toEqual(['one']);
        expect(extractAllPlaceholders('no-placeholders-here')).toEqual([]);
    });
});
