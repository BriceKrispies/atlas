import { describe, test, expect, beforeEach } from 'vitest';
import { createSimIngress, type SimIngress } from './lib/sim-factory.ts';
import { loadBadgeFamilySeed, buildSeedIntent } from './lib/fixtures.ts';
import { newEventId, type VariantRow } from '@atlas/modules-catalog';
import type { SearchDocument } from '@atlas/platform-core';

let dbCounter = 0;

function uniqueTenantId(prefix: string): string {
  dbCounter++;
  return `${prefix}-${dbCounter}-${Date.now().toString(36)}`;
}

async function makeIngress(prefix: string): Promise<{
  ingress: SimIngress;
  tenantId: string;
  principalId: string;
}> {
  const tenantId = uniqueTenantId(prefix);
  const principalId = `user:test-user:${tenantId}`;
  const ingress = await createSimIngress({ tenantId, principalId });
  return { ingress, tenantId, principalId };
}

beforeEach(() => {
  // each test minted a unique tenant id, so dbs do not collide
});

describe('catalog_badge_family parity', () => {
  test('test_seed_package_apply_is_idempotent', async () => {
    const { ingress, tenantId, principalId } = await makeIngress('cat-idem');
    const seed = loadBadgeFamilySeed();
    const idem = `itest-seed-${tenantId}`;
    const intent = buildSeedIntent(tenantId, principalId, idem, seed);

    const r1 = await ingress.submitIntent(intent);
    const r2 = await ingress.submitIntent(intent);
    expect(r1.eventId).toBe(r2.eventId);
    await ingress.close();
  });

  test('test_taxonomy_navigation_lists_family', async () => {
    const { ingress, tenantId, principalId } = await makeIngress('cat-tax');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-tax-${tenantId}`, seed),
    );

    const body = await ingress.getTaxonomyNodes('recognition');
    expect(body).not.toBeNull();
    const nodes = body!.nodes;
    const svc = nodes.find((n) => n.key === 'service-anniversary');
    expect(svc).toBeDefined();
    expect(svc!.families.some((f) => f.familyKey === 'service_anniversary_badge')).toBe(true);
    await ingress.close();
  });

  test('test_family_detail_returns_attributes_and_policies', async () => {
    const { ingress, tenantId, principalId } = await makeIngress('cat-det');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-det-${tenantId}`, seed),
    );

    const body = await ingress.getFamilyDetail('service_anniversary_badge');
    expect(body).not.toBeNull();
    const attrs = body!.attributes;
    expect(
      attrs.some((a) => (a as { attributeKey?: string }).attributeKey === 'years_of_service'),
    ).toBe(true);
    expect(
      attrs.some((a) => (a as { attributeKey?: string }).attributeKey === 'badge_tier'),
    ).toBe(true);
    const dps = body!.displayPolicies;
    expect(dps.some((d) => (d as { surface?: string }).surface === 'variant_table')).toBe(true);
    expect(Array.isArray(body!.assets)).toBe(true);
    await ingress.close();
  });

  test('test_variant_table_returns_normalized_rows', async () => {
    const { ingress, tenantId, principalId } = await makeIngress('cat-vt');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-vt-${tenantId}`, seed),
    );

    const body = await ingress.getVariantTable('service_anniversary_badge');
    expect(body).not.toBeNull();
    const rows = body!.rows;
    expect(rows.length).toBe(3);

    const fiveYear = rows.find((r) => r.variantKey === '5-year');
    expect(fiveYear).toBeDefined();
    const yos = fiveYear!.values['years_of_service']?.normalized;
    expect(yos).toBe(5);
    await ingress.close();
  });

  test('test_variant_table_filter_narrows', async () => {
    const { ingress, tenantId, principalId } = await makeIngress('cat-flt');
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
    const a = await makeIngress('cat-iso-a');
    const b = await makeIngress('cat-iso-b');
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
    const { ingress, tenantId, principalId } = await makeIngress('cat-rb');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-rb-${tenantId}`, seed),
    );

    const before = await ingress.getVariantTable('service_anniversary_badge');
    expect(before).not.toBeNull();
    const beforeRows = canonicalizeVariantRows(before!.rows);

    // Bump version → fresh seed-applied event with new idempotency key, projections rebuild.
    const bumped = { ...seed, version: `rebuild-${tenantId}` };
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-rb2-${tenantId}`, bumped),
    );

    const after = await ingress.getVariantTable('service_anniversary_badge');
    expect(after).not.toBeNull();
    const afterRows = canonicalizeVariantRows(after!.rows);
    expect(afterRows).toEqual(beforeRows);
    await ingress.close();
  });

  test('test_seed_event_has_cache_invalidation_tags', async () => {
    const { ingress, tenantId, principalId } = await makeIngress('cat-tag');
    const seed = loadBadgeFamilySeed();
    const idem = `itest-tag-${tenantId}`;
    const intent = buildSeedIntent(tenantId, principalId, idem, seed);
    const r1 = await ingress.submitIntent(intent);

    // The taxonomy nav must be available — proves event tags didn't crash dispatch.
    const tax = await ingress.getTaxonomyNodes('recognition');
    expect(tax).not.toBeNull();

    // Dive into the event store — the appended envelope must carry the right tags.
    const stored = await readEventTags(ingress, r1.eventId);
    expect(stored).not.toBeNull();
    expect(stored!).toContain(`Tenant:${tenantId}`);
    expect(stored!).toContain('TaxonomyTree:recognition');
    expect(stored!).toContain('SearchIndex:catalog');
    await ingress.close();
  });
});

describe('catalog_search parity', () => {
  test('test_search_returns_family_for_anniversary', async () => {
    const { ingress, tenantId, principalId } = await makeIngress('cs-fam');
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
    const { ingress, tenantId, principalId } = await makeIngress('cs-var');
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
    const a = await makeIngress('cs-iso-a');
    const b = await makeIngress('cs-iso-b');
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
    const { ingress, tenantId, principalId } = await makeIngress('cs-typ');
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
    const { ingress, tenantId, principalId } = await makeIngress('cs-rnk');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-rnk-${tenantId}`, seed),
    );

    const body = await ingress.searchCatalog({ q: 'anniversary' });
    expect(body.results.length).toBeGreaterThanOrEqual(2);
    const scores = body.results.map((r) => r.score);
    for (let i = 0; i < scores.length - 1; i++) {
      const a = scores[i] ?? 0;
      const b = scores[i + 1] ?? 0;
      expect(a).toBeGreaterThanOrEqual(b);
    }
    expect(body.results[0]!.documentType).toBe('family');
    await ingress.close();
  });

  test('test_search_permission_filter_excludes_disallowed', async () => {
    const { ingress, tenantId, principalId } = await makeIngress('cs-perm');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-perm-${tenantId}`, seed),
    );

    // Index a restricted doc directly via the search engine port (debug path equivalent).
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
    await indexDirect(ingress, restricted);

    const body = await ingress.searchCatalog({ q: 'anniversary' });
    expect(
      body.results.some((r) => r.documentId === 'alice_only_anniversary'),
    ).toBe(false);

    // Alice can see her doc — open a new ingress with her principal on the same tenant.
    const aliceIngress = await createSimIngress({
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
    const { ingress, tenantId, principalId } = await makeIngress('cs-rb');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-rb-${tenantId}`, seed),
    );

    const before = await ingress.searchCatalog({ q: 'anniversary' });
    expect(before.results.length).toBeGreaterThan(0);
    const beforeCount = before.results.length;

    // Truncate search documents directly via internal db, mimicking the SQL DELETE in the Rust test.
    await truncateSearch(ingress, tenantId);
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
    const { ingress, tenantId, principalId } = await makeIngress('cs-cache');
    const seed = loadBadgeFamilySeed();
    const r = await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cs-cache-${tenantId}`, seed),
    );

    const tags = await readEventTags(ingress, r.eventId);
    expect(tags).not.toBeNull();
    expect(tags!).toContain('SearchIndex:catalog');

    const body = await ingress.searchCatalog({ q: 'anniversary' });
    expect(body.results.length).toBeGreaterThan(0);
    await ingress.close();
  });
});

// helpers ---------------------------------------------------------------

function canonicalizeVariantRows(
  rows: ReadonlyArray<VariantRow>,
): Array<{ key: string; values: Record<string, unknown> }> {
  return rows
    .map((r) => ({
      key: r.variantKey,
      values: { ...r.values },
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

async function readEventTags(
  ingress: SimIngress,
  eventId: string,
): Promise<string[] | null> {
  const ev = await ingress.__db.get('events', eventId);
  return ev?.cacheInvalidationTags ?? null;
}

async function truncateSearch(ingress: SimIngress, tenantId: string): Promise<void> {
  const tx = ingress.__db.transaction('search_documents', 'readwrite');
  const idx = tx.objectStore('search_documents').index('by_tenant_type');
  let cursor = await idx.openCursor(IDBKeyRange.bound([tenantId, ''], [tenantId, '￿']));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

async function indexDirect(
  ingress: SimIngress,
  doc: SearchDocument,
): Promise<void> {
  await ingress.__search.index(doc);
}

void newEventId; // keep symbol used so tree-shaking doesn't drop helper
