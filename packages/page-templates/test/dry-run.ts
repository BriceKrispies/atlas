/**
 * Headless dry-run: exercises the page-templates contract end-to-end in a
 * linkedom DOM. Exits 0 with "OK" on success, 1 with a diagnostic on
 * failure. Invoked via `pnpm --filter @atlas/page-templates dry-run`.
 */

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// --- set up a browser-ish global environment BEFORE importing packages
const dom = parseHTML(
  '<!doctype html><html><head></head><body></body></html>',
);
(globalThis as unknown as Record<string, unknown>)['window'] = dom.window;
(globalThis as unknown as Record<string, unknown>)['document'] = dom.document;
(globalThis as unknown as Record<string, unknown>)['HTMLElement'] = dom.HTMLElement;
(globalThis as unknown as Record<string, unknown>)['DocumentFragment'] = dom.DocumentFragment;
(globalThis as unknown as Record<string, unknown>)['customElements'] = dom.customElements;
(globalThis as unknown as Record<string, unknown>)['Node'] = dom.Node;
(globalThis as unknown as Record<string, unknown>)['NodeFilter'] = (dom as { NodeFilter?: unknown }).NodeFilter ?? {
  SHOW_ELEMENT: 1,
};
if (!globalThis.structuredClone) {
  globalThis.structuredClone = ((v: unknown) => JSON.parse(JSON.stringify(v))) as typeof structuredClone;
}

// linkedom does not implement createTreeWalker; add a tiny shim so
// @atlas/core's html tagged template can attach event bindings.
if (typeof globalThis.document.createTreeWalker !== 'function') {
  (globalThis.document as unknown as { createTreeWalker: (root: Element) => { nextNode: () => Element | null } }).createTreeWalker = (
    root: Element,
  ) => {
    const elements: Element[] = [];
    const walk = (el: Element): void => {
      elements.push(el);
      for (const child of (el.children as unknown as Iterable<Element>) ?? []) walk(child);
    };
    for (const child of (root.children as unknown as Iterable<Element>) ?? []) walk(child);
    let i = -1;
    return {
      nextNode(): Element | null {
        i += 1;
        return i < elements.length ? elements[i]! : null;
      },
    };
  };
}

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

const widgetHostPkg = await import('@atlas/widget-host');
const { WidgetRegistry } = widgetHostPkg as { WidgetRegistry: new () => { register: (args: { manifest: unknown; element: CustomElementConstructor }) => void } };

// ---- load fixtures ---------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../../specs/fixtures');
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(fixturesDir, name), 'utf8'));

const templateOneColumn = readFixture('page_template__valid__one_column.json') as Record<string, unknown>;
const templateTwoColumn = readFixture('page_template__valid__two_column.json') as Record<string, unknown>;
const templateNoRegions = readFixture('page_template__invalid__no_regions.json') as Record<string, unknown>;
const docWelcome = readFixture('page_document__valid__welcome.json') as Record<string, unknown>;
const docRoundTrip = readFixture('page_document__valid__backend_round_trip.json') as Record<string, unknown>;
const docMissingTemplate = readFixture('page_document__invalid__missing_template.json') as Record<string, unknown>;
const announcementsManifest = readFixture('widget_manifest__valid__announcements.json') as Record<string, unknown>;

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
  const obj = value as Record<string, unknown>;
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
    if (
      (el as { getAttribute?: (name: string) => string | null }).getAttribute &&
      el.getAttribute('name') === 'content-page-error'
    ) {
      return true;
    }
    for (const child of (el.children as unknown as Iterable<Element>) ?? []) {
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
  for (const child of (node.children as unknown as Iterable<Element>) ?? []) {
    const found = findDescendant(child, predicate);
    if (found) return found;
  }
  return null;
}

// ---- stub template classes ------------------------------------------
// linkedom requires HTMLElement subclasses to be registered before `new`.
class OneColumnTemplate extends (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement {
  _mounted = false;
  connectedCallback(): void {
    this._mounted = true;
  }
}
customElements.define('tpl-one-column', OneColumnTemplate);

class TwoColumnTemplate extends (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement {
  _mounted = false;
  connectedCallback(): void {
    this._mounted = true;
  }
}
customElements.define('tpl-two-column', TwoColumnTemplate);

// Stub widget class, minimal — exists only so <widget-host> can instantiate it.
class AnnouncementsWidget extends (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement {
  _mounted = false;
  connectedCallback(): void {
    this._mounted = true;
  }
}
customElements.define('stub-announcements-widget', AnnouncementsWidget);

// ---- tests ----------------------------------------------------------

async function testManifestValidation(): Promise<void> {
  const good = validateTemplateManifest(templateOneColumn);
  assert(good.ok === true, `one-column manifest should validate, got ${JSON.stringify(good.errors)}`);

  const bad = validateTemplateManifest(templateNoRegions);
  assert(bad.ok === false, 'no-regions manifest must fail validation');
  assert(
    bad.errors.length > 0,
    'no-regions manifest must carry at least one error',
  );
}

async function testDocumentValidation(): Promise<void> {
  const good = validatePageDocument(docWelcome);
  assert(good.ok === true, `welcome doc should validate, got ${JSON.stringify(good.errors)}`);

  const bad = validatePageDocument(docMissingTemplate);
  assert(bad.ok === false, 'missing-template doc must fail validation');
  assert(bad.errors.length > 0, 'missing-template doc must carry errors');
}

async function testRoundTripByteEquivalence(): Promise<void> {
  const store = new InMemoryPageStore();
  const before = structuredClone(docRoundTrip) as { pageId: string; tenantId?: string };
  await store.save(before.pageId, before as unknown as Parameters<typeof store.save>[1]);
  const after = await store.get(before.pageId);
  assert(after !== null, 'round-trip: get must return the saved doc');
  const beforeStr = sortedStringify(before);
  const afterStr = sortedStringify(after);
  assert(
    beforeStr === afterStr,
    `round-trip byte-equivalence failed:\n  before=${beforeStr}\n  after =${afterStr}`,
  );

  // Mutating the returned doc MUST NOT affect store contents.
  (after as { tenantId?: string })!.tenantId = 'mutated';
  const fresh = await store.get(before.pageId);
  assert(
    (fresh as { tenantId?: string })?.tenantId === before.tenantId,
    'returned doc must not share identity with stored doc',
  );
}

async function testValidatingPageStoreRejectsInvalid(): Promise<void> {
  const store = new ValidatingPageStore(new InMemoryPageStore());
  let caught: unknown = null;
  try {
    await store.save('broken', docMissingTemplate as unknown as Parameters<typeof store.save>[1]);
  } catch (err) {
    caught = err;
  }
  assert(
    caught instanceof PageDocumentError,
    `expected PageDocumentError, got ${caught}`,
  );
  const details = (caught as { details?: { errors?: unknown[] } } | null)?.details;
  assert(
    Array.isArray(details?.errors) && (details?.errors?.length ?? 0) > 0,
    'PageDocumentError must carry ajv errors in details.errors',
  );

  // Valid save round-trips through the decorator.
  await store.save((docWelcome as { pageId: string }).pageId, docWelcome as unknown as Parameters<typeof store.save>[1]);
  const back = await store.get((docWelcome as { pageId: string }).pageId);
  assert(
    back && (back as { pageId?: string }).pageId === (docWelcome as { pageId: string }).pageId,
    'ValidatingPageStore should round-trip a valid doc',
  );
}

async function testTemplateRegistryRoundTrip(): Promise<void> {
  const reg = new TemplateRegistry();
  reg.register({ manifest: templateOneColumn as never, element: OneColumnTemplate });
  assert(reg.has((templateOneColumn as { templateId: string }).templateId), 'registry.has after register');
  const entry = reg.get((templateOneColumn as { templateId: string }).templateId);
  assert(entry.element === OneColumnTemplate, 'registry.get returns registered element');
  assert(
    entry.manifest.templateId === (templateOneColumn as { templateId: string }).templateId,
    'registry.get returns registered manifest',
  );
  const list = reg.list();
  assert(
    list.length === 1 && list[0]!.templateId === (templateOneColumn as { templateId: string }).templateId,
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
    reg.register({ manifest: templateNoRegions as never, element: OneColumnTemplate });
  } catch (err) {
    regThrew = err;
  }
  assert(
    regThrew instanceof PageTemplateError,
    'invalid manifest must be rejected by register',
  );

  // moduleDefaultTemplateRegistry is a distinct instance.
  assert(
    !moduleDefaultTemplateRegistry.has((templateOneColumn as { templateId: string }).templateId),
    'moduleDefaultTemplateRegistry should be empty',
  );
}

function makeWelcomeStore(): InstanceType<typeof InMemoryPageStore> {
  const store = new InMemoryPageStore();
  // seed a cloned copy so later tests can mutate their own fixture freely
  store._docs.set((docWelcome as { pageId: string }).pageId, structuredClone(docWelcome) as never);
  return store;
}

function makeWidgetRegistry(): { register: (args: { manifest: unknown; element: CustomElementConstructor }) => void } {
  const wr = new WidgetRegistry();
  // The spec fixture carries $schema/$comment/$invariants for discoverability;
  // the runtime schema rejects unknown properties, so strip them here.
  const clean: Record<string, unknown> = { ...announcementsManifest };
  delete clean['$schema'];
  delete clean['$comment'];
  delete clean['$invariants'];
  wr.register({ manifest: clean, element: AnnouncementsWidget });
  return wr;
}

function makeTemplateRegistry(): InstanceType<typeof TemplateRegistry> {
  const tr = new TemplateRegistry();
  tr.register({ manifest: templateOneColumn as never, element: OneColumnTemplate });
  tr.register({ manifest: templateTwoColumn as never, element: TwoColumnTemplate });
  return tr;
}

async function testContentPageHappyPath(): Promise<void> {
  const pageStore = makeWelcomeStore();
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page') as HTMLElement & Record<string, unknown>;
  page['pageId'] = (docWelcome as { pageId: string }).pageId;
  page['pageStore'] = pageStore;
  page['templateRegistry'] = templateRegistry;
  page['widgetRegistry'] = widgetRegistry;
  page['principal'] = { id: 'u_test', roles: [] };
  page['tenantId'] = 't_test';
  page['correlationId'] = 'cid-dry-run-happy';
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
    (el) => el.tagName != null && el.tagName.toLowerCase() === 'widget-host',
  ) as (Element & { layout?: { version: number; slots: Record<string, unknown[]> } }) | null;
  assert(host, 'happy-path: <widget-host> must be present in the DOM');
  assert(
    host!.parentNode === template,
    '<widget-host> should be a child of the template element',
  );
  // Layout was forwarded correctly.
  assert(
    host!.layout && host!.layout.version === 1,
    'widget-host should receive the forwarded layout',
  );
  assert(
    host!.layout?.slots && Array.isArray(host!.layout.slots['main']),
    'forwarded layout should carry the regions as slots',
  );

  page.remove();
  await waitMicrotasks(5);
}

async function testContentPageTemplateMissing(): Promise<void> {
  const pageStore = new InMemoryPageStore();
  const doc = structuredClone(docWelcome) as Record<string, unknown>;
  doc['templateId'] = 'template.nonexistent';
  await pageStore.save(doc['pageId'] as string, doc as never);

  const templateRegistry = new TemplateRegistry();
  templateRegistry.register({ manifest: templateOneColumn as never, element: OneColumnTemplate });

  const page = document.createElement('content-page') as HTMLElement & Record<string, unknown>;
  page['pageId'] = doc['pageId'];
  page['pageStore'] = pageStore;
  page['templateRegistry'] = templateRegistry;
  page['widgetRegistry'] = makeWidgetRegistry();
  page['correlationId'] = 'cid-dry-run-missing';
  document.body.appendChild(page);

  await waitMicrotasks(20);

  assert(
    hasErrorBox(page),
    'template-missing: content-page must render an error box',
  );
  const host = findDescendant(
    page,
    (el) => el.tagName != null && el.tagName.toLowerCase() === 'widget-host',
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
  const doc = structuredClone(docWelcome) as Record<string, unknown>;
  doc['templateVersion'] = '9.9.9';
  await pageStore.save(doc['pageId'] as string, doc as never);

  const oldTwoColumn = structuredClone(templateTwoColumn) as Record<string, unknown>;
  oldTwoColumn['version'] = '0.1.0';
  const templateRegistry = new TemplateRegistry();
  templateRegistry.register({ manifest: oldTwoColumn as never, element: TwoColumnTemplate });

  const page = document.createElement('content-page') as HTMLElement & Record<string, unknown>;
  page['pageId'] = doc['pageId'];
  page['pageStore'] = pageStore;
  page['templateRegistry'] = templateRegistry;
  page['widgetRegistry'] = makeWidgetRegistry();
  page['correlationId'] = 'cid-dry-run-version';
  document.body.appendChild(page);

  await waitMicrotasks(20);

  assert(
    hasErrorBox(page),
    'version-ahead: content-page must render a fail-closed error box',
  );
  const host = findDescendant(
    page,
    (el) => el.tagName != null && el.tagName.toLowerCase() === 'widget-host',
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

  // eslint-disable-next-line no-console
  console.log('OK');
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', (err as Error | undefined)?.stack ?? err);
  process.exit(1);
});
