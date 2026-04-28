/**
 * Editor dry-run: exercises the new zones-based editor and the imperative
 * EditorAPI end-to-end in a linkedom DOM.
 */

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// --- set up browser-ish globals ---------------------------------------
const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
(globalThis as unknown as Record<string, unknown>)['window'] = dom.window;
(globalThis as unknown as Record<string, unknown>)['document'] = dom.document;
(globalThis as unknown as Record<string, unknown>)['HTMLElement'] = dom.HTMLElement;
(globalThis as unknown as Record<string, unknown>)['DocumentFragment'] = dom.DocumentFragment;
(globalThis as unknown as Record<string, unknown>)['customElements'] = dom.customElements;
(globalThis as unknown as Record<string, unknown>)['Node'] = dom.Node;
(globalThis as unknown as Record<string, unknown>)['NodeFilter'] = (dom as { NodeFilter?: unknown }).NodeFilter ?? { SHOW_ELEMENT: 1 };
if (!globalThis.structuredClone) {
  globalThis.structuredClone = ((v: unknown) => JSON.parse(JSON.stringify(v))) as typeof structuredClone;
}
if (typeof globalThis.document.createTreeWalker !== 'function') {
  (globalThis.document as unknown as { createTreeWalker: (root: Element) => { nextNode: () => Element | null } }).createTreeWalker = (root: Element) => {
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

// ---- import package under test --------------------------------------
const pkg = await import('../src/index.ts');
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
const { WidgetRegistry } = widgetHostPkg as { WidgetRegistry: new () => { register: (args: { manifest: unknown; element: CustomElementConstructor }) => void } };

// ---- fixtures --------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../../specs/fixtures');
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(fixturesDir, name), 'utf8'));

const templateOneColumn = readFixture('page_template__valid__one_column.json') as Record<string, unknown>;
const templateTwoColumn = readFixture('page_template__valid__two_column.json') as Record<string, unknown>;
const docWelcome = readFixture('page_document__valid__welcome.json') as Record<string, unknown>;
const announcementsManifest = readFixture('widget_manifest__valid__announcements.json') as Record<string, unknown>;

// ---- utilities -------------------------------------------------------

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

async function waitMicrotasks(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
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

function findAllDescendants(
  node: Element | null,
  predicate: (el: Element) => boolean,
  out: Element[] = [],
): Element[] {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  for (const child of (node.children as unknown as Iterable<Element>) ?? []) findAllDescendants(child, predicate, out);
  return out;
}

// ---- stub template + widget classes ---------------------------------
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

class AnnouncementsWidget extends (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement {
  _mounted = false;
  connectedCallback(): void {
    this._mounted = true;
  }
}
customElements.define('stub-announcements-widget-ed', AnnouncementsWidget);

function cleanAnnouncementsManifest(): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...announcementsManifest };
  delete clean['$schema'];
  delete clean['$comment'];
  delete clean['$invariants'];
  return clean;
}

function makeWidgetRegistry(): { register: (args: { manifest: unknown; element: CustomElementConstructor }) => void; has?: (id: string) => boolean; get?: (id: string) => unknown; list?: () => Array<{ widgetId: string; displayName?: string }> } {
  const wr = new WidgetRegistry();
  wr.register({ manifest: cleanAnnouncementsManifest(), element: AnnouncementsWidget });
  return wr;
}

function makeTemplateRegistry(): InstanceType<typeof TemplateRegistry> {
  const tr = new TemplateRegistry();
  tr.register({ manifest: templateOneColumn as never, element: OneColumnTemplate });
  tr.register({ manifest: templateTwoColumn as never, element: TwoColumnTemplate });
  return tr;
}

function makeWelcomeDoc(): Record<string, unknown> {
  return structuredClone(docWelcome) as Record<string, unknown>;
}

// ==== 1. computeValidTargets ==========================================

async function testComputeValidTargets_basic(): Promise<void> {
  const reg = makeWidgetRegistry();
  const result = computeValidTargets(
    'content.announcements',
    docWelcome as never,
    templateTwoColumn as never,
    reg,
    null,
  );
  const main = result.validRegions.find((r) => r.regionName === 'main');
  const sidebar = result.validRegions.find((r) => r.regionName === 'sidebar');
  assert(main, 'main region valid for announcements');
  assert(sidebar, 'sidebar region valid for announcements');
  assertEq(main!.canInsertAt.length, 2, 'main insertion slots');
  assert(main!.canInsertAt.every((b) => b === true), 'all main positions valid');
  assertEq(sidebar!.canInsertAt.length, 2, 'sidebar insertion slots');
}

async function testComputeValidTargets_anyRegionAllowed(): Promise<void> {
  const reg = makeWidgetRegistry();
  const tpl = { regions: [{ name: 'header' }, { name: 'footer' }] };
  const result = computeValidTargets(
    'content.announcements',
    { regions: { header: [], footer: [] } } as never,
    tpl as never,
    reg,
  );
  assertEq(result.validRegions.length, 2, 'both regions valid');
  assertEq(result.invalidRegions.length, 0, 'no invalid regions');
}

async function testComputeValidTargets_unknownWidget(): Promise<void> {
  const reg = makeWidgetRegistry();
  const tpl = { regions: [{ name: 'main' }] };
  const result = computeValidTargets(
    'content.does-not-exist',
    { regions: { main: [] } } as never,
    tpl as never,
    reg,
  );
  assertEq(result.validRegions.length, 0, 'no valid regions for unknown widget');
  assertEq(result.invalidRegions.length, 1, 'one invalid region');
  assertEq(result.invalidRegions[0]!.reason, 'unknown-widget', 'reason unknown-widget');
}

async function testComputeValidTargets_maxWidgetsAtCap_newPlacement(): Promise<void> {
  const reg = makeWidgetRegistry();
  const tpl = { regions: [{ name: 'main', maxWidgets: 1 }] };
  const doc = {
    regions: {
      main: [{ widgetId: 'content.announcements', instanceId: 'x', config: {} }],
    },
  };
  const result = computeValidTargets('content.announcements', doc as never, tpl as never, reg, null);
  const main = result.validRegions.find((r) => r.regionName === 'main');
  assert(main, 'main is returned with capped state');
  assertEq(main!.reason, 'max-widgets', 'reason is max-widgets');
  assert(main!.canInsertAt.every((b) => b === false), 'no insertion allowed');
}

async function testComputeValidTargets_maxWidgetsMoveWithin(): Promise<void> {
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
    doc as never,
    tpl as never,
    reg,
    { regionName: 'main', index: 0 },
  );
  const main = result.validRegions.find((r) => r.regionName === 'main');
  assert(main, 'main valid');
  assert(main!.canInsertAt.every((b) => b === true), 'move-within allowed at cap');
}

// ==== 2. EditorController primitives ==================================

async function testController_applyAdd_basic(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const entry = {
    widgetId: 'content.announcements',
    instanceId: 'w-new-1',
    config: { mode: 'text', text: 'Hi' },
  };
  const res = ctrl.applyAdd({ entry, region: 'sidebar', index: 1 });
  assert(res.ok, `applyAdd ok: ${JSON.stringify(res)}`);
  if (res.ok) {
    const nextDoc = res.nextDoc as unknown as { regions: { sidebar: Array<{ instanceId: string }> } };
    assertEq(nextDoc.regions.sidebar.length, 2, 'sidebar grew to 2');
    assertEq(nextDoc.regions.sidebar[1]!.instanceId, 'w-new-1', 'inserted at index 1');
  }
}

async function testController_applyAdd_appendDefaults(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const entry = { widgetId: 'content.announcements', instanceId: 'w-new-2', config: {} };
  const res = ctrl.applyAdd({ entry, region: 'main' });
  assert(res.ok, 'applyAdd with no index appends');
  if (res.ok) {
    assertEq(res.to?.index, 1, 'appended at end of main');
  }
}

async function testController_applyAdd_rejectsUnknownWidget(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const res = ctrl.applyAdd({
    entry: { widgetId: 'nope.nope', instanceId: 'x', config: {} },
    region: 'main',
    index: 0,
  });
  assert(!res.ok, 'rejected');
  if (!res.ok) assertEq(res.reason, 'unknown-widget', 'reason unknown-widget');
}

async function testController_applyAdd_rejectsDuplicateInstance(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const res = ctrl.applyAdd({
    entry: { widgetId: 'content.announcements', instanceId: 'w-main-1', config: {} },
    region: 'sidebar',
    index: 0,
  });
  assert(!res.ok, 'rejected');
  if (!res.ok) assertEq(res.reason, 'duplicate-instance-id', 'reason duplicate-instance-id');
}

async function testController_applyMove_crossRegion(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  ctrl.applyAdd({
    entry: { widgetId: 'content.announcements', instanceId: 'w-main-2', config: {} },
    region: 'main',
  });
  const res = ctrl.applyMove({ instanceId: 'w-main-2', region: 'sidebar', index: 1 });
  assert(res.ok, `move ok: ${JSON.stringify(res)}`);
  if (res.ok) {
    const nextDoc = res.nextDoc as unknown as { regions: { main: unknown[]; sidebar: unknown[] } };
    assertEq(nextDoc.regions.main.length, 1, 'main shrunk to 1');
    assertEq(nextDoc.regions.sidebar.length, 2, 'sidebar grew to 2');
    assertEq(res.to?.region, 'sidebar', 'to region correct');
    assertEq(res.to?.index, 1, 'to index correct');
  }
}

async function testController_applyMove_noop(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const res = ctrl.applyMove({ instanceId: 'w-main-1', region: 'main', index: 0 });
  assert(res.ok, 'move to same position is ok');
  if (res.ok) assertEq(res.noop, true, 'flagged as noop');
}

async function testController_applyMove_rejectsRequiredEmpty(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const res = ctrl.applyMove({ instanceId: 'w-main-1', region: 'sidebar', index: 0 });
  assert(!res.ok, 'rejected');
  if (!res.ok) assertEq(res.reason, 'required-region-empty', 'reason required-region-empty');
}

async function testController_applyMove_rejectsUnknownInstance(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const res = ctrl.applyMove({ instanceId: 'nope', region: 'main', index: 0 });
  assert(!res.ok, 'rejected');
  if (!res.ok) assertEq(res.reason, 'instance-not-found', 'reason instance-not-found');
}

async function testController_applyUpdate(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const res = ctrl.applyUpdate({ instanceId: 'w-main-1', config: { mode: 'text', text: 'Updated' } });
  assert(res.ok, 'update ok');
  const found = ctrl.findInstance('w-main-1');
  assertEq((found?.entry.config as { text: string })?.text, 'Updated', 'config replaced');
}

async function testController_applyRemove(): Promise<void> {
  const reg = makeWidgetRegistry();
  const doc = makeWelcomeDoc() as { regions: { sidebar: unknown[] } };
  doc.regions.sidebar.push({
    widgetId: 'content.announcements',
    instanceId: 'w-side-2',
    config: {},
  });
  const ctrl = new EditorController({
    pageDoc: doc as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const res = ctrl.applyRemove({ instanceId: 'w-side-2' });
  assert(res.ok, 'remove ok');
  if (res.ok) {
    const nextDoc = res.nextDoc as unknown as { regions: { sidebar: unknown[] } };
    assertEq(nextDoc.regions.sidebar.length, 1, 'sidebar shrunk');
  }
  assert(ctrl.findInstance('w-side-2') === null, 'instance gone from doc');
}

async function testController_applyRemove_refusesRequiredEmpty(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const res = ctrl.applyRemove({ instanceId: 'w-main-1' });
  assert(!res.ok, 'rejected');
  if (!res.ok) assertEq(res.reason, 'required-region-empty', 'reason required-region-empty');
}

async function testController_findInstanceAndList(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const found = ctrl.findInstance('w-main-1');
  assert(found, 'instance found');
  assertEq(found!.region, 'main', 'found in main');
  assertEq(found!.index, 0, 'at index 0');

  const list = ctrl.listEntries();
  assertEq(list.length, 2, 'two entries in welcome doc');
  assert(list.some((e) => e.instanceId === 'w-main-1'), 'w-main-1 listed');
  assert(list.some((e) => e.instanceId === 'w-side-1'), 'w-side-1 listed');
}

// ==== 3. EditorAPI ====================================================

async function testAPI_addAndList(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const saves: unknown[] = [];
  const api = new EditorAPI({
    controller: ctrl,
    onCommit: async (doc) => {
      saves.push(doc);
    },
  });
  const res = await api.add({
    widgetId: 'content.announcements',
    region: 'sidebar',
    instanceId: 'w-agent-1',
    config: { mode: 'text', text: 'from agent' },
  });
  assert(res.ok, 'add ok');
  if (res.ok) assertEq(res.instanceId, 'w-agent-1', 'returned instanceId');
  assertEq(saves.length, 1, 'onCommit called');
  assertEq(api.list().length, 3, 'list has 3 entries');
  const got = api.get('w-agent-1');
  assertEq((got?.config as { text?: string } | undefined)?.text, 'from agent', 'get returns config');
}

async function testAPI_addGeneratesInstanceId(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const api = new EditorAPI({ controller: ctrl, onCommit: async () => {} });
  const res = await api.add({ widgetId: 'content.announcements', region: 'sidebar' });
  assert(res.ok, 'add ok');
  if (res.ok) assert(res.instanceId && res.instanceId.startsWith('w-announcements-'), 'auto-id generated with widget suffix');
}

async function testAPI_moveById(): Promise<void> {
  const reg = makeWidgetRegistry();
  const doc = makeWelcomeDoc() as { regions: { main: unknown[] } };
  doc.regions.main.push({
    widgetId: 'content.announcements',
    instanceId: 'w-main-2',
    config: {},
  });
  const ctrl = new EditorController({
    pageDoc: doc as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const api = new EditorAPI({ controller: ctrl, onCommit: async () => {} });
  const res = await api.move({ instanceId: 'w-main-2', region: 'sidebar', index: 0 });
  assert(res.ok, 'move ok');
  assertEq(api.get('w-main-2')?.region, 'sidebar', 'now in sidebar');
  assertEq(api.get('w-main-2')?.index, 0, 'at index 0');
}

async function testAPI_updateConfig(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const api = new EditorAPI({ controller: ctrl, onCommit: async () => {} });
  const res = await api.update({
    instanceId: 'w-main-1',
    config: { mode: 'text', text: 'Updated by agent' },
  });
  assert(res.ok, 'update ok');
  assertEq(
    (api.get('w-main-1')?.config as { text?: string } | undefined)?.text,
    'Updated by agent',
    'config replaced',
  );
}

async function testAPI_remove(): Promise<void> {
  const reg = makeWidgetRegistry();
  const doc = makeWelcomeDoc() as { regions: { main: unknown[] } };
  doc.regions.main.push({
    widgetId: 'content.announcements',
    instanceId: 'w-main-2',
    config: {},
  });
  const ctrl = new EditorController({
    pageDoc: doc as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const api = new EditorAPI({ controller: ctrl, onCommit: async () => {} });
  const res = await api.remove({ instanceId: 'w-main-2' });
  assert(res.ok, 'remove ok');
  assert(api.get('w-main-2') === null, 'instance gone');
}

async function testAPI_rejectsNotEditable(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
    widgetRegistry: reg,
  });
  const api = new EditorAPI({
    controller: ctrl,
    onCommit: async () => {},
    isEditable: () => false,
  });
  const res = await api.add({ widgetId: 'content.announcements', region: 'sidebar' });
  assert(!res.ok, 'rejected');
  if (!res.ok) assertEq(res.reason, 'not-editable', 'reason not-editable');
}

async function testAPI_persistError(): Promise<void> {
  const reg = makeWidgetRegistry();
  const ctrl = new EditorController({
    pageDoc: makeWelcomeDoc() as never,
    templateManifest: templateTwoColumn as never,
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
  if (!res.ok) assertEq(res.reason, 'persist-failed', 'reason persist-failed');
}

async function testFreshInstanceId(): Promise<void> {
  const a = freshInstanceId('content.announcements');
  const b = freshInstanceId('content.announcements');
  assert(a !== b, 'two calls produce distinct ids');
  assert(a.startsWith('w-announcements-'), 'uses widgetId suffix');
}

// ==== 4. <content-page edit> DOM shape ================================

class StubPageStore {
  _map: Map<string, unknown>;
  saveCalls: Array<{ pageId: string; doc: unknown }> = [];

  constructor(seed?: Record<string, unknown>) {
    this._map = new Map();
    for (const [id, doc] of Object.entries(seed ?? {})) {
      this._map.set(id, structuredClone(doc));
    }
  }
  async get(pageId: string): Promise<unknown> {
    const d = this._map.get(pageId);
    return d ? structuredClone(d) : null;
  }
  async save(pageId: string, doc: unknown): Promise<void> {
    this.saveCalls.push({ pageId, doc: structuredClone(doc) });
    this._map.set(pageId, structuredClone(doc));
  }
  async list(): Promise<unknown[]> {
    return [...this._map.values()].map((d) => structuredClone(d));
  }
  async delete(pageId: string): Promise<void> {
    this._map.delete(pageId);
  }
}

async function testContentPage_dropSlotsAndCellsHaveUniqueNames(): Promise<void> {
  const pageStore = new StubPageStore({ welcome: makeWelcomeDoc() });
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page') as HTMLElement & Record<string, unknown> & { editor?: unknown };
  page['pageId'] = 'welcome';
  page['pageStore'] = pageStore;
  page['templateRegistry'] = templateRegistry;
  page['widgetRegistry'] = widgetRegistry;
  page['correlationId'] = 'cid-editor-dom';
  page['edit'] = true;
  page.setAttribute('edit', '');
  document.body.appendChild(page);
  await waitMicrotasks(40);

  const editor = page['editor'] as { add: (...a: unknown[]) => unknown; list: (...a: unknown[]) => unknown; remove: (args: { instanceId: string }) => Promise<{ ok: boolean }> } | null;
  assert(editor, 'page.editor is exposed');
  assert(typeof editor!.add === 'function', 'editor.add exists');
  assert(typeof editor!.list === 'function', 'editor.list exists');

  let emptySlots = findAllDescendants(
    page,
    (el) =>
      el.tagName === 'SECTION' &&
      el.getAttribute?.('data-editor-slot') !== null &&
      el.getAttribute?.('data-empty') === 'true',
  );
  assertEq(emptySlots.length, 0, 'filled sections are not marked data-empty');

  const cells = findAllDescendants(page, (el) => el.getAttribute?.('data-widget-cell') !== null);
  assertEq(cells.length, 2, 'two cells (main + sidebar)');
  for (const c of cells) {
    const instanceId = c.getAttribute('data-instance-id');
    assert(instanceId, 'cell has data-instance-id');
    assertEq(c.getAttribute('name'), `cell-${instanceId}`, 'cell has unique name');
    assertEq(c.getAttribute('tabindex'), '0', 'cell tabbable');
    assert(!c.hasAttribute('draggable'), 'cell is NOT native-draggable');
  }

  const legacy = findAllDescendants(page, (el) =>
    el.getAttribute?.('data-drop-zone') !== null ||
    el.getAttribute?.('data-drop-slot') !== null ||
    el.getAttribute?.('data-drop-target') !== null ||
    el.getAttribute?.('data-drop-empty') !== null ||
    el.getAttribute?.('data-drop-indicator') !== null,
  );
  assertEq(legacy.length, 0, 'no legacy drop-zone / drop-slot child markers');

  const deleteButtons = findAllDescendants(page, (el) => {
    const name = el.getAttribute?.('name');
    return typeof name === 'string' && name.startsWith('delete-');
  });
  assertEq(deleteButtons.length, 2, 'one delete button per cell');

  const sidebarCell = cells.find((c) => {
    let node: Element | null = c;
    while (node && node.nodeType === 1) {
      const slot = node.getAttribute?.('data-slot');
      if (slot) return slot === 'sidebar';
      node = node.parentNode as Element | null;
    }
    return false;
  });
  assert(sidebarCell, 'sidebar cell located');
  const res = await editor!.remove({
    instanceId: sidebarCell!.getAttribute('data-instance-id') as string,
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
    emptySlots[0]!.getAttribute('data-slot'),
    'sidebar',
    'the empty section is sidebar',
  );
  assertEq(
    emptySlots[0]!.getAttribute('name'),
    'drop-slot-sidebar',
    'slot name is region-keyed (no index suffix)',
  );

  page.remove();
  await waitMicrotasks(5);
}

async function testContentPage_editorAPI_add_moves_remove_persist(): Promise<void> {
  const pageStore = new StubPageStore({ welcome: makeWelcomeDoc() });
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page') as HTMLElement & Record<string, unknown> & { editor?: { add: (args: unknown) => Promise<{ ok: boolean; action?: string; instanceId?: string }>; move: (args: unknown) => Promise<{ ok: boolean }>; update: (args: unknown) => Promise<{ ok: boolean }>; remove: (args: unknown) => Promise<{ ok: boolean }> } };
  page['pageId'] = 'welcome';
  page['pageStore'] = pageStore;
  page['templateRegistry'] = templateRegistry;
  page['widgetRegistry'] = widgetRegistry;
  page['correlationId'] = 'cid-api-persist';
  page['edit'] = true;
  page.setAttribute('edit', '');
  document.body.appendChild(page);
  await waitMicrotasks(40);

  const addRes = await page.editor!.add({
    widgetId: 'content.announcements',
    region: 'sidebar',
    index: 1,
    instanceId: 'w-agent-1',
    config: { mode: 'text', text: 'from agent' },
  });
  assert(addRes.ok, `add ok: ${JSON.stringify(addRes)}`);
  await waitMicrotasks(40);
  assert(pageStore.saveCalls.length >= 1, 'pageStore.save called');
  const last1 = pageStore.saveCalls[pageStore.saveCalls.length - 1]!.doc as { regions: { sidebar: unknown[] } };
  assertEq(last1.regions.sidebar.length, 2, 'sidebar grew after add');

  const moveRes = await page.editor!.move({
    instanceId: 'w-agent-1',
    region: 'main',
    index: 0,
  });
  assert(moveRes.ok, `move ok: ${JSON.stringify(moveRes)}`);
  await waitMicrotasks(40);
  const last2 = pageStore.saveCalls[pageStore.saveCalls.length - 1]!.doc as { regions: { main: Array<{ instanceId: string }> } };
  assertEq(last2.regions.main[0]!.instanceId, 'w-agent-1', 'agent widget moved to main[0]');

  const updRes = await page.editor!.update({
    instanceId: 'w-agent-1',
    config: { mode: 'text', text: 'revised' },
  });
  assert(updRes.ok, 'update ok');
  await waitMicrotasks(40);
  const last3 = pageStore.saveCalls[pageStore.saveCalls.length - 1]!.doc as { regions: { main: Array<{ instanceId: string; config: { text?: string } }> } };
  const agentEntry = last3.regions.main.find((e) => e.instanceId === 'w-agent-1');
  assertEq(agentEntry?.config.text, 'revised', 'config updated');

  const rmRes = await page.editor!.remove({ instanceId: 'w-agent-1' });
  assert(rmRes.ok, 'remove ok');
  await waitMicrotasks(40);
  const last4 = pageStore.saveCalls[pageStore.saveCalls.length - 1]!.doc as { regions: { main: Array<{ instanceId: string }> } };
  assert(
    !last4.regions.main.some((e) => e.instanceId === 'w-agent-1'),
    'agent widget gone',
  );

  page.remove();
  await waitMicrotasks(5);
}

async function testContentPage_editorAPI_rejectsRequiredEmpty(): Promise<void> {
  const pageStore = new StubPageStore({ welcome: makeWelcomeDoc() });
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page') as HTMLElement & Record<string, unknown> & { editor?: { remove: (args: unknown) => Promise<{ ok: boolean; reason?: string }> } };
  page['pageId'] = 'welcome';
  page['pageStore'] = pageStore;
  page['templateRegistry'] = templateRegistry;
  page['widgetRegistry'] = widgetRegistry;
  page['correlationId'] = 'cid-api-required';
  page['edit'] = true;
  page.setAttribute('edit', '');
  document.body.appendChild(page);
  await waitMicrotasks(40);

  const res = await page.editor!.remove({ instanceId: 'w-main-1' });
  assert(!res.ok, 'rejected');
  assertEq(res.reason, 'required-region-empty', 'reason required-region-empty');

  page.remove();
  await waitMicrotasks(5);
}

// ==== 5. canEdit=false gate ==========================================

async function testCanEditFalseGate(): Promise<void> {
  const pageStore = new StubPageStore({ welcome: makeWelcomeDoc() });
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const telemetryEvents: Array<{ event: string; payload: unknown }> = [];
  const origDebug = console.debug;
  console.debug = ((event: string, payload: unknown): void => {
    telemetryEvents.push({ event, payload });
  }) as typeof console.debug;

  try {
    const page = document.createElement('content-page') as HTMLElement & Record<string, unknown>;
    page['pageId'] = 'welcome';
    page['pageStore'] = pageStore;
    page['templateRegistry'] = templateRegistry;
    page['widgetRegistry'] = widgetRegistry;
    page['correlationId'] = 'cid-editor-denied';
    page['edit'] = true;
    page['canEdit'] = false;
    page.setAttribute('edit', '');
    document.body.appendChild(page);
    await waitMicrotasks(40);

    const palette = findDescendant(
      page,
      (el) => el.tagName != null && el.tagName.toLowerCase() === 'widget-palette',
    );
    assert(!palette, 'palette NOT rendered when canEdit=false');
    assert(!page['editor'], 'editor API NOT exposed when canEdit=false');

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

async function testValidatingStoreRejection_asPersistFailed(): Promise<void> {
  const inner = new InMemoryPageStore();
  await inner.save('welcome', makeWelcomeDoc() as never);
  const store = new ValidatingPageStore(inner);
  const templateRegistry = makeTemplateRegistry();
  const widgetRegistry = makeWidgetRegistry();

  const page = document.createElement('content-page') as HTMLElement & Record<string, unknown> & { editor?: { add: (args: unknown) => Promise<{ ok: boolean; reason?: string }> } };
  page['pageId'] = 'welcome';
  page['pageStore'] = store;
  page['templateRegistry'] = templateRegistry;
  page['widgetRegistry'] = widgetRegistry;
  page['correlationId'] = 'cid-editor-reject';
  page['edit'] = true;
  page.setAttribute('edit', '');
  document.body.appendChild(page);
  await waitMicrotasks(40);

  const origSave = store.save.bind(store);
  store.save = async () => {
    throw new Error('schema violation: missing tenantId');
  };
  const res = await page.editor!.add({
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

async function main(): Promise<void> {
  await testComputeValidTargets_basic();
  await testComputeValidTargets_anyRegionAllowed();
  await testComputeValidTargets_unknownWidget();
  await testComputeValidTargets_maxWidgetsAtCap_newPlacement();
  await testComputeValidTargets_maxWidgetsMoveWithin();

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

  await testAPI_addAndList();
  await testAPI_addGeneratesInstanceId();
  await testAPI_moveById();
  await testAPI_updateConfig();
  await testAPI_remove();
  await testAPI_rejectsNotEditable();
  await testAPI_persistError();
  await testFreshInstanceId();

  await testContentPage_dropSlotsAndCellsHaveUniqueNames();
  await testContentPage_editorAPI_add_moves_remove_persist();
  await testContentPage_editorAPI_rejectsRequiredEmpty();
  await testCanEditFalseGate();
  await testValidatingStoreRejection_asPersistFailed();

  // eslint-disable-next-line no-console
  console.log('OK');
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', (err as Error | undefined)?.stack ?? err);
  process.exit(1);
});
