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
globalThis.window = dom.window;
globalThis.document = dom.document;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.DocumentFragment = dom.DocumentFragment;
globalThis.customElements = dom.customElements;
globalThis.Node = dom.Node;
globalThis.NodeFilter = dom.NodeFilter ?? {
  SHOW_ELEMENT: 1,
};
if (!globalThis.structuredClone) {
  globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}

// linkedom does not implement createTreeWalker; add a tiny shim so
// @atlas/core's html tagged template can attach event bindings.
if (typeof globalThis.document.createTreeWalker !== 'function') {
  globalThis.document.createTreeWalker = (root) => {
    const elements = [];
    const walk = (el) => {
      elements.push(el);
      for (const child of el.children ?? []) walk(child);
    };
    for (const child of root.children ?? []) walk(child);
    let i = -1;
    return {
      nextNode() {
        i += 1;
        return i < elements.length ? elements[i] : null;
      },
    };
  };
}

// ---- import the package under test (registers <content-page>) --------
const pkg = await import('../src/index.js');
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
const { WidgetRegistry } = widgetHostPkg;

// ---- load fixtures ---------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../../specs/fixtures');
const readFixture = (name) =>
  JSON.parse(readFileSync(resolve(fixturesDir, name), 'utf8'));

const templateOneColumn = readFixture('page_template__valid__one_column.json');
const templateTwoColumn = readFixture('page_template__valid__two_column.json');
const templateNoRegions = readFixture('page_template__invalid__no_regions.json');
const docWelcome = readFixture('page_document__valid__welcome.json');
const docRoundTrip = readFixture('page_document__valid__backend_round_trip.json');
const docMissingTemplate = readFixture('page_document__invalid__missing_template.json');
const announcementsManifest = readFixture('widget_manifest__valid__announcements.json');

// ---- utilities -------------------------------------------------------

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`assertion failed: ${msg}`);
  }
}

async function waitMicrotasks(n = 20) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
}

function sortedStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(sortedStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + sortedStringify(value[k]))
      .join(',') +
    '}'
  );
}

function hasErrorBox(node) {
  // content-page renders an <atlas-box> with an <atlas-text name="content-page-error">
  const walk = (el) => {
    if (!el) return false;
    if (
      el.getAttribute &&
      el.getAttribute('name') === 'content-page-error'
    ) {
      return true;
    }
    for (const child of el.children ?? []) {
      if (walk(child)) return true;
    }
    return false;
  };
  return walk(node);
}

function findDescendant(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findDescendant(child, predicate);
    if (found) return found;
  }
  return null;
}

// ---- stub template classes ------------------------------------------
// linkedom requires HTMLElement subclasses to be registered before `new`.
class OneColumnTemplate extends globalThis.HTMLElement {
  constructor() {
    super();
    this._mounted = false;
  }
  connectedCallback() {
    this._mounted = true;
  }
}
customElements.define('tpl-one-column', OneColumnTemplate);

class TwoColumnTemplate extends globalThis.HTMLElement {
  constructor() {
    super();
    this._mounted = false;
  }
  connectedCallback() {
    this._mounted = true;
  }
}
customElements.define('tpl-two-column', TwoColumnTemplate);

// Stub widget class, minimal — exists only so <widget-host> can instantiate it.
class AnnouncementsWidget extends globalThis.HTMLElement {
  connectedCallback() {
    this._mounted = true;
  }
}
customElements.define('stub-announcements-widget', AnnouncementsWidget);

// ---- tests ----------------------------------------------------------

async function testManifestValidation() {
  const good = validateTemplateManifest(templateOneColumn);
  assert(good.ok === true, `one-column manifest should validate, got ${JSON.stringify(good.errors)}`);

  const bad = validateTemplateManifest(templateNoRegions);
  assert(bad.ok === false, 'no-regions manifest must fail validation');
  assert(
    bad.errors.length > 0,
    'no-regions manifest must carry at least one error',
  );
}

async function testDocumentValidation() {
  const good = validatePageDocument(docWelcome);
  assert(good.ok === true, `welcome doc should validate, got ${JSON.stringify(good.errors)}`);

  const bad = validatePageDocument(docMissingTemplate);
  assert(bad.ok === false, 'missing-template doc must fail validation');
  assert(bad.errors.length > 0, 'missing-template doc must carry errors');
}

async function testRoundTripByteEquivalence() {
  const store = new InMemoryPageStore();
  const before = structuredClone(docRoundTrip);
  await store.save(before.pageId, before);
  const after = await store.get(before.pageId);
  assert(after !== null, 'round-trip: get must return the saved doc');
  const beforeStr = sortedStringify(before);
  const afterStr = sortedStringify(after);
  assert(
    beforeStr === afterStr,
    `round-trip byte-equivalence failed:\n  before=${beforeStr}\n  after =${afterStr}`,
  );

  // Mutating the returned doc MUST NOT affect store contents.
  after.tenantId = 'mutated';
  const fresh = await store.get(before.pageId);
  assert(
    fresh.tenantId === before.tenantId,
    'returned doc must not share identity with stored doc',
  );
}

async function testValidatingPageStoreRejectsInvalid() {
  const store = new ValidatingPageStore(new InMemoryPageStore());
  let caught = null;
  try {
    await store.save('broken', docMissingTemplate);
  } catch (err) {
    caught = err;
  }
  assert(
    caught instanceof PageDocumentError,
    `expected PageDocumentError, got ${caught}`,
  );
  assert(
    Array.isArray(caught.details?.errors) && caught.details.errors.length > 0,
    'PageDocumentError must carry ajv errors in details.errors',
  );

  // Valid save round-trips through the decorator.
  await store.save(docWelcome.pageId, docWelcome);
  const back = await store.get(docWelcome.pageId);
  assert(
    back && back.pageId === docWelcome.pageId,
    'ValidatingPageStore should round-trip a valid doc',
  );
}

async function testTemplateRegistryRoundTrip() {
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
  assert(
    list.length === 1 && list[0].templateId === templateOneColumn.templateId,
    `registry.list should yield one entry, got ${JSON.stringify(list)}`,
  );

  // Unknown lookup throws.
  let threw = null;
  try {
    reg.get('template.nope');
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof PageTemplateError, 'unknown get must throw PageTemplateError');

  // Invalid manifest rejected at register time.
  let regThrew = null;
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

function makeWelcomeStore() {
  const store = new InMemoryPageStore();
  // seed a cloned copy so later tests can mutate their own fixture freely
  store._docs.set(docWelcome.pageId, structuredClone(docWelcome));
  return store;
}

function makeWidgetRegistry() {
  const wr = new WidgetRegistry();
  // The spec fixture carries $schema/$comment/$invariants for discoverability;
  // the runtime schema rejects unknown properties, so strip them here.
  const clean = { ...announcementsManifest };
  delete clean.$schema;
  delete clean.$comment;
  delete clean.$invariants;
  wr.register({ manifest: clean, element: AnnouncementsWidget });
  return wr;
}

function makeTemplateRegistry() {
  const tr = new TemplateRegistry();
  tr.register({ manifest: templateOneColumn, element: OneColumnTemplate });
  tr.register({ manifest: templateTwoColumn, element: TwoColumnTemplate });
  return tr;
}

async function testContentPageHappyPath() {
  const pageStore = makeWelcomeStore();
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page');
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
    (el) => el.tagName && el.tagName.toLowerCase() === 'widget-host',
  );
  assert(host, 'happy-path: <widget-host> must be present in the DOM');
  assert(
    host.parentNode === template,
    '<widget-host> should be a child of the template element',
  );
  // Layout was forwarded correctly.
  assert(
    host.layout && host.layout.version === 1,
    'widget-host should receive the forwarded layout',
  );
  assert(
    host.layout.slots && Array.isArray(host.layout.slots.main),
    'forwarded layout should carry the regions as slots',
  );

  page.remove();
  await waitMicrotasks(5);
}

async function testContentPageTemplateMissing() {
  const pageStore = new InMemoryPageStore();
  // Doc referring to a template the registry doesn't know about.
  const doc = structuredClone(docWelcome);
  doc.templateId = 'template.nonexistent';
  await pageStore.save(doc.pageId, doc);

  // Only one-column is registered — two-column deliberately absent too.
  const templateRegistry = new TemplateRegistry();
  templateRegistry.register({ manifest: templateOneColumn, element: OneColumnTemplate });

  const page = document.createElement('content-page');
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
    (el) => el.tagName && el.tagName.toLowerCase() === 'widget-host',
  );
  assert(
    host === null,
    'template-missing: <widget-host> must NOT be mounted when template lookup fails',
  );

  page.remove();
  await waitMicrotasks(5);
}

async function testContentPageVersionAhead() {
  const pageStore = new InMemoryPageStore();
  const doc = structuredClone(docWelcome);
  doc.templateVersion = '9.9.9';
  await pageStore.save(doc.pageId, doc);

  // Registered two-column pinned to an earlier version.
  const oldTwoColumn = structuredClone(templateTwoColumn);
  oldTwoColumn.version = '0.1.0';
  const templateRegistry = new TemplateRegistry();
  templateRegistry.register({ manifest: oldTwoColumn, element: TwoColumnTemplate });

  const page = document.createElement('content-page');
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
    (el) => el.tagName && el.tagName.toLowerCase() === 'widget-host',
  );
  assert(
    host === null,
    'version-ahead: <widget-host> must NOT be mounted when stored version is ahead',
  );

  page.remove();
  await waitMicrotasks(5);
}

async function main() {
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

main().catch((err) => {
  console.error('FAIL:', err?.stack ?? err);
  process.exit(1);
});
