/**
 * Editor dry-run: exercises editor-mode primitives end-to-end in a linkedom
 * DOM. Covers the pure constraint computation, the editor state machine,
 * keyboard-driven pickup + drop, persistence, and the canEdit gate.
 *
 * Invoked via `pnpm --filter @atlas/page-templates test:editor-dry-run`.
 */

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// --- set up browser-ish globals ---------------------------------------
const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.document;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.DocumentFragment = dom.DocumentFragment;
globalThis.customElements = dom.customElements;
globalThis.Node = dom.Node;
globalThis.NodeFilter = dom.NodeFilter ?? { SHOW_ELEMENT: 1 };
if (!globalThis.structuredClone) {
  globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}
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

// ---- import package under test --------------------------------------
const pkg = await import('../src/index.js');
const {
  TemplateRegistry,
  InMemoryPageStore,
  ValidatingPageStore,
  computeValidTargets,
  EditorController,
} = pkg;

const widgetHostPkg = await import('@atlas/widget-host');
const { WidgetRegistry } = widgetHostPkg;

// ---- fixtures --------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../../specs/fixtures');
const readFixture = (name) =>
  JSON.parse(readFileSync(resolve(fixturesDir, name), 'utf8'));

const templateOneColumn = readFixture('page_template__valid__one_column.json');
const templateTwoColumn = readFixture('page_template__valid__two_column.json');
const docWelcome = readFixture('page_document__valid__welcome.json');
const announcementsManifest = readFixture('widget_manifest__valid__announcements.json');

// ---- utilities -------------------------------------------------------

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

async function waitMicrotasks(n = 20) {
  for (let i = 0; i < n; i++) await Promise.resolve();
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

// ---- stub template + widget classes ---------------------------------
class OneColumnTemplate extends globalThis.HTMLElement {
  connectedCallback() {
    this._mounted = true;
  }
}
customElements.define('tpl-one-column', OneColumnTemplate);

class TwoColumnTemplate extends globalThis.HTMLElement {
  connectedCallback() {
    this._mounted = true;
  }
}
customElements.define('tpl-two-column', TwoColumnTemplate);

class AnnouncementsWidget extends globalThis.HTMLElement {
  connectedCallback() {
    this._mounted = true;
  }
}
customElements.define('stub-announcements-widget-ed', AnnouncementsWidget);

function cleanAnnouncementsManifest() {
  const clean = { ...announcementsManifest };
  delete clean.$schema;
  delete clean.$comment;
  delete clean.$invariants;
  return clean;
}

function makeWidgetRegistry() {
  const wr = new WidgetRegistry();
  wr.register({ manifest: cleanAnnouncementsManifest(), element: AnnouncementsWidget });
  return wr;
}

function makeTemplateRegistry() {
  const tr = new TemplateRegistry();
  tr.register({ manifest: templateOneColumn, element: OneColumnTemplate });
  tr.register({ manifest: templateTwoColumn, element: TwoColumnTemplate });
  return tr;
}

// ---- 1. computeValidTargets pure tests ------------------------------

async function testComputeValidTargets_basic() {
  const reg = makeWidgetRegistry();
  const result = computeValidTargets(
    'content.announcements',
    docWelcome,
    templateTwoColumn,
    reg,
    null,
  );
  const main = result.validRegions.find((r) => r.regionName === 'main');
  const sidebar = result.validRegions.find((r) => r.regionName === 'sidebar');
  assert(main, 'main region valid for announcements');
  assert(sidebar, 'sidebar region valid for announcements');
  // main has 1 widget → 2 insertion points, sidebar has 1 → 2 insertion points.
  assertEq(main.canInsertAt.length, 2, 'main insertion slots');
  assert(main.canInsertAt.every((b) => b === true), 'all main positions valid');
  assertEq(sidebar.canInsertAt.length, 2, 'sidebar insertion slots');
}

async function testComputeValidTargets_unknownRegion() {
  const reg = makeWidgetRegistry();
  const bogusTemplate = { regions: [{ name: 'main', required: true }] };
  const doc = { regions: { main: [], nope: [] } };
  const result = computeValidTargets('content.announcements', doc, bogusTemplate, reg);
  // 'nope' isn't in the template so it's not returned at all — the function
  // iterates template.regions; unknown document regions simply get ignored.
  assertEq(result.validRegions.length, 1, 'only template-declared regions returned');
  assertEq(result.validRegions[0].regionName, 'main', 'main returned');
}

async function testComputeValidTargets_anyRegionAllowed() {
  // Per-widget slot permissions are gone: a registered widget is valid
  // in any region the template declares.
  const reg = makeWidgetRegistry();
  const tpl = { regions: [{ name: 'header' }, { name: 'footer' }] };
  const result = computeValidTargets(
    'content.announcements',
    { regions: { header: [], footer: [] } },
    tpl,
    reg,
  );
  assertEq(result.validRegions.length, 2, 'both regions valid');
  assertEq(result.invalidRegions.length, 0, 'no invalid regions');
}

async function testComputeValidTargets_unknownWidget() {
  // A widget id the registry does not know about is undroppable everywhere.
  const reg = makeWidgetRegistry();
  const tpl = { regions: [{ name: 'main' }] };
  const result = computeValidTargets(
    'content.does-not-exist',
    { regions: { main: [] } },
    tpl,
    reg,
  );
  assertEq(result.validRegions.length, 0, 'no valid regions for unknown widget');
  assertEq(result.invalidRegions.length, 1, 'one invalid region');
  assertEq(result.invalidRegions[0].reason, 'unknown-widget', 'reason unknown-widget');
}

async function testComputeValidTargets_maxWidgetsAtCap_newPlacement() {
  const reg = makeWidgetRegistry();
  const tpl = { regions: [{ name: 'main', maxWidgets: 1 }] };
  const doc = {
    regions: {
      main: [{ widgetId: 'content.announcements', instanceId: 'x', config: {} }],
    },
  };
  const result = computeValidTargets(
    'content.announcements',
    doc,
    tpl,
    reg,
    null,
  );
  const main = result.validRegions.find((r) => r.regionName === 'main');
  assert(main, 'main is returned with capped state');
  assertEq(main.reason, 'max-widgets', 'reason is max-widgets');
  assert(main.canInsertAt.every((b) => b === false), 'no insertion allowed');
}

async function testComputeValidTargets_maxWidgetsMoveWithin() {
  const reg = makeWidgetRegistry();
  const tpl = { regions: [{ name: 'main', maxWidgets: 2 }] };
  const doc = {
    regions: {
      main: [
        { widgetId: 'content.announcements', instanceId: 'a', config: {} },
        { widgetId: 'content.announcements', instanceId: 'b', config: {} },
      ],
    },
  };
  // Moving 'a' within the same region: count unchanged.
  const result = computeValidTargets(
    'content.announcements',
    doc,
    tpl,
    reg,
    { regionName: 'main', index: 0 },
  );
  const main = result.validRegions.find((r) => r.regionName === 'main');
  assert(main, 'main valid');
  assert(main.canInsertAt.every((b) => b === true), 'move-within allowed at cap');
}

async function testComputeValidTargets_emptyTemplateRegions() {
  const reg = makeWidgetRegistry();
  const tpl = { regions: [] };
  const result = computeValidTargets(
    'content.announcements',
    { regions: {} },
    tpl,
    reg,
  );
  assertEq(result.validRegions.length, 0, 'no regions → no valid targets');
  assertEq(result.invalidRegions.length, 0, 'no regions → no invalid entries');
}

// ---- 2. EditorController tests --------------------------------------

function makeWelcomeDoc() {
  return structuredClone(docWelcome);
}

async function testControllerPickUpDrop() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  ctrl.pickUp({
    widgetId: 'content.announcements',
    source: { regionName: 'main', index: 0 },
    via: 'pointer',
  });
  assert(ctrl.picked, 'picked state set');
  const result = ctrl.drop({ target: { regionName: 'sidebar', index: 1 } });
  assert(result.ok, `drop ok (got ${JSON.stringify(result)})`);
  assertEq(result.nextDoc.regions.main.length, 0, 'main emptied');
  assertEq(result.nextDoc.regions.sidebar.length, 2, 'sidebar grown');
  assert(ctrl.picked === null, 'picked cleared after drop');
}

async function testControllerCancelClearsState() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  let events = 0;
  ctrl.on('statechange', () => events++);
  ctrl.pickUp({
    widgetId: 'content.announcements',
    source: { regionName: 'main', index: 0 },
    via: 'keyboard',
  });
  assert(ctrl.picked, 'picked');
  ctrl.cancel();
  assert(ctrl.picked === null, 'picked cleared');
  assert(events >= 2, 'statechange fired on pickUp and cancel');
}

async function testControllerDropInvalidTarget() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  ctrl.pickUp({
    widgetId: 'content.announcements',
    source: { regionName: 'main', index: 0 },
    via: 'pointer',
  });
  const result = ctrl.drop({ target: { regionName: 'nonexistent', index: 0 } });
  assert(!result.ok, 'bad region rejected');
  assertEq(result.reason, 'region-invalid', 'reason is region-invalid');
}

async function testControllerDeleteInstance() {
  const reg = makeWidgetRegistry();
  const doc = makeWelcomeDoc();
  // Add a second widget to sidebar so deletion leaves it non-empty.
  doc.regions.sidebar.push({
    widgetId: 'content.announcements',
    instanceId: 'w-side-2',
    config: { mode: 'text', text: 'Second' },
  });
  const ctrl = new EditorController({
    pageDoc: doc,
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const result = ctrl.deleteInstance({ regionName: 'sidebar', index: 0 });
  assert(result.ok, 'delete succeeded');
  assertEq(result.nextDoc.regions.sidebar.length, 1, 'sidebar shrunk');
}

async function testControllerDeleteRefusesRequired() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  // main is required and has only one widget → delete must refuse.
  const result = ctrl.deleteInstance({ regionName: 'main', index: 0 });
  assert(!result.ok, 'required region last widget delete refused');
  assertEq(result.reason, 'required-region-empty', 'required-region-empty reason');
}

// ---- 3. Integration smoke: <content-page edit> DOM shape ------------

class StubPageStore {
  constructor(seed) {
    this._map = new Map();
    for (const [id, doc] of Object.entries(seed ?? {})) {
      this._map.set(id, structuredClone(doc));
    }
    this.saveCalls = [];
  }
  async get(pageId) {
    const d = this._map.get(pageId);
    return d ? structuredClone(d) : null;
  }
  async save(pageId, doc) {
    this.saveCalls.push({ pageId, doc: structuredClone(doc) });
    this._map.set(pageId, structuredClone(doc));
  }
  async list() {
    return [...this._map.values()].map((d) => structuredClone(d));
  }
  async delete(pageId) {
    this._map.delete(pageId);
  }
}

async function testContentPageEditDomShape() {
  const pageStore = new StubPageStore({ welcome: makeWelcomeDoc() });
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page');
  page.pageId = 'welcome';
  page.pageStore = pageStore;
  page.templateRegistry = templateRegistry;
  page.widgetRegistry = widgetRegistry;
  page.correlationId = 'cid-editor-dom';
  page.edit = true;
  page.setAttribute('edit', '');
  document.body.appendChild(page);
  await waitMicrotasks(40);

  // Palette is present.
  const palette = findDescendant(
    page,
    (el) => el.tagName && el.tagName.toLowerCase() === 'widget-palette',
  );
  assert(palette, '<widget-palette> is present in edit mode');

  // Announcer is present.
  const announcer = findDescendant(
    page,
    (el) => el.getAttribute && el.getAttribute('data-editor-announcer') !== null,
  );
  assert(announcer, 'aria-live announcer present');

  // Widget-anchored drop model: no persistent [data-drop-indicator] bars
  // in the DOM. Drop targets are cell halves driven by [data-drop-target]
  // at drag time (or a single [data-drop-empty] for empty regions).
  const indicators = [];
  const collect = (el) => {
    if (!el) return;
    if (el.getAttribute && el.getAttribute('data-drop-indicator') !== null) {
      indicators.push(el);
    }
    for (const c of el.children ?? []) collect(c);
  };
  collect(page);
  assert(
    indicators.length === 0,
    `expected 0 persistent drop indicators, got ${indicators.length}`,
  );

  // Widget cells got tabindex=0.
  const cells = [];
  const collectCells = (el) => {
    if (!el) return;
    if (el.getAttribute && el.getAttribute('data-widget-cell') !== null) {
      cells.push(el);
    }
    for (const c of el.children ?? []) collectCells(c);
  };
  collectCells(page);
  assert(cells.length >= 2, `expected >= 2 cells, got ${cells.length}`);
  for (const c of cells) {
    assertEq(c.getAttribute('tabindex'), '0', 'cell has tabindex=0');
  }

  // Simulate a keyboard pickUp: synthesize a keydown with Space on a cell.
  // linkedom's dispatchEvent works; we can check the editor state machine
  // directly via the palette-adjacent attribute we set on data-editor-active.
  const cell = cells[0];
  // linkedom's KeyboardEvent is a thin alias and does not honor the `key`
  // option; always set it as a property after construction.
  const ev = new dom.window.Event('keydown', { bubbles: true, cancelable: true });
  ev.key = ' ';
  cell.dispatchEvent(ev);
  await waitMicrotasks(5);
  assertEq(
    page.getAttribute('data-editor-active'),
    'true',
    'keyboard Space entered picked state (editor-active=true)',
  );

  page.remove();
  await waitMicrotasks(5);
}

// ---- 4. Persistence smoke -------------------------------------------

async function testPersistenceOnKeyboardDrop() {
  // Seed a doc with TWO widgets in main so we can move one to sidebar
  // without emptying the required 'main' region.
  const seedDoc = makeWelcomeDoc();
  seedDoc.regions.main.push({
    widgetId: 'content.announcements',
    instanceId: 'w-main-2',
    config: { mode: 'text', text: 'Second.' },
  });
  const pageStore = new StubPageStore({ welcome: seedDoc });
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page');
  page.pageId = 'welcome';
  page.pageStore = pageStore;
  page.templateRegistry = templateRegistry;
  page.widgetRegistry = widgetRegistry;
  page.correlationId = 'cid-editor-persist';
  page.edit = true;
  page.setAttribute('edit', '');
  document.body.appendChild(page);
  await waitMicrotasks(40);

  // Drive the editor directly through its handle — event dispatch in
  // linkedom is too fragile for full end-to-end keyboard plumbing. This
  // still verifies: controller.drop → _commitAndRemount → pageStore.save
  // → re-read → re-mount path.
  const handle = page._editorHandle;
  assert(handle, 'editor handle attached');
  handle.controller.pickUp({
    widgetId: 'content.announcements',
    source: { regionName: 'main', index: 1 },
    via: 'keyboard',
  });
  const _result = handle.controller.drop({
    target: { regionName: 'sidebar', index: 1 },
  });
  assert(_result.ok, 'controller drop ok');
  await page._commitAndRemount(_result.nextDoc, {
    action: 'move',
    widgetId: 'content.announcements',
    from: _result.from,
    to: _result.to,
  });
  await waitMicrotasks(40);

  assert(pageStore.saveCalls.length >= 1, 'pageStore.save was called');
  const lastSaved = pageStore.saveCalls[pageStore.saveCalls.length - 1].doc;
  assertEq(lastSaved.regions.main.length, 1, 'saved doc: main shrunk to 1');
  assertEq(lastSaved.regions.sidebar.length, 2, 'saved doc: sidebar grew to 2');

  // After re-mount, the widget-host reflects the new ordering.
  const host = findDescendant(
    page,
    (el) => el.tagName && el.tagName.toLowerCase() === 'widget-host',
  );
  assert(host, 'widget-host is remounted');
  assert(
    host.layout && host.layout.slots.sidebar.length === 2,
    'remounted host reflects new layout',
  );

  page.remove();
  await waitMicrotasks(5);
}

// ---- 5. canEdit=false gate ------------------------------------------

async function testCanEditFalseGate() {
  const pageStore = new StubPageStore({ welcome: makeWelcomeDoc() });
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const telemetryEvents = [];
  const origDebug = console.debug;
  console.debug = (event, payload) => {
    telemetryEvents.push({ event, payload });
  };

  try {
    const page = document.createElement('content-page');
    page.pageId = 'welcome';
    page.pageStore = pageStore;
    page.templateRegistry = templateRegistry;
    page.widgetRegistry = widgetRegistry;
    page.correlationId = 'cid-editor-denied';
    page.edit = true;
    page.canEdit = false;
    page.setAttribute('edit', '');
    document.body.appendChild(page);
    await waitMicrotasks(40);

    const palette = findDescendant(
      page,
      (el) => el.tagName && el.tagName.toLowerCase() === 'widget-palette',
    );
    assert(!palette, 'palette NOT rendered when canEdit=false');

    const denied = telemetryEvents.find(
      (e) => e.event === 'atlas.content-page.edit.denied',
    );
    assert(denied, 'atlas.content-page.edit.denied emitted');

    page.remove();
    await waitMicrotasks(5);
  } finally {
    console.debug = origDebug;
  }
}

// ---- round it out: ValidatingPageStore rejects bad commit ----------

async function testValidatingStoreRejectsInvalidEdit() {
  // Force an invalid save: if editor emits a doc the validator rejects,
  // _commitAndRemount's save throws; we expect no crash and an announce.
  const inner = new InMemoryPageStore();
  await inner.save('welcome', makeWelcomeDoc());
  const store = new ValidatingPageStore(inner);
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page');
  page.pageId = 'welcome';
  page.pageStore = store;
  page.templateRegistry = templateRegistry;
  page.widgetRegistry = widgetRegistry;
  page.correlationId = 'cid-editor-reject';
  page.edit = true;
  page.setAttribute('edit', '');
  document.body.appendChild(page);
  await waitMicrotasks(40);

  // Build a bad next-doc (missing required field).
  const bad = makeWelcomeDoc();
  delete bad.tenantId;
  let threw = null;
  try {
    await page._commitAndRemount(bad, { action: 'move' });
  } catch (err) {
    threw = err;
  }
  assert(threw, 'invalid save must throw');

  page.remove();
  await waitMicrotasks(5);
}

// ---- main -----------------------------------------------------------

async function main() {
  // computeValidTargets cases
  await testComputeValidTargets_basic();
  await testComputeValidTargets_unknownRegion();
  await testComputeValidTargets_anyRegionAllowed();
  await testComputeValidTargets_unknownWidget();
  await testComputeValidTargets_maxWidgetsAtCap_newPlacement();
  await testComputeValidTargets_maxWidgetsMoveWithin();
  await testComputeValidTargets_emptyTemplateRegions();

  // EditorController
  await testControllerPickUpDrop();
  await testControllerCancelClearsState();
  await testControllerDropInvalidTarget();
  await testControllerDeleteInstance();
  await testControllerDeleteRefusesRequired();

  // Integration
  await testContentPageEditDomShape();
  await testPersistenceOnKeyboardDrop();
  await testCanEditFalseGate();
  await testValidatingStoreRejectsInvalidEdit();

  console.log('OK');
}

main().catch((err) => {
  console.error('FAIL:', err?.stack ?? err);
  process.exit(1);
});
