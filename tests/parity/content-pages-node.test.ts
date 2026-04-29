/**
 * Node-mode parity for content-pages.
 *
 * Mirrors the sim suite, sans the `clearRenderTreeFastPath` / read-event-tags
 * scenarios which depend on sim-only escape hatches. Skipped silently
 * when `NODE_PARITY_BASE_URL` is unset.
 */

import { describe, test, expect } from 'vitest';
import { makeServerIngress } from './lib/server-factory.ts';
import { uniqueIdempotencyKey } from './lib/intent-fixtures.ts';
import { newEventId } from '@atlas/modules-catalog';
import type { IntentEnvelope } from '@atlas/platform-core';

const baseUrl = process.env['NODE_PARITY_BASE_URL'];
const d = baseUrl ? describe : describe.skip;

function buildPageCreateIntent(opts: {
  tenantId: string;
  principalId: string;
  pageId: string;
  title: string;
  slug: string;
}): IntentEnvelope {
  return {
    eventId: newEventId(),
    eventType: 'ContentPages.PageCreateRequested',
    schemaId: 'content_pages.page.create.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: opts.tenantId,
    correlationId: newEventId(),
    idempotencyKey: uniqueIdempotencyKey(`itest-page-${opts.pageId}`),
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

d('[node] content-pages parity', () => {
  test('test_page_create_persists_document_and_render_tree', async () => {
    const { ingress, tenantId, principalId } =
      await makeServerIngress('cp-create');
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

    const tree = await ingress.getContentPageRenderTree('welcome');
    expect(tree).not.toBeNull();
    expect(tree?.version).toBe(1);
    await ingress.close();
  });

  test('test_render_tree_is_default_shape', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cp-rt');
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

  test('test_page_list_contains_created_page', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cp-list');
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
    const { ingress, tenantId, principalId } = await makeServerIngress('cp-del');
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
    const a = await makeServerIngress('cp-iso-a');
    const b = await makeServerIngress('cp-iso-b');
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
});
