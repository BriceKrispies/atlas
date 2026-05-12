/**
 * Headless dry-run: exercises the page-templates contract end-to-end in a
 * linkedom DOM. Exits 0 with "OK" on success, 1 with a diagnostic on
 * failure. Invoked via `pnpm --filter @atlas/page-templates dry-run`.
 */

import { customElements, document, HTMLElementCtor, loadFixture } from './_lib/setup.ts';
import { must } from '../src/internal/assert.ts';

// ---- import the package under test (registers <content-page>) --------
const pkg = await import('../src/index.ts');
const {
  TemplateRegistry,
  moduleDefaultTemplateRegistry,
  validateTemplateManifest,
  validatePageDocument,
  InMemoryPageStore,
  ValidatingPageStore,
  PageDocumentError,
  PageTemplateError,
} = pkg;
import type { PageDocument } from '../src/page-store.ts';
import type { TemplateManifest } from '../src/registry.ts';

const { WidgetRegistry } = await import('@atlas/widget-host');
import type { WidgetManifest } from '@atlas/widget-host';

// ---- load fixtures ---------------------------------------------------

const templateOneColumn = loadFixture<TemplateManifest>('page_template__valid__one_column.json');
const templateTwoColumn = loadFixture<TemplateManifest>('page_template__valid__two_column.json');
const templateNoRegions = loadFixture<TemplateManifest>('page_template__invalid__no_regions.json');
const docWelcome = loadFixture<PageDocument>('page_document__valid__welcome.json');
const docRoundTrip = loadFixture<PageDocument>('page_document__valid__backend_round_trip.json');
const docMissingTemplate = loadFixture<PageDocument>('page_document__invalid__missing_template.json');
const announcementsManifest = loadFixture<Record<string, unknown>>('widget_manifest__valid__announcements.json');

// ---- utilities -------------------------------------------------------

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    throw new Error(`assertion failed: ${msg}`);
  }
}

async function waitMicrotasks(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
}

function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(sortedStringify).join(',') + ']';
  }
  // `value` is `object` here; widening to a string-keyed record is safe.
  const obj: Record<string, unknown> = value as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- boundary: TS narrows non-array `object` to plain `object`; reading own string keys is structurally safe.
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + sortedStringify(obj[k]))
      .join(',') +
    '}'
  );
}

function hasErrorBox(node: Element | null): boolean {
  const walk = (el: Element | null): boolean => {
    if (!el) return false;
    if (el.getAttribute('name') === 'content-page-error') {
      return true;
    }
    for (const child of el.children) {
      if (walk(child)) return true;
    }
    return false;
  };
  return walk(node);
}

function findDescendant(
  node: Element | null,
  predicate: (el: Element) => boolean,
): Element | null {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = findDescendant(child, predicate);
    if (found) return found;
  }
  return null;
}

// ---- stub template classes ------------------------------------------
// linkedom requires HTMLElement subclasses to be registered before `new`.
class OneColumnTemplate extends HTMLElementCtor {
  _mounted = false;
  connectedCallback(): void {
    this._mounted = true;
  }
}
customElements.define('tpl-one-column', OneColumnTemplate);

class TwoColumnTemplate extends HTMLElementCtor {
  _mounted = false;
  connectedCallback(): void {
    this._mounted = true;
  }
}
customElements.define('tpl-two-column', TwoColumnTemplate);

// Stub widget class, minimal — exists only so <widget-host> can instantiate it.
class AnnouncementsWidget extends HTMLElementCtor {
  _mounted = false;
  connectedCallback(): void {
    this._mounted = true;
  }
}
customElements.define('stub-announcements-widget', AnnouncementsWidget);

// ---- tests ----------------------------------------------------------

async function testManifestValidation(): Promise<void> {
  const good = validateTemplateManifest(templateOneColumn);
  const goodErrs = good.ok ? undefined : good.errors;
  assert(good.ok, `one-column manifest should validate, got ${JSON.stringify(goodErrs)}`);

  const bad = validateTemplateManifest(templateNoRegions);
  assert(bad.ok === false, 'no-regions manifest must fail validation');
  if (!bad.ok) {
    assert(bad.errors.length > 0, 'no-regions manifest must carry at least one error');
  }
}

async function testDocumentValidation(): Promise<void> {
  const good = validatePageDocument(docWelcome);
  const goodErrs = good.ok ? undefined : good.errors;
  assert(good.ok, `welcome doc should validate, got ${JSON.stringify(goodErrs)}`);

  const bad = validatePageDocument(docMissingTemplate);
  assert(bad.ok === false, 'missing-template doc must fail validation');
  if (!bad.ok) {
    assert(bad.errors.length > 0, 'missing-template doc must carry errors');
  }
}

async function testRoundTripByteEquivalence(): Promise<void> {
  const store = new InMemoryPageStore();
  const before = structuredClone(docRoundTrip);
  await store.save(before.pageId, before);
  const after = must(await store.get(before.pageId), 'just saved, must be retrievable');
  const beforeStr = sortedStringify(before);
  const afterStr = sortedStringify(after);
  assert(
    beforeStr === afterStr,
    `round-trip byte-equivalence failed:\n  before=${beforeStr}\n  after =${afterStr}`,
  );

  // Mutating the returned doc MUST NOT affect store contents.
  after.tenantId = 'mutated';
  const fresh = must(await store.get(before.pageId), 'still retrievable');
  assert(
    fresh.tenantId === before.tenantId,
    'returned doc must not share identity with stored doc',
  );
}

async function testValidatingPageStoreRejectsInvalid(): Promise<void> {
  const store = new ValidatingPageStore(new InMemoryPageStore());
  let caught: unknown = null;
  try {
    await store.save('broken', docMissingTemplate);
  } catch (err) {
    caught = err;
  }
  assert(
    caught instanceof PageDocumentError,
    `expected PageDocumentError, got ${String(caught)}`,
  );
  if (caught instanceof PageDocumentError) {
    const details = caught.details;
    const errors =
      details && typeof details === 'object' && 'errors' in details
        ? (details as { errors?: unknown }).errors
        : undefined;
    assert(
      Array.isArray(errors) && errors.length > 0,
      'PageDocumentError must carry ajv errors in details.errors',
    );
  }

  // Valid save round-trips through the decorator.
  await store.save(docWelcome.pageId, docWelcome);
  const back = await store.get(docWelcome.pageId);
  assert(
    back !== null && back.pageId === docWelcome.pageId,
    'ValidatingPageStore should round-trip a valid doc',
  );
}

async function testTemplateRegistryRoundTrip(): Promise<void> {
  const reg = new TemplateRegistry();
  reg.register({ manifest: templateOneColumn, element: OneColumnTemplate });
  assert(reg.has(templateOneColumn.templateId), 'registry.has after register');
  const entry = reg.get(templateOneColumn.templateId);
  assert(entry.element === OneColumnTemplate, 'registry.get returns registered element');
  assert(
    entry.manifest.templateId === templateOneColumn.templateId,
    'registry.get returns registered manifest',
  );
  const list = reg.list();
  const first = must(list[0], 'list has at least one entry');
  assert(
    list.length === 1 && first.templateId === templateOneColumn.templateId,
    `registry.list should yield one entry, got ${JSON.stringify(list)}`,
  );

  // Unknown lookup throws.
  let threw: unknown = null;
  try {
    reg.get('template.nope');
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof PageTemplateError, 'unknown get must throw PageTemplateError');

  // Invalid manifest rejected at register time.
  let regThrew: unknown = null;
  try {
    reg.register({ manifest: templateNoRegions, element: OneColumnTemplate });
  } catch (err) {
    regThrew = err;
  }
  assert(
    regThrew instanceof PageTemplateError,
    'invalid manifest must be rejected by register',
  );

  // moduleDefaultTemplateRegistry is a distinct instance.
  assert(
    !moduleDefaultTemplateRegistry.has(templateOneColumn.templateId),
    'moduleDefaultTemplateRegistry should be empty',
  );
}

function makeWelcomeStore(): InstanceType<typeof InMemoryPageStore> {
  const store = new InMemoryPageStore();
  // seed a cloned copy so later tests can mutate their own fixture freely
  store._docs.set(docWelcome.pageId, structuredClone(docWelcome));
  return store;
}

function makeWidgetRegistry(): InstanceType<typeof WidgetRegistry> {
  const wr = new WidgetRegistry();
  // The spec fixture carries $schema/$comment/$invariants for discoverability;
  // the runtime schema rejects unknown properties, so strip them here.
  const clean: Record<string, unknown> = { ...announcementsManifest };
  delete clean['$schema'];
  delete clean['$comment'];
  delete clean['$invariants'];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: the fixture is a schema-validated WidgetManifest with documentation-only `$schema/$comment/$invariants` keys stripped; what remains satisfies WidgetManifest. WidgetRegistry.register re-validates at runtime.
  wr.register({ manifest: clean as WidgetManifest, element: AnnouncementsWidget });
  return wr;
}

function makeTemplateRegistry(): InstanceType<typeof TemplateRegistry> {
  const tr = new TemplateRegistry();
  tr.register({ manifest: templateOneColumn, element: OneColumnTemplate });
  tr.register({ manifest: templateTwoColumn, element: TwoColumnTemplate });
  return tr;
}

// Shape of <content-page> the dry-run pokes properties on.
type ContentPageEl = HTMLElement & {
  pageId?: string;
  pageStore?: unknown;
  templateRegistry?: unknown;
  widgetRegistry?: unknown;
  principal?: unknown;
  tenantId?: string;
  correlationId?: string;
};

// Shape of <widget-host> the dry-run reads.
type WidgetHostEl = Element & {
  layout?: { version: number; slots: Record<string, unknown[]> };
};

async function testContentPageHappyPath(): Promise<void> {
  const pageStore = makeWelcomeStore();
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page') as ContentPageEl;
  page.pageId = docWelcome.pageId;
  page.pageStore = pageStore;
  page.templateRegistry = templateRegistry;
  page.widgetRegistry = widgetRegistry;
  page.principal = { id: 'u_test', roles: [] };
  page.tenantId = 't_test';
  page.correlationId = 'cid-dry-run-happy';
  document.body.appendChild(page);

  await waitMicrotasks(30);

  assert(
    !hasErrorBox(page),
    `happy-path: content-page should not render an error box, got: ${page.textContent}`,
  );

  const template = findDescendant(
    page,
    (el) => el instanceof TwoColumnTemplate,
  );
  assert(template, 'happy-path: two-column template element must be present');

  const host = findDescendant(
    page,
    (el) => el.tagName.toLowerCase() === 'widget-host',
  ) as WidgetHostEl | null;
  const hostEl = must(host, 'happy-path: <widget-host> must be present in the DOM');
  assert(
    hostEl.parentNode === template,
    '<widget-host> should be a child of the template element',
  );
  // Layout was forwarded correctly.
  const layout = must(hostEl.layout, 'widget-host should receive the forwarded layout');
  assert(layout.version === 1, 'widget-host should receive the forwarded layout');
  assert(
    Array.isArray(layout.slots['main']),
    'forwarded layout should carry the regions as slots',
  );

  page.remove();
  await waitMicrotasks(5);
}

async function testContentPageTemplateMissing(): Promise<void> {
  const pageStore = new InMemoryPageStore();
  const doc = structuredClone(docWelcome);
  doc.templateId = 'template.nonexistent';
  await pageStore.save(doc.pageId, doc);

  const templateRegistry = new TemplateRegistry();
  templateRegistry.register({ manifest: templateOneColumn, element: OneColumnTemplate });

  const page = document.createElement('content-page') as ContentPageEl;
  page.pageId = doc.pageId;
  page.pageStore = pageStore;
  page.templateRegistry = templateRegistry;
  page.widgetRegistry = makeWidgetRegistry();
  page.correlationId = 'cid-dry-run-missing';
  document.body.appendChild(page);

  await waitMicrotasks(20);

  assert(
    hasErrorBox(page),
    'template-missing: content-page must render an error box',
  );
  const host = findDescendant(
    page,
    (el) => el.tagName.toLowerCase() === 'widget-host',
  );
  assert(
    host === null,
    'template-missing: <widget-host> must NOT be mounted when template lookup fails',
  );

  page.remove();
  await waitMicrotasks(5);
}

async function testContentPageVersionAhead(): Promise<void> {
  const pageStore = new InMemoryPageStore();
  const doc = structuredClone(docWelcome);
  doc.templateVersion = '9.9.9';
  await pageStore.save(doc.pageId, doc);

  const oldTwoColumn = structuredClone(templateTwoColumn);
  oldTwoColumn.version = '0.1.0';
  const templateRegistry = new TemplateRegistry();
  templateRegistry.register({ manifest: oldTwoColumn, element: TwoColumnTemplate });

  const page = document.createElement('content-page') as ContentPageEl;
  page.pageId = doc.pageId;
  page.pageStore = pageStore;
  page.templateRegistry = templateRegistry;
  page.widgetRegistry = makeWidgetRegistry();
  page.correlationId = 'cid-dry-run-version';
  document.body.appendChild(page);

  await waitMicrotasks(20);

  assert(
    hasErrorBox(page),
    'version-ahead: content-page must render a fail-closed error box',
  );
  const host = findDescendant(
    page,
    (el) => el.tagName.toLowerCase() === 'widget-host',
  );
  assert(
    host === null,
    'version-ahead: <widget-host> must NOT be mounted when stored version is ahead',
  );

  page.remove();
  await waitMicrotasks(5);
}

async function main(): Promise<void> {
  await testManifestValidation();
  await testDocumentValidation();
  await testRoundTripByteEquivalence();
  await testValidatingPageStoreRejectsInvalid();
  await testTemplateRegistryRoundTrip();
  await testContentPageHappyPath();
  await testContentPageTemplateMissing();
  await testContentPageVersionAhead();

  console.log('OK');
}

main().catch((err: unknown) => {
  const stack = err instanceof Error ? err.stack : undefined;
  console.error('FAIL:', stack ?? err);
  process.exit(1);
});
