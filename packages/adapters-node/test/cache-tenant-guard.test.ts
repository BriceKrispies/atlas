/**
 * Invariant I9 enforcement for `PostgresCache.set`.
 *
 * The Rust reference (`crates/core/src/cache.rs` lines 218–232,
 * `validate_cache_artifact`) enforces:
 *
 *     // Rule: tenantId must be in tags unless privacy is PUBLIC
 *     if artifact.privacy != PrivacyLevel::Public {
 *         let has_tenant_tag = artifact.tags.iter()
 *             .any(|tag| tag.contains("{tenantId}") || tag.contains("{tenant_id}"));
 *         if !has_tenant_tag {
 *             return Err(CacheError::InvalidPrivacyConfiguration(
 *                 "tenantId must be in tag templates unless privacy is PUBLIC"
 *             ));
 *         }
 *     }
 *
 * The TS `PostgresCache.set` does NOT validate this — callers can pass
 * `tags: []` and there's no guard. These tests drive the introduction of
 * a new `privacy` field on `CacheSetOptions` plus a runtime guard inside
 * `set` that mirrors the Rust rule (using a literal `Tenant:*` tag
 * presence check, since the TS adapter receives expanded tags rather
 * than templates).
 *
 * RED PHASE: this file is expected to fail compilation today because
 * `privacy` is not yet on `CacheSetOptions`.
 */

import { describe, test, expect } from 'vitest';
import { PostgresCache } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';

if (HAS_DB) {
  describe('PostgresCache.set — Invariant I9 tenant tag guard', () => {
    test('throws when privacy is non-PUBLIC and tags lack any Tenant:* entry', async () => {
      const sql = await freshSql();
      const cache = new PostgresCache(sql);
      await expect(
        cache.set('k1', { hello: 'world' }, {
          ttlSeconds: 60,
          tags: ['Resource:foo'],
          privacy: 'PRIVATE',
        }),
      ).rejects.toThrow(/tenant.*tag|I9/i);
    });

    test('succeeds when privacy is PUBLIC even with no Tenant tag', async () => {
      const sql = await freshSql();
      const cache = new PostgresCache(sql);
      await expect(
        cache.set('k2', { hello: 'world' }, {
          ttlSeconds: 60,
          tags: ['Resource:foo'],
          privacy: 'PUBLIC',
        }),
      ).resolves.toBeUndefined();
    });

    test('succeeds when a Tenant:* tag is present (privacy: PRIVATE)', async () => {
      const sql = await freshSql();
      const cache = new PostgresCache(sql);
      await expect(
        cache.set('k3', { hello: 'world' }, {
          ttlSeconds: 60,
          tags: ['Tenant:t1', 'Resource:foo'],
          privacy: 'PRIVATE',
        }),
      ).resolves.toBeUndefined();
    });

    test('succeeds with no privacy specified (default = private behavior) when Tenant:* tag is present', async () => {
      const sql = await freshSql();
      const cache = new PostgresCache(sql);
      await expect(
        cache.set('k4', { hello: 'world' }, {
          ttlSeconds: 60,
          tags: ['Tenant:t1', 'Resource:foo'],
        }),
      ).resolves.toBeUndefined();
    });
  });
} else {
  describe('PostgresCache.set — Invariant I9 tenant tag guard (skipped)', () => {
    test.skip('TEST_TENANT_DB_URL not set — skipping Postgres I9 guard tests', () => {
      // intentionally empty
    });
  });
}
