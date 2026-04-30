/**
 * Content-pages parity scenarios (sim mode).
 *
 * Mirrors the Rust black-box `render_tree_test.rs` + `persistence_test.rs`
 * suites, plus a couple of TS-only scenarios for create/update/delete and
 * cross-tenant isolation.
 */

import { describe, test, expect } from 'vitest';
import { makeSimIngress } from './lib/sim-factory.ts';
import { uniqueIdempotencyKey } from './lib/intent-fixtures.ts';
import { newEventId } from '@atlas/catalog';
import type { IntentEnvelope } from '@atlas/platform-core';

function buildPageCreateIntent(opts: {
  tenantId: string;
  principalId: string;
  pageId: string;
  title: string;
  slug: string;
  idempotencyKey?: string;
}): IntentEnvelope {
  return {
    eventId: newEventId(),
    eventType: 'ContentPages.PageCreateRequested',
    schemaId: 'content_pages.page.create.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: opts.tenantId,
    correlationId: newEventId(),
    idempotencyKey:
      opts.idempotencyKey ?? uniqueIdempotencyKey(`itest-page-${opts.pageId}`),
    principalId: opts.principalId,
    userId: opts.principalId,
    payload: {
      actionId: 'ContentPages.Page.Create',
      resourceType: 'Page',
      resourceId: opts.pageId,
      pageId: opts.pageId,
      title: opts.title,
      slug: opts.slug,
    },
  };
}

function buildPageDeleteIntent(opts: {
  tenantId: string;
  principalId: string;
  pageId: string;
}): IntentEnvelope {
  return {
    eventId: newEventId(),
    eventType: 'ContentPages.PageDeleteRequested',
    schemaId: 'content_pages.page.delete.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: opts.tenantId,
    correlationId: newEventId(),
    idempotencyKey: uniqueIdempotencyKey(`itest-page-del-${opts.pageId}`),
    principalId: opts.principalId,
    userId: opts.principalId,
    payload: {
      actionId: 'ContentPages.Page.Delete',
      resourceType: 'Page',
      resourceId: opts.pageId,
      pageId: opts.pageId,
    },
  };
}

describe('[sim] content-pages parity', () => {
  test('test_page_create_persists_document_and_render_tree', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('cp-create');
    await ingress.submitIntent(
      buildPageCreateIntent({
        tenantId,
        principalId,
        pageId: 'welcome',
        title: 'Welcome',
        slug: 'welcome',
      }),
    );

    const doc = await ingress.getContentPage('welcome');
    expect(doc).not.toBeNull();
    expect(doc?.title).toBe('Welcome');
    expect(doc?.status).toBe('draft');

    const tree = await ingress.getContentPageRenderTree('welcome');
    expect(tree).not.toBeNull();
    expect(tree?.version).toBe(1);
    expect(tree?.nodes.length).toBeGreaterThan(0);
    await ingress.close();
  });

  test('test_render_tree_is_default_shape', async () => {
    // Mirrors `render_tree_test.rs::test_render_tree_default_shape`.
    const { ingress, tenantId, principalId } = await makeSimIngress('cp-rt');
    await ingress.submitIntent(
      buildPageCreateIntent({
        tenantId,
        principalId,
        pageId: 'about',
        title: 'About',
        slug: 'about',
      }),
    );
    const tree = await ingress.getContentPageRenderTree('about');
    expect(tree).not.toBeNull();
    expect(tree).toEqual({
      version: 1,
      nodes: [
        {
          type: 'heading',
          props: { level: 1 },
          children: [{ type: 'text', props: { content: 'About' } }],
        },
        {
          type: 'paragraph',
          children: [{ type: 'text', props: { content: '/about' } }],
        },
      ],
    });
    await ingress.close();
  });

  test('test_render_tree_survives_fast_path_clear', async () => {
    // Mirrors `persistence_test.rs::test_render_tree_persists_across_cache_clear`.
    const { ingress, tenantId, principalId } = await makeSimIngress('cp-pers');
    await ingress.submitIntent(
      buildPageCreateIntent({
        tenantId,
        principalId,
        pageId: 'persist',
        title: 'Persist',
        slug: 'persist',
      }),
    );
    const before = await ingress.getContentPageRenderTree('persist');
    expect(before).not.toBeNull();

    // Clear the in-memory projection; the durable RenderTreeStore must
    // serve the next read.
    await ingress.clearRenderTreeFastPath('persist');

    const after = await ingress.getContentPageRenderTree('persist');
    expect(after).toEqual(before);
    await ingress.close();
  });

  test('test_page_list_contains_created_page', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('cp-list');
    await ingress.submitIntent(
      buildPageCreateIntent({
        tenantId,
        principalId,
        pageId: 'a',
        title: 'A',
        slug: 'a',
      }),
    );
    await ingress.submitIntent(
      buildPageCreateIntent({
        tenantId,
        principalId,
        pageId: 'b',
        title: 'B',
        slug: 'b',
      }),
    );
    const list = await ingress.listContentPages();
    const ids = list.map((p) => p.pageId).sort();
    expect(ids).toEqual(['a', 'b']);
    await ingress.close();
  });

  test('test_page_delete_clears_document_and_render_tree', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('cp-del');
    await ingress.submitIntent(
      buildPageCreateIntent({
        tenantId,
        principalId,
        pageId: 'gone',
        title: 'Gone',
        slug: 'gone',
      }),
    );
    expect(await ingress.getContentPage('gone')).not.toBeNull();
    expect(await ingress.getContentPageRenderTree('gone')).not.toBeNull();

    await ingress.submitIntent(
      buildPageDeleteIntent({ tenantId, principalId, pageId: 'gone' }),
    );

    expect(await ingress.getContentPage('gone')).toBeNull();
    expect(await ingress.getContentPageRenderTree('gone')).toBeNull();
    expect(await ingress.listContentPages()).toEqual([]);
    await ingress.close();
  });

  test('test_page_tenant_isolation', async () => {
    const a = await makeSimIngress('cp-iso-a');
    const b = await makeSimIngress('cp-iso-b');
    await a.ingress.submitIntent(
      buildPageCreateIntent({
        tenantId: a.tenantId,
        principalId: a.principalId,
        pageId: 'shared',
        title: 'A',
        slug: 'a',
      }),
    );

    expect(await b.ingress.getContentPage('shared')).toBeNull();
    expect(await b.ingress.getContentPageRenderTree('shared')).toBeNull();
    await a.ingress.close();
    await b.ingress.close();
  });

  test('test_page_create_event_has_cache_invalidation_tags', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('cp-tag');
    const r = await ingress.submitIntent(
      buildPageCreateIntent({
        tenantId,
        principalId,
        pageId: 'tagged',
        title: 'Tagged',
        slug: 'tagged',
      }),
    );
    const tags = await ingress.readEventTags(r.eventId);
    expect(tags).not.toBeNull();
    expect(tags!).toContain(`Tenant:${tenantId}`);
    expect(tags!).toContain('Page:tagged');
    await ingress.close();
  });
});
