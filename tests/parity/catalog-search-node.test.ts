/**
 * Node-mode parity for the four catalog-search / catalog-tag scenarios that
 * lived sim-only until Chunk 7.2. Each scenario mirrors a test in
 * `catalog-sim.test.ts`:
 *
 *  - test_seed_event_has_cache_invalidation_tags
 *      → reads `EventEnvelope.cacheInvalidationTags` via
 *        `GET /debug/events/:eventId`
 *  - test_search_permission_filter_excludes_disallowed
 *      → injects a permission-restricted document via
 *        `POST /debug/search/index`
 *  - test_search_rebuild_is_deterministic
 *      → truncates the tenant's search docs via
 *        `POST /debug/search/rebuild`
 *  - test_search_index_cache_invalidation_tag_present
 *      → asserts the seed event's tag list contains `SearchIndex:catalog`
 *
 * Skipped silently when `NODE_PARITY_BASE_URL` is unset.
 */

import { describe, test, expect } from 'vitest';
import { createServerIngress, makeServerIngress } from './lib/server-factory.ts';
import { loadBadgeFamilySeed, buildSeedIntent } from './lib/fixtures.ts';
import type { SearchDocument } from '@atlas/platform-core';

const baseUrl = process.env['NODE_PARITY_BASE_URL'];
const d = baseUrl ? describe : describe.skip;

d('[node] catalog_badge_family parity (debug-surface)', () => {
  test('test_seed_event_has_cache_invalidation_tags', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cat-tag');
    const seed = loadBadgeFamilySeed();
    const idem = `itest-tag-${tenantId}`;
    const intent = buildSeedIntent(tenantId, principalId, idem, seed);
    const r1 = await ingress.submitIntent(intent);

    const tax = await ingress.getTaxonomyNodes('recognition');
    expect(tax).not.toBeNull();

    const stored = await ingress.readEventTags(r1.eventId);
    expect(stored).not.toBeNull();
    expect(stored!).toContain(`Tenant:${tenantId}`);
    expect(stored!).toContain('TaxonomyTree:recognition');
    expect(stored!).toContain('SearchIndex:catalog');
    await ingress.close();
  });
});

d('[node] catalog_search parity (debug-surface)', () => {
  test('test_search_permission_filter_excludes_disallowed', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cs-perm');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-perm-${tenantId}`, seed),
    );

    const restricted: SearchDocument = {
      documentId: 'alice_only_anniversary',
      documentType: 'family',
      tenantId,
      fields: {
        title: 'Alice Only Anniversary Briefing',
        summary: 'Restricted to Alice',
        body_text: '',
        taxonomy_path: '/recognition/badges/private',
      },
      permissionAttributes: { allowedPrincipals: ['u_alice'] },
    };
    await ingress.indexSearchDocument(restricted);

    const body = await ingress.searchCatalog({ q: 'anniversary' });
    expect(
      body.results.some((r) => r.documentId === 'alice_only_anniversary'),
    ).toBe(false);

    // The Rust black-box uses a fresh principal in the same tenant for the
    // allow-list assertion. Mirror that here by constructing a server
    // ingress directly with `principalId: 'u_alice'`.
    const aliceIngress = await createServerIngress({
      baseUrl: baseUrl!,
      tenantId,
      principalId: 'u_alice',
    });
    const aliceBody = await aliceIngress.searchCatalog({ q: 'anniversary' });
    expect(
      aliceBody.results.some((r) => r.documentId === 'alice_only_anniversary'),
    ).toBe(true);
    await aliceIngress.close();
    await ingress.close();
  });

  test('test_search_rebuild_is_deterministic', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cs-rb');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-rb-${tenantId}`, seed),
    );

    const before = await ingress.searchCatalog({ q: 'anniversary' });
    expect(before.results.length).toBeGreaterThan(0);
    const beforeCount = before.results.length;

    await ingress.truncateSearch();
    const mid = await ingress.searchCatalog({ q: 'anniversary' });
    expect(mid.results.length).toBe(0);

    const bumped = { ...seed, version: `rebuild-${tenantId}` };
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-rb2-${tenantId}`, bumped),
    );
    const after = await ingress.searchCatalog({ q: 'anniversary' });
    expect(after.results.length).toBeGreaterThanOrEqual(beforeCount);
    await ingress.close();
  });

  test('test_search_index_cache_invalidation_tag_present', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cs-cache');
    const seed = loadBadgeFamilySeed();
    const r = await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-cache-${tenantId}`, seed),
    );

    const tags = await ingress.readEventTags(r.eventId);
    expect(tags).not.toBeNull();
    expect(tags!).toContain('SearchIndex:catalog');

    const body = await ingress.searchCatalog({ q: 'anniversary' });
    expect(body.results.length).toBeGreaterThan(0);
    await ingress.close();
  });
});
