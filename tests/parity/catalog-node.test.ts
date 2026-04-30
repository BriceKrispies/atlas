/**
 * Node-mode parity for the catalog suites.
 *
 * Mirrors `catalog-sim.test.ts`. The four scenarios that depend on the
 * test-only debug surface (`readEventTags`, `truncateSearch`,
 * `indexSearchDocument`) live in `catalog-search-node.test.ts` since
 * Chunk 7.2 — see `tests/parity/DEFERRED.md`.
 *
 * Skipped silently when `NODE_PARITY_BASE_URL` is unset.
 */

import { describe, test, expect } from 'vitest';
import { makeServerIngress } from './lib/server-factory.ts';
import { loadBadgeFamilySeed, buildSeedIntent } from './lib/fixtures.ts';
import type { VariantRow } from '@atlas/catalog';

const baseUrl = process.env['NODE_PARITY_BASE_URL'];
const d = baseUrl ? describe : describe.skip;

d('[node] catalog_badge_family parity', () => {
  test('test_seed_package_apply_is_idempotent', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cat-idem');
    const seed = loadBadgeFamilySeed();
    const idem = `itest-seed-${tenantId}`;
    const intent = buildSeedIntent(tenantId, principalId, idem, seed);

    const r1 = await ingress.submitIntent(intent);
    const r2 = await ingress.submitIntent(intent);
    expect(r1.eventId).toBe(r2.eventId);
    await ingress.close();
  });

  test('test_taxonomy_navigation_lists_family', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cat-tax');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-tax-${tenantId}`, seed),
    );

    const body = await ingress.getTaxonomyNodes('recognition');
    expect(body).not.toBeNull();
    const svc = body!.nodes.find((n) => n.key === 'service-anniversary');
    expect(svc).toBeDefined();
    expect(svc!.families.some((f) => f.familyKey === 'service_anniversary_badge')).toBe(true);
    await ingress.close();
  });

  test('test_family_detail_returns_attributes_and_policies', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cat-det');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-det-${tenantId}`, seed),
    );

    const body = await ingress.getFamilyDetail('service_anniversary_badge');
    expect(body).not.toBeNull();
    expect(
      body!.attributes.some(
        (a) => (a as { attributeKey?: string }).attributeKey === 'years_of_service',
      ),
    ).toBe(true);
    expect(
      body!.attributes.some(
        (a) => (a as { attributeKey?: string }).attributeKey === 'badge_tier',
      ),
    ).toBe(true);
    expect(
      body!.displayPolicies.some(
        (d) => (d as { surface?: string }).surface === 'variant_table',
      ),
    ).toBe(true);
    await ingress.close();
  });

  test('test_variant_table_returns_normalized_rows', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cat-vt');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-vt-${tenantId}`, seed),
    );

    const body = await ingress.getVariantTable('service_anniversary_badge');
    expect(body).not.toBeNull();
    expect(body!.rows.length).toBe(3);

    const fiveYear = body!.rows.find((r) => r.variantKey === '5-year');
    expect(fiveYear).toBeDefined();
    expect(fiveYear!.values['years_of_service']?.normalized).toBe(5);
    await ingress.close();
  });

  test('test_variant_table_filter_narrows', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cat-flt');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-flt-${tenantId}`, seed),
    );

    const body = await ingress.getVariantTable('service_anniversary_badge', {
      filters: { badge_tier: { kind: 'equals', value: 'gold' } },
    });
    expect(body).not.toBeNull();
    expect(body!.rows.length).toBe(1);
    expect(body!.rows[0]!.variantKey).toBe('10-year');
    await ingress.close();
  });

  test('test_tenant_isolation', async () => {
    const a = await makeServerIngress('cat-iso-a');
    const b = await makeServerIngress('cat-iso-b');
    const seed = loadBadgeFamilySeed();
    await a.ingress.submitIntent(
      buildSeedIntent(a.tenantId, a.principalId, `itest-iso-${a.tenantId}`, seed),
    );

    const fromB = await b.ingress.getVariantTable('service_anniversary_badge');
    expect(fromB).toBeNull();

    await a.ingress.close();
    await b.ingress.close();
  });

  test('test_projection_rebuild_is_deterministic', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cat-rb');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-rb-${tenantId}`, seed),
    );

    const before = await ingress.getVariantTable('service_anniversary_badge');
    expect(before).not.toBeNull();
    const beforeRows = canonicalize(before!.rows);

    const bumped = { ...seed, version: `rebuild-${tenantId}` };
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-rb2-${tenantId}`, bumped),
    );

    const after = await ingress.getVariantTable('service_anniversary_badge');
    expect(after).not.toBeNull();
    const afterRows = canonicalize(after!.rows);
    expect(afterRows).toEqual(beforeRows);
    await ingress.close();
  });

  // test_seed_event_has_cache_invalidation_tags lives in
  // `catalog-search-node.test.ts` since Chunk 7.2.
});

d('[node] catalog_search parity', () => {
  test('test_search_returns_family_for_anniversary', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cs-fam');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-fam-${tenantId}`, seed),
    );

    const body = await ingress.searchCatalog({ q: 'anniversary' });
    expect(
      body.results.some(
        (r) => r.documentType === 'family' && r.documentId === 'service_anniversary_badge',
      ),
    ).toBe(true);
    await ingress.close();
  });

  test('test_search_returns_variants', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cs-var');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-var-${tenantId}`, seed),
    );

    const body = await ingress.searchCatalog({ q: 'year' });
    const variantHits = body.results.filter((r) => r.documentType === 'variant');
    expect(variantHits.length).toBeGreaterThanOrEqual(3);
    await ingress.close();
  });

  test('test_search_tenant_isolation', async () => {
    const a = await makeServerIngress('cs-iso-a');
    const b = await makeServerIngress('cs-iso-b');
    const seed = loadBadgeFamilySeed();
    await a.ingress.submitIntent(
      buildSeedIntent(a.tenantId, a.principalId, `itest-cs-iso-${a.tenantId}`, seed),
    );

    const inB = await b.ingress.searchCatalog({ q: 'anniversary' });
    expect(inB.results).toEqual([]);

    await a.ingress.close();
    await b.ingress.close();
  });

  test('test_search_type_filter_narrows', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cs-typ');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-typ-${tenantId}`, seed),
    );

    const body = await ingress.searchCatalog({ q: 'anniversary', type: 'variant' });
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.every((r) => r.documentType === 'variant')).toBe(true);
    await ingress.close();
  });

  test('test_search_ranking_descending_score', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cs-rnk');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-rnk-${tenantId}`, seed),
    );

    const body = await ingress.searchCatalog({ q: 'anniversary' });
    expect(body.results.length).toBeGreaterThanOrEqual(2);
    const scores = body.results.map((r) => r.score);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i] ?? 0).toBeGreaterThanOrEqual(scores[i + 1] ?? 0);
    }
    expect(body.results[0]!.documentType).toBe('family');
    await ingress.close();
  });

  // The three search scenarios that need the debug surface (permission,
  // rebuild, cache-invalidation tag) live in `catalog-search-node.test.ts`
  // since Chunk 7.2 shipped `/debug/search/index`, `/debug/search/rebuild`
  // and `/debug/events/:eventId`.
});

function canonicalize(
  rows: ReadonlyArray<VariantRow>,
): Array<{ key: string; values: Record<string, unknown> }> {
  return rows
    .map((r) => ({ key: r.variantKey, values: { ...r.values } }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
