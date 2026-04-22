/**
 * Editor dry-run: exercises the new zones-based editor and the imperative
 * EditorAPI end-to-end in a linkedom DOM.
 *
 * Covers:
 *   - computeValidTargets purity + edge cases
 *   - EditorController primitives (applyAdd / applyMove / applyUpdate /
 *     applyRemove) including required-region, max-widgets, and instance
 *     lookup failures
 *   - EditorAPI wired up to a content-page: list/get/add/move/update/remove
 *   - DOM invariants: drop zones + cells exposed with unique auto-testid
 *     names; no legacy half-cell attributes
 *   - canEdit=false gate blocks API mutations
 *   - ValidatingPageStore rejection propagates as reason=persist-failed
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
  EditorAPI,
  freshInstanceId,
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

function findAllDescendants(node, predicate, out = []) {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) findAllDescendants(child, predicate, out);
  return out;
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

function makeWelcomeDoc() {
  return structuredClone(docWelcome);
}

// ==== 1. computeValidTargets ==========================================

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
  assertEq(main.canInsertAt.length, 2, 'main insertion slots');
  assert(main.canInsertAt.every((b) => b === true), 'all main positions valid');
  assertEq(sidebar.canInsertAt.length, 2, 'sidebar insertion slots');
}

async function testComputeValidTargets_anyRegionAllowed() {
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
  const result = computeValidTargets('content.announcements', doc, tpl, reg, null);
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

// ==== 2. EditorController primitives ==================================

async function testController_applyAdd_basic() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const entry = {
    widgetId: 'content.announcements',
    instanceId: 'w-new-1',
    config: { mode: 'text', text: 'Hi' },
  };
  const res = ctrl.applyAdd({ entry, region: 'sidebar', index: 1 });
  assert(res.ok, `applyAdd ok: ${JSON.stringify(res)}`);
  assertEq(res.nextDoc.regions.sidebar.length, 2, 'sidebar grew to 2');
  assertEq(res.nextDoc.regions.sidebar[1].instanceId, 'w-new-1', 'inserted at index 1');
}

async function testController_applyAdd_appendDefaults() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const entry = { widgetId: 'content.announcements', instanceId: 'w-new-2', config: {} };
  const res = ctrl.applyAdd({ entry, region: 'main' }); // no index
  assert(res.ok, 'applyAdd with no index appends');
  assertEq(res.to.index, 1, 'appended at end of main');
}

async function testController_applyAdd_rejectsUnknownWidget() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const res = ctrl.applyAdd({
    entry: { widgetId: 'nope.nope', instanceId: 'x', config: {} },
    region: 'main',
    index: 0,
  });
  assert(!res.ok, 'rejected');
  assertEq(res.reason, 'unknown-widget', 'reason unknown-widget');
}

async function testController_applyAdd_rejectsDuplicateInstance() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  // welcome doc already has 'w-main-1' in main
  const res = ctrl.applyAdd({
    entry: { widgetId: 'content.announcements', instanceId: 'w-main-1', config: {} },
    region: 'sidebar',
    index: 0,
  });
  assert(!res.ok, 'rejected');
  assertEq(res.reason, 'duplicate-instance-id', 'reason duplicate-instance-id');
}

async function testController_applyMove_crossRegion() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  // Seed a second main entry so move-out doesn't empty required main.
  ctrl.applyAdd({
    entry: { widgetId: 'content.announcements', instanceId: 'w-main-2', config: {} },
    region: 'main',
  });
  const res = ctrl.applyMove({ instanceId: 'w-main-2', region: 'sidebar', index: 1 });
  assert(res.ok, `move ok: ${JSON.stringify(res)}`);
  assertEq(res.nextDoc.regions.main.length, 1, 'main shrunk to 1');
  assertEq(res.nextDoc.regions.sidebar.length, 2, 'sidebar grew to 2');
  assertEq(res.to.region, 'sidebar', 'to region correct');
  assertEq(res.to.index, 1, 'to index correct');
}

async function testController_applyMove_noop() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const res = ctrl.applyMove({ instanceId: 'w-main-1', region: 'main', index: 0 });
  assert(res.ok, 'move to same position is ok');
  assertEq(res.noop, true, 'flagged as noop');
}

async function testController_applyMove_rejectsRequiredEmpty() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  // main is required; moving its only widget out must fail.
  const res = ctrl.applyMove({ instanceId: 'w-main-1', region: 'sidebar', index: 0 });
  assert(!res.ok, 'rejected');
  assertEq(res.reason, 'required-region-empty', 'reason required-region-empty');
}

async function testController_applyMove_rejectsUnknownInstance() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const res = ctrl.applyMove({ instanceId: 'nope', region: 'main', index: 0 });
  assert(!res.ok, 'rejected');
  assertEq(res.reason, 'instance-not-found', 'reason instance-not-found');
}

async function testController_applyUpdate() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const res = ctrl.applyUpdate({ instanceId: 'w-main-1', config: { mode: 'text', text: 'Updated' } });
  assert(res.ok, 'update ok');
  const found = ctrl.findInstance('w-main-1');
  assertEq(found.entry.config.text, 'Updated', 'config replaced');
}

async function testController_applyRemove() {
  const reg = makeWidgetRegistry();
  const doc = makeWelcomeDoc();
  // Add a second sidebar entry so removal doesn't empty (sidebar isn't
  // required anyway, but belt + braces).
  doc.regions.sidebar.push({
    widgetId: 'content.announcements',
    instanceId: 'w-side-2',
    config: {},
  });
  const ctrl = new EditorController({
    pageDoc: doc,
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const res = ctrl.applyRemove({ instanceId: 'w-side-2' });
  assert(res.ok, 'remove ok');
  assertEq(res.nextDoc.regions.sidebar.length, 1, 'sidebar shrunk');
  assert(ctrl.findInstance('w-side-2') === null, 'instance gone from doc');
}

async function testController_applyRemove_refusesRequiredEmpty() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const res = ctrl.applyRemove({ instanceId: 'w-main-1' });
  assert(!res.ok, 'rejected');
  assertEq(res.reason, 'required-region-empty', 'reason required-region-empty');
}

async function testController_findInstanceAndList() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const found = ctrl.findInstance('w-main-1');
  assert(found, 'instance found');
  assertEq(found.region, 'main', 'found in main');
  assertEq(found.index, 0, 'at index 0');

  const list = ctrl.listEntries();
  assertEq(list.length, 2, 'two entries in welcome doc');
  assert(list.some((e) => e.instanceId === 'w-main-1'), 'w-main-1 listed');
  assert(list.some((e) => e.instanceId === 'w-side-1'), 'w-side-1 listed');
}

// ==== 3. EditorAPI (standalone, no DOM) ===============================

async function testAPI_addAndList() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const saves = [];
  const api = new EditorAPI({
    controller: ctrl,
    onCommit: async (doc) => saves.push(doc),
  });
  const res = await api.add({
    widgetId: 'content.announcements',
    region: 'sidebar',
    instanceId: 'w-agent-1',
    config: { mode: 'text', text: 'from agent' },
  });
  assert(res.ok, 'add ok');
  assertEq(res.instanceId, 'w-agent-1', 'returned instanceId');
  assertEq(saves.length, 1, 'onCommit called');
  assertEq(api.list().length, 3, 'list has 3 entries');
  assertEq(api.get('w-agent-1').config.text, 'from agent', 'get returns config');
}

async function testAPI_addGeneratesInstanceId() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const api = new EditorAPI({ controller: ctrl, onCommit: async () => {} });
  const res = await api.add({ widgetId: 'content.announcements', region: 'sidebar' });
  assert(res.ok, 'add ok');
  assert(res.instanceId && res.instanceId.startsWith('w-announcements-'), 'auto-id generated with widget suffix');
}

async function testAPI_moveById() {
  const reg = makeWidgetRegistry();
  const doc = makeWelcomeDoc();
  doc.regions.main.push({
    widgetId: 'content.announcements',
    instanceId: 'w-main-2',
    config: {},
  });
  const ctrl = new EditorController({
    pageDoc: doc,
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const api = new EditorAPI({ controller: ctrl, onCommit: async () => {} });
  const res = await api.move({ instanceId: 'w-main-2', region: 'sidebar', index: 0 });
  assert(res.ok, 'move ok');
  assertEq(api.get('w-main-2').region, 'sidebar', 'now in sidebar');
  assertEq(api.get('w-main-2').index, 0, 'at index 0');
}

async function testAPI_updateConfig() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const api = new EditorAPI({ controller: ctrl, onCommit: async () => {} });
  const res = await api.update({
    instanceId: 'w-main-1',
    config: { mode: 'text', text: 'Updated by agent' },
  });
  assert(res.ok, 'update ok');
  assertEq(api.get('w-main-1').config.text, 'Updated by agent', 'config replaced');
}

async function testAPI_remove() {
  const reg = makeWidgetRegistry();
  const doc = makeWelcomeDoc();
  doc.regions.main.push({
    widgetId: 'content.announcements',
    instanceId: 'w-main-2',
    config: {},
  });
  const ctrl = new EditorController({
    pageDoc: doc,
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const api = new EditorAPI({ controller: ctrl, onCommit: async () => {} });
  const res = await api.remove({ instanceId: 'w-main-2' });
  assert(res.ok, 'remove ok');
  assert(api.get('w-main-2') === null, 'instance gone');
}

async function testAPI_rejectsNotEditable() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const api = new EditorAPI({
    controller: ctrl,
    onCommit: async () => {},
    isEditable: () => false,
  });
  const res = await api.add({ widgetId: 'content.announcements', region: 'sidebar' });
  assert(!res.ok, 'rejected');
  assertEq(res.reason, 'not-editable', 'reason not-editable');
}

async function testAPI_persistError() {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc(),
    templateManifest: templateTwoColumn,
    widgetRegistry: reg,
  });
  const api = new EditorAPI({
    controller: ctrl,
    onCommit: async () => {
      throw new Error('disk full');
    },
  });
  const res = await api.add({ widgetId: 'content.announcements', region: 'sidebar' });
  assert(!res.ok, 'rejected');
  assertEq(res.reason, 'persist-failed', 'reason persist-failed');
}

async function testFreshInstanceId() {
  const a = freshInstanceId('content.announcements');
  const b = freshInstanceId('content.announcements');
  assert(a !== b, 'two calls produce distinct ids');
  assert(a.startsWith('w-announcements-'), 'uses widgetId suffix');
}

// ==== 4. <content-page edit> DOM shape ================================

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

async function testContentPage_dropSlotsAndCellsHaveUniqueNames() {
  // Seed welcome has both main and sidebar filled (1 widget each), so no
  // drop slots are rendered. Remove sidebar via the editor API to expose
  // one drop slot, then assert the naming contract.
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

  assert(page.editor, 'page.editor is exposed');
  assert(typeof page.editor.add === 'function', 'editor.add exists');
  assert(typeof page.editor.list === 'function', 'editor.list exists');

  // Both regions filled → no section is marked data-empty.
  let emptySlots = findAllDescendants(
    page,
    (el) =>
      el.tagName === 'SECTION' &&
      el.getAttribute?.('data-editor-slot') !== null &&
      el.getAttribute?.('data-empty') === 'true',
  );
  assertEq(emptySlots.length, 0, 'filled sections are not marked data-empty');

  // Cells have instance-id-keyed unique names and are not native-draggable.
  const cells = findAllDescendants(page, (el) => el.getAttribute?.('data-widget-cell') !== null);
  assertEq(cells.length, 2, 'two cells (main + sidebar)');
  for (const c of cells) {
    const instanceId = c.getAttribute('data-instance-id');
    assert(instanceId, 'cell has data-instance-id');
    assertEq(c.getAttribute('name'), `cell-${instanceId}`, 'cell has unique name');
    assertEq(c.getAttribute('tabindex'), '0', 'cell tabbable');
    assert(!c.hasAttribute('draggable'), 'cell is NOT native-draggable');
  }

  // Legacy half-cell / zone-per-index / child-element slot markers are gone.
  const legacy = findAllDescendants(page, (el) =>
    el.getAttribute?.('data-drop-zone') !== null ||
    el.getAttribute?.('data-drop-slot') !== null ||
    el.getAttribute?.('data-drop-target') !== null ||
    el.getAttribute?.('data-drop-empty') !== null ||
    el.getAttribute?.('data-drop-indicator') !== null,
  );
  assertEq(legacy.length, 0, 'no legacy drop-zone / drop-slot child markers');

  // Delete buttons per cell.
  const deleteButtons = findAllDescendants(page, (el) => {
    const name = el.getAttribute?.('name');
    return typeof name === 'string' && name.startsWith('delete-');
  });
  assertEq(deleteButtons.length, 2, 'one delete button per cell');

  // Empty a region — a single drop slot should appear for it with a
  // stable, region-keyed name (no index suffix in the slot model).
  const sidebarCell = cells.find((c) => {
    // Walk up to find the section slot attribute.
    let node = c;
    while (node && node.nodeType === 1) {
      const slot = node.getAttribute?.('data-slot');
      if (slot) return slot === 'sidebar';
      node = node.parentNode;
    }
    return false;
  });
  assert(sidebarCell, 'sidebar cell located');
  const res = await page.editor.remove({
    instanceId: sidebarCell.getAttribute('data-instance-id'),
  });
  assert(res.ok, 'sidebar remove succeeded');
  await waitMicrotasks(40);

  emptySlots = findAllDescendants(
    page,
    (el) =>
      el.tagName === 'SECTION' &&
      el.getAttribute?.('data-editor-slot') !== null &&
      el.getAttribute?.('data-empty') === 'true',
  );
  assertEq(emptySlots.length, 1, 'one section marked empty for the emptied region');
  assertEq(
    emptySlots[0].getAttribute('data-slot'),
    'sidebar',
    'the empty section is sidebar',
  );
  assertEq(
    emptySlots[0].getAttribute('name'),
    'drop-slot-sidebar',
    'slot name is region-keyed (no index suffix)',
  );

  page.remove();
  await waitMicrotasks(5);
}

async function testContentPage_editorAPI_add_moves_remove_persist() {
  const pageStore = new StubPageStore({ welcome: makeWelcomeDoc() });
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page');
  page.pageId = 'welcome';
  page.pageStore = pageStore;
  page.templateRegistry = templateRegistry;
  page.widgetRegistry = widgetRegistry;
  page.correlationId = 'cid-api-persist';
  page.edit = true;
  page.setAttribute('edit', '');
  document.body.appendChild(page);
  await waitMicrotasks(40);

  // Add a widget programmatically.
  const addRes = await page.editor.add({
    widgetId: 'content.announcements',
    region: 'sidebar',
    index: 1,
    instanceId: 'w-agent-1',
    config: { mode: 'text', text: 'from agent' },
  });
  assert(addRes.ok, `add ok: ${JSON.stringify(addRes)}`);
  await waitMicrotasks(40);
  assert(pageStore.saveCalls.length >= 1, 'pageStore.save called');
  const last1 = pageStore.saveCalls[pageStore.saveCalls.length - 1].doc;
  assertEq(last1.regions.sidebar.length, 2, 'sidebar grew after add');

  // Move it.
  const moveRes = await page.editor.move({
    instanceId: 'w-agent-1',
    region: 'main',
    index: 0,
  });
  assert(moveRes.ok, `move ok: ${JSON.stringify(moveRes)}`);
  await waitMicrotasks(40);
  const last2 = pageStore.saveCalls[pageStore.saveCalls.length - 1].doc;
  assertEq(last2.regions.main[0].instanceId, 'w-agent-1', 'agent widget moved to main[0]');

  // Update it.
  const updRes = await page.editor.update({
    instanceId: 'w-agent-1',
    config: { mode: 'text', text: 'revised' },
  });
  assert(updRes.ok, 'update ok');
  await waitMicrotasks(40);
  const last3 = pageStore.saveCalls[pageStore.saveCalls.length - 1].doc;
  const agentEntry = last3.regions.main.find((e) => e.instanceId === 'w-agent-1');
  assertEq(agentEntry.config.text, 'revised', 'config updated');

  // Remove it.
  const rmRes = await page.editor.remove({ instanceId: 'w-agent-1' });
  assert(rmRes.ok, 'remove ok');
  await waitMicrotasks(40);
  const last4 = pageStore.saveCalls[pageStore.saveCalls.length - 1].doc;
  assert(
    !last4.regions.main.some((e) => e.instanceId === 'w-agent-1'),
    'agent widget gone',
  );

  page.remove();
  await waitMicrotasks(5);
}

async function testContentPage_editorAPI_rejectsRequiredEmpty() {
  const pageStore = new StubPageStore({ welcome: makeWelcomeDoc() });
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page');
  page.pageId = 'welcome';
  page.pageStore = pageStore;
  page.templateRegistry = templateRegistry;
  page.widgetRegistry = widgetRegistry;
  page.correlationId = 'cid-api-required';
  page.edit = true;
  page.setAttribute('edit', '');
  document.body.appendChild(page);
  await waitMicrotasks(40);

  const res = await page.editor.remove({ instanceId: 'w-main-1' });
  assert(!res.ok, 'rejected');
  assertEq(res.reason, 'required-region-empty', 'reason required-region-empty');

  page.remove();
  await waitMicrotasks(5);
}

// ==== 5. canEdit=false gate ==========================================

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
    assert(!page.editor, 'editor API NOT exposed when canEdit=false');

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

// ==== 6. ValidatingPageStore rejection =================================

async function testValidatingStoreRejection_asPersistFailed() {
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

  // Monkey-patch the store to produce an invalid doc and confirm the API
  // surfaces it as reason=persist-failed.
  const origSave = store.save.bind(store);
  store.save = async () => {
    throw new Error('schema violation: missing tenantId');
  };
  const res = await page.editor.add({
    widgetId: 'content.announcements',
    region: 'sidebar',
  });
  assert(!res.ok, 'rejected');
  assertEq(res.reason, 'persist-failed', 'reason persist-failed');
  store.save = origSave;

  page.remove();
  await waitMicrotasks(5);
}

// ==== main ============================================================

async function main() {
  // computeValidTargets
  await testComputeValidTargets_basic();
  await testComputeValidTargets_anyRegionAllowed();
  await testComputeValidTargets_unknownWidget();
  await testComputeValidTargets_maxWidgetsAtCap_newPlacement();
  await testComputeValidTargets_maxWidgetsMoveWithin();

  // Controller primitives
  await testController_applyAdd_basic();
  await testController_applyAdd_appendDefaults();
  await testController_applyAdd_rejectsUnknownWidget();
  await testController_applyAdd_rejectsDuplicateInstance();
  await testController_applyMove_crossRegion();
  await testController_applyMove_noop();
  await testController_applyMove_rejectsRequiredEmpty();
  await testController_applyMove_rejectsUnknownInstance();
  await testController_applyUpdate();
  await testController_applyRemove();
  await testController_applyRemove_refusesRequiredEmpty();
  await testController_findInstanceAndList();

  // EditorAPI standalone
  await testAPI_addAndList();
  await testAPI_addGeneratesInstanceId();
  await testAPI_moveById();
  await testAPI_updateConfig();
  await testAPI_remove();
  await testAPI_rejectsNotEditable();
  await testAPI_persistError();
  await testFreshInstanceId();

  // Integration with <content-page edit>
  await testContentPage_dropSlotsAndCellsHaveUniqueNames();
  await testContentPage_editorAPI_add_moves_remove_persist();
  await testContentPage_editorAPI_rejectsRequiredEmpty();
  await testCanEditFalseGate();
  await testValidatingStoreRejection_asPersistFailed();

  console.log('OK');
}

main().catch((err) => {
  console.error('FAIL:', err?.stack ?? err);
  process.exit(1);
});
