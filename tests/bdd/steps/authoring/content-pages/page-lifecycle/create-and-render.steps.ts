import { expect, type Page } from '@playwright/test';
import { Given, When, Then } from '../../../../support/fixtures.ts';
import { submitIntent } from '../../../../support/idb-probe.ts';
import type { IntentEnvelope } from '@atlas/platform-core';
import { newEventId } from '@atlas/catalog';
import { assertDefined } from '@atlas/test-fixtures/assert';

// ---------------- Domain shapes (mirrors of @atlas/content-pages types) --------
//
// The action surface (`window.__atlas.getContentPage` etc.) returns
// `unknown` to keep the harness package decoupled from module types.
// We re-declare the minimal shapes here so step assertions stay typed.

type PageStatus = 'draft' | 'published' | 'archived';

interface PageDocumentLike {
  pageId: string;
  tenantId: string;
  title: string;
  slug: string;
  status: PageStatus;
  createdAt: string;
  updatedAt: string;
}

interface PageSummaryLike {
  pageId: string;
  title: string;
  slug: string;
  status: PageStatus;
  updatedAt: string;
}

interface RenderNodeLike {
  type: string;
  props?: Record<string, string | number | boolean | null>;
  children?: RenderNodeLike[];
}

interface RenderTreeLike {
  version: 1;
  nodes: RenderNodeLike[];
}

// ---------------- Typed window readers ----------------
//
// The action surface (`window.__atlas.*`) returns `Promise<unknown>` to
// keep the sim's harness types decoupled from module-internal shapes. We
// pin the shape here once, at the boundary, with localized eslint-disable
// comments — same pattern used in `apps/authoring/tests/page-editor.test.ts`.

async function readContentPage(
  page: Page,
  pageId: string,
): Promise<PageDocumentLike | null> {
  const raw = await page.evaluate((id) => {
    const action = window.__atlas;
    if (!action) throw new Error('window.__atlas is not mounted — non-BDD build?');
    return action.getContentPage(id);
  }, pageId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: window.__atlas.getContentPage returns Promise<unknown>; PageDocumentLike is contract-pinned by the content-pages module (see modules/content-pages/src/queries).
  return raw as PageDocumentLike | null;
}

async function readContentPageRenderTree(
  page: Page,
  pageId: string,
): Promise<RenderTreeLike | null> {
  const raw = await page.evaluate((id) => {
    const action = window.__atlas;
    if (!action) throw new Error('window.__atlas is not mounted — non-BDD build?');
    return action.getContentPageRenderTree(id);
  }, pageId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: window.__atlas.getContentPageRenderTree returns Promise<unknown>; RenderTreeLike is contract-pinned by the content-pages render-tree projection.
  return raw as RenderTreeLike | null;
}

async function readContentPageList(page: Page): Promise<PageSummaryLike[]> {
  const raw = await page.evaluate(() => {
    const action = window.__atlas;
    if (!action) throw new Error('window.__atlas is not mounted — non-BDD build?');
    return action.listContentPages();
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: window.__atlas.listContentPages returns Promise<unknown>; PageSummaryLike[] is contract-pinned by the content-pages listing query.
  return raw as PageSummaryLike[];
}

// ---------------- Envelope builders ----------------

function buildPageCreateEnvelope(opts: {
  tenantId: string;
  principalId: string;
  pageId: string;
  title: string;
  slug: string;
  idempotencyKey: string;
  correlationId: string;
}): IntentEnvelope {
  return {
    eventId: newEventId(),
    eventType: 'ContentPages.PageCreateRequested',
    schemaId: 'content_pages.page.create.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: opts.tenantId,
    correlationId: opts.correlationId,
    idempotencyKey: opts.idempotencyKey,
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

function buildPageUpdateEnvelope(opts: {
  tenantId: string;
  principalId: string;
  pageId: string;
  title: string;
  idempotencyKey: string;
  correlationId: string;
}): IntentEnvelope {
  return {
    eventId: newEventId(),
    eventType: 'ContentPages.PageUpdateRequested',
    schemaId: 'content_pages.page.update.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: opts.tenantId,
    correlationId: opts.correlationId,
    idempotencyKey: opts.idempotencyKey,
    principalId: opts.principalId,
    userId: opts.principalId,
    payload: {
      actionId: 'ContentPages.Page.Update',
      resourceType: 'Page',
      resourceId: opts.pageId,
      pageId: opts.pageId,
      title: opts.title,
    },
  };
}

function buildPageDeleteEnvelope(opts: {
  tenantId: string;
  principalId: string;
  pageId: string;
  idempotencyKey: string;
  correlationId: string;
}): IntentEnvelope {
  return {
    eventId: newEventId(),
    eventType: 'ContentPages.PageDeleteRequested',
    schemaId: 'content_pages.page.delete.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: opts.tenantId,
    correlationId: opts.correlationId,
    idempotencyKey: opts.idempotencyKey,
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

function uniqueIdem(prefix: string): string {
  return `bdd-${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// ---------------- Background ----------------

Given(
  'a tenant {string} with the content-pages module enabled',
  async ({ world, tenantId }, alias: string) => {
    world.tenantsByAlias.set(alias, tenantId);
    world.primaryTenantAlias = alias;
  },
);

// `Given the admin is authenticated as a principal with role <string>` is
// defined in tests/bdd/steps/common/common.steps.ts (used by both the
// catalog family-publish and authoring page-lifecycle scenarios).

// ---------------- Create ----------------

When(
  'the admin creates a page {string} with title {string} and slug {string}',
  async (
    { simPage, world, tenantId, principalId },
    pageId: string,
    title: string,
    slug: string,
  ) => {
    const correlationId = newEventId();
    const idempotencyKey = uniqueIdem(`page-create-${pageId}`);
    const envelope = buildPageCreateEnvelope({
      tenantId,
      principalId,
      pageId,
      title,
      slug,
      idempotencyKey,
      correlationId,
    });
    world.lastEnvelope = envelope;
    world.lastCorrelationId = correlationId;
    world.lastIdempotencyKey = idempotencyKey;
    const response = await submitIntent(simPage, envelope);
    world.lastSubmitOk = { ok: true, eventId: response.eventId };
    world.lastSubmitFailure = null;
  },
);

Given(
  'the admin has created a page {string} with title {string} and slug {string}',
  async (
    { simPage, world, tenantId, principalId },
    pageId: string,
    title: string,
    slug: string,
  ) => {
    const correlationId = newEventId();
    const idempotencyKey = uniqueIdem(`page-create-${pageId}`);
    const envelope = buildPageCreateEnvelope({
      tenantId,
      principalId,
      pageId,
      title,
      slug,
      idempotencyKey,
      correlationId,
    });
    world.lastEnvelope = envelope;
    world.lastCorrelationId = correlationId;
    world.lastIdempotencyKey = idempotencyKey;
    const response = await submitIntent(simPage, envelope);
    world.lastSubmitOk = { ok: true, eventId: response.eventId };
    world.lastSubmitFailure = null;
  },
);

// ---------------- Update ----------------

When(
  'the admin updates page {string} to title {string}',
  async (
    { simPage, world, tenantId, principalId },
    pageId: string,
    title: string,
  ) => {
    // Capture the prior createdAt so the "updatedAt is later than createdAt"
    // assertion can compare against it. Stash in lastQueryResponse so we
    // don't bloat the world shape.
    const before = await readContentPage(simPage, pageId);
    world.lastQueryResponse = before;

    const correlationId = newEventId();
    const idempotencyKey = uniqueIdem(`page-update-${pageId}`);
    const envelope = buildPageUpdateEnvelope({
      tenantId,
      principalId,
      pageId,
      title,
      idempotencyKey,
      correlationId,
    });
    world.lastEnvelope = envelope;
    world.lastCorrelationId = correlationId;
    world.lastIdempotencyKey = idempotencyKey;
    const response = await submitIntent(simPage, envelope);
    world.lastSubmitOk = { ok: true, eventId: response.eventId };
    world.lastSubmitFailure = null;
  },
);

// ---------------- Delete ----------------

When(
  'the admin deletes page {string}',
  async ({ simPage, world, tenantId, principalId }, pageId: string) => {
    const correlationId = newEventId();
    const idempotencyKey = uniqueIdem(`page-delete-${pageId}`);
    const envelope = buildPageDeleteEnvelope({
      tenantId,
      principalId,
      pageId,
      idempotencyKey,
      correlationId,
    });
    world.lastEnvelope = envelope;
    world.lastCorrelationId = correlationId;
    world.lastIdempotencyKey = idempotencyKey;
    const response = await submitIntent(simPage, envelope);
    world.lastSubmitOk = { ok: true, eventId: response.eventId };
    world.lastSubmitFailure = null;
  },
);

// ---------------- Listing ----------------

When('the admin lists all pages', async ({ simPage, world }) => {
  world.lastQueryResponse = await readContentPageList(simPage);
});

// ---------------- Assertions ----------------

Then(
  'the page {string} exists with title {string} and status {string}',
  async (
    { simPage },
    pageId: string,
    expectedTitle: string,
    expectedStatus: string,
  ) => {
    const maybeDoc = await readContentPage(simPage, pageId);
    expect(maybeDoc).not.toBeNull();
    const doc = assertDefined(maybeDoc, `content page ${pageId} after assert non-null`);
    expect(doc.pageId).toBe(pageId);
    expect(doc.title).toBe(expectedTitle);
    expect(doc.status).toBe(expectedStatus);
  },
);

Then(
  'the render tree for page {string} is the default tree',
  async ({ simPage }, pageId: string) => {
    const maybeTree = await readContentPageRenderTree(simPage, pageId);
    expect(maybeTree).not.toBeNull();
    const tree = assertDefined(maybeTree, `render tree for ${pageId} after assert non-null`);
    expect(tree.version).toBe(1);
    expect(Array.isArray(tree.nodes)).toBe(true);
    expect(tree.nodes.length).toBeGreaterThan(0);
  },
);

Then(
  'the listing contains a page with id {string} titled {string}',
  async ({ world }, pageId: string, expectedTitle: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: world.lastQueryResponse is `unknown` by design; the preceding `When the admin lists all pages` step stashes PageSummaryLike[] here.
    const list = world.lastQueryResponse as PageSummaryLike[] | null;
    expect(Array.isArray(list)).toBe(true);
    const match = (list ?? []).find((p) => p.pageId === pageId);
    expect(match, `expected page ${pageId} in listing`).toBeDefined();
    const found = assertDefined(match, `page ${pageId} in listing after expect-defined`);
    expect(found.title).toBe(expectedTitle);
  },
);

Then(
  'the listing does not contain a page with id {string}',
  async ({ simPage }, pageId: string) => {
    const list = await readContentPageList(simPage);
    expect(Array.isArray(list)).toBe(true);
    const match = list.find((p) => p.pageId === pageId);
    expect(match, `did not expect page ${pageId} in listing`).toBeUndefined();
  },
);

Then(
  'the page {string} has title {string}',
  async ({ simPage }, pageId: string, expectedTitle: string) => {
    const maybeDoc = await readContentPage(simPage, pageId);
    expect(maybeDoc).not.toBeNull();
    const doc = assertDefined(maybeDoc, `content page ${pageId} after assert non-null`);
    expect(doc.title).toBe(expectedTitle);
  },
);

Then(
  'the page {string} updatedAt is later than its createdAt',
  async ({ simPage }, pageId: string) => {
    const maybeDoc = await readContentPage(simPage, pageId);
    expect(maybeDoc).not.toBeNull();
    const doc = assertDefined(maybeDoc, `content page ${pageId} after assert non-null`);
    // The handler stamps both timestamps as ISO strings — lexicographic
    // compare matches chronological order.
    expect(doc.updatedAt > doc.createdAt).toBe(true);
  },
);

Then('the page {string} is null', async ({ simPage }, pageId: string) => {
  const doc = await readContentPage(simPage, pageId);
  expect(doc).toBeNull();
});
