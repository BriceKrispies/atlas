/* eslint-disable no-console -- dry-run scripts diagnose to stdout/stderr by design */
/**
 * Editor dry-run: exercises the new zones-based editor and the imperative
 * EditorAPI end-to-end in a linkedom DOM.
 */
import { customElements, document, HTMLElementCtor, loadFixture } from './_lib/setup.ts';
import { must } from '../src/internal/assert.ts';
// ---- import package under test --------------------------------------
const pkg = await import('../src/index.ts');
const { TemplateRegistry, InMemoryPageStore, ValidatingPageStore, computeValidTargets, EditorController, EditorAPI, freshInstanceId, } = pkg;
import type { PageDocument, PageStore, WidgetInstance } from '../src/page-store.ts';
import type { TemplateManifest } from '../src/registry.ts';
import type { WidgetRegistryLike } from '../src/drop-zones.ts';
const { WidgetRegistry } = await import('@atlas/widget-host');
import type { WidgetManifest } from '@atlas/widget-host';
// ---- fixtures --------------------------------------------------------
const templateOneColumn = loadFixture<TemplateManifest>('page_template__valid__one_column.json');
const templateTwoColumn = loadFixture<TemplateManifest>('page_template__valid__two_column.json');
const docWelcome = loadFixture<PageDocument>('page_document__valid__welcome.json');
const announcementsManifest = loadFixture<Record<string, unknown>>('widget_manifest__valid__announcements.json');
// ---- utilities -------------------------------------------------------
function assert(cond: unknown, msg: string): void {
    if (!cond)
        throw new Error(`assertion failed: ${msg}`);
}
function assertEq<T>(a: T, b: T, msg: string): void {
    if (a !== b)
        throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
async function waitMicrotasks(n = 20): Promise<void> {
    for (let i = 0; i < n; i++)
        await Promise.resolve();
}
function findDescendant(node: Element | null, predicate: (el: Element) => boolean): Element | null {
    if (!node)
        return null;
    if (predicate(node))
        return node;
    for (const child of node.children) {
        const found = findDescendant(child, predicate);
        if (found)
            return found;
    }
    return null;
}
function findAllDescendants(node: Element | null, predicate: (el: Element) => boolean, out: Element[] = []): Element[] {
    if (!node)
        return out;
    if (predicate(node))
        out.push(node);
    for (const child of node.children)
        findAllDescendants(child, predicate, out);
    return out;
}
// ---- stub template + widget classes ---------------------------------
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
class AnnouncementsWidget extends HTMLElementCtor {
    _mounted = false;
    connectedCallback(): void {
        this._mounted = true;
    }
}
customElements.define('stub-announcements-widget-ed', AnnouncementsWidget);
function cleanAnnouncementsManifest(): WidgetManifest {
    const clean: Record<string, unknown> = { ...announcementsManifest };
    delete clean['$schema'];
    delete clean['$comment'];
    delete clean['$invariants'];
    return clean as WidgetManifest;
}
/**
 * Returns a `WidgetRegistryLike` view over a fresh `WidgetRegistry`.
 *
 * `WidgetRegistry` (widget-host) and `WidgetRegistryLike` (page-templates
 * drop-zones) are structurally compatible at runtime — both expose
 * `has` / `get` / `list` — but their declared `list()` return types
 * disagree on whether the entries carry an index signature. The wrapper
 * narrows the published shape and assigns through the structural
 * interface so call sites stay cast-free.
 */
function makeWidgetRegistry(): WidgetRegistryLike {
    const wr = new WidgetRegistry();
    wr.register({ manifest: cleanAnnouncementsManifest(), element: AnnouncementsWidget });
    return {
        has: function (id) {
            return wr.has(id);
        },
        get: function (id) {
            return wr.get(id);
        },
        // `WidgetRegistryListing` is structurally compatible with the entry
        // shape `WidgetRegistryLike.list()` advertises; we re-shape each
        // entry into a plain string-keyed record so the index signature is
        // present in the published type.
        list: function () {
            return wr.list().map(function (l) {
                return ({
                    widgetId: l.widgetId,
                    version: l.version,
                    displayName: l.displayName,
                });
            });
        },
    };
}
function makeTemplateRegistry(): InstanceType<typeof TemplateRegistry> {
    const tr = new TemplateRegistry();
    tr.register({ manifest: templateOneColumn, element: OneColumnTemplate });
    tr.register({ manifest: templateTwoColumn, element: TwoColumnTemplate });
    return tr;
}
function makeWelcomeDoc(): PageDocument {
    return structuredClone(docWelcome);
}
// ==== 1. computeValidTargets ==========================================
async function testComputeValidTargets_basic(): Promise<void> {
    const reg = makeWidgetRegistry();
    const result = computeValidTargets('content.announcements', docWelcome, templateTwoColumn, reg, null);
    const main = result.validRegions.find(function (r) {
        return r.regionName === 'main';
    });
    const sidebar = result.validRegions.find(function (r) {
        return r.regionName === 'sidebar';
    });
    const mainR = must(main, 'main region valid for announcements');
    const sidebarR = must(sidebar, 'sidebar region valid for announcements');
    assertEq(mainR.canInsertAt.length, 2, 'main insertion slots');
    assert(mainR.canInsertAt.every(function (b) {
        return b === true;
    }), 'all main positions valid');
    assertEq(sidebarR.canInsertAt.length, 2, 'sidebar insertion slots');
}
async function testComputeValidTargets_anyRegionAllowed(): Promise<void> {
    const reg = makeWidgetRegistry();
    const tpl: TemplateManifest = {
        templateId: 't',
        version: '0.1.0',
        element: 'x',
        regions: [{ name: 'header' }, { name: 'footer' }],
    };
    const doc: PageDocument = { pageId: 'p', regions: { header: [], footer: [] } };
    const result = computeValidTargets('content.announcements', doc, tpl, reg);
    assertEq(result.validRegions.length, 2, 'both regions valid');
    assertEq(result.invalidRegions.length, 0, 'no invalid regions');
}
async function testComputeValidTargets_unknownWidget(): Promise<void> {
    const reg = makeWidgetRegistry();
    const tpl: TemplateManifest = {
        templateId: 't',
        version: '0.1.0',
        element: 'x',
        regions: [{ name: 'main' }],
    };
    const doc: PageDocument = { pageId: 'p', regions: { main: [] } };
    const result = computeValidTargets('content.does-not-exist', doc, tpl, reg);
    assertEq(result.validRegions.length, 0, 'no valid regions for unknown widget');
    assertEq(result.invalidRegions.length, 1, 'one invalid region');
    const invalid = must(result.invalidRegions[0], 'one invalid region present');
    assertEq(invalid.reason, 'unknown-widget', 'reason unknown-widget');
}
async function testComputeValidTargets_maxWidgetsAtCap_newPlacement(): Promise<void> {
    const reg = makeWidgetRegistry();
    const tpl: TemplateManifest = {
        templateId: 't',
        version: '0.1.0',
        element: 'x',
        regions: [{ name: 'main', maxWidgets: 1 }],
    };
    const doc: PageDocument = {
        pageId: 'p',
        regions: {
            main: [{ widgetId: 'content.announcements', instanceId: 'x', config: {} }],
        },
    };
    const result = computeValidTargets('content.announcements', doc, tpl, reg, null);
    const main = must(result.validRegions.find(function (r) {
        return r.regionName === 'main';
    }), 'main is returned with capped state');
    assertEq(main.reason, 'max-widgets', 'reason is max-widgets');
    assert(main.canInsertAt.every(function (b) {
        return b === false;
    }), 'no insertion allowed');
}
async function testComputeValidTargets_maxWidgetsMoveWithin(): Promise<void> {
    const reg = makeWidgetRegistry();
    const tpl: TemplateManifest = {
        templateId: 't',
        version: '0.1.0',
        element: 'x',
        regions: [{ name: 'main', maxWidgets: 2 }],
    };
    const doc: PageDocument = {
        pageId: 'p',
        regions: {
            main: [
                { widgetId: 'content.announcements', instanceId: 'a', config: {} },
                { widgetId: 'content.announcements', instanceId: 'b', config: {} },
            ],
        },
    };
    const result = computeValidTargets('content.announcements', doc, tpl, reg, { regionName: 'main', index: 0 });
    const main = must(result.validRegions.find(function (r) {
        return r.regionName === 'main';
    }), 'main valid');
    assert(main.canInsertAt.every(function (b) {
        return b === true;
    }), 'move-within allowed at cap');
}
// ==== 2. EditorController primitives ==================================
async function testController_applyAdd_basic(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const entry: WidgetInstance = {
        widgetId: 'content.announcements',
        instanceId: 'w-new-1',
        config: { mode: 'text', text: 'Hi' },
    };
    const res = ctrl.applyAdd({ entry, region: 'sidebar', index: 1 });
    assert(res.ok, `applyAdd ok: ${JSON.stringify(res)}`);
    if (res.ok) {
        const sidebar = must(res.nextDoc.regions?.['sidebar'], 'sidebar region present');
        assertEq(sidebar.length, 2, 'sidebar grew to 2');
        const inserted = must(sidebar[1], 'inserted entry at index 1');
        assertEq(inserted.instanceId, 'w-new-1', 'inserted at index 1');
    }
}
async function testController_applyAdd_appendDefaults(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const entry: WidgetInstance = { widgetId: 'content.announcements', instanceId: 'w-new-2', config: {} };
    const res = ctrl.applyAdd({ entry, region: 'main' });
    assert(res.ok, 'applyAdd with no index appends');
    if (res.ok) {
        assertEq(res.to?.index, 1, 'appended at end of main');
    }
}
async function testController_applyAdd_rejectsUnknownWidget(): Promise<void> {
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
    if (!res.ok)
        assertEq(res.reason, 'unknown-widget', 'reason unknown-widget');
}
async function testController_applyAdd_rejectsDuplicateInstance(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const res = ctrl.applyAdd({
        entry: { widgetId: 'content.announcements', instanceId: 'w-main-1', config: {} },
        region: 'sidebar',
        index: 0,
    });
    assert(!res.ok, 'rejected');
    if (!res.ok)
        assertEq(res.reason, 'duplicate-instance-id', 'reason duplicate-instance-id');
}
async function testController_applyMove_crossRegion(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    ctrl.applyAdd({
        entry: { widgetId: 'content.announcements', instanceId: 'w-main-2', config: {} },
        region: 'main',
    });
    const res = ctrl.applyMove({ instanceId: 'w-main-2', region: 'sidebar', index: 1 });
    assert(res.ok, `move ok: ${JSON.stringify(res)}`);
    if (res.ok) {
        const main = must(res.nextDoc.regions?.['main'], 'main region present');
        const sidebar = must(res.nextDoc.regions?.['sidebar'], 'sidebar region present');
        assertEq(main.length, 1, 'main shrunk to 1');
        assertEq(sidebar.length, 2, 'sidebar grew to 2');
        assertEq(res.to?.region, 'sidebar', 'to region correct');
        assertEq(res.to?.index, 1, 'to index correct');
    }
}
async function testController_applyMove_noop(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const res = ctrl.applyMove({ instanceId: 'w-main-1', region: 'main', index: 0 });
    assert(res.ok, 'move to same position is ok');
    if (res.ok)
        assertEq(res.noop, true, 'flagged as noop');
}
async function testController_applyMove_rejectsRequiredEmpty(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const res = ctrl.applyMove({ instanceId: 'w-main-1', region: 'sidebar', index: 0 });
    assert(!res.ok, 'rejected');
    if (!res.ok)
        assertEq(res.reason, 'required-region-empty', 'reason required-region-empty');
}
async function testController_applyMove_rejectsUnknownInstance(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const res = ctrl.applyMove({ instanceId: 'nope', region: 'main', index: 0 });
    assert(!res.ok, 'rejected');
    if (!res.ok)
        assertEq(res.reason, 'instance-not-found', 'reason instance-not-found');
}
async function testController_applyUpdate(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const res = ctrl.applyUpdate({ instanceId: 'w-main-1', config: { mode: 'text', text: 'Updated' } });
    assert(res.ok, 'update ok');
    const found = must(ctrl.findInstance('w-main-1'), 'w-main-1 found');
    assertEq(found.entry.config?.['text'], 'Updated', 'config replaced');
}
async function testController_applyRemove(): Promise<void> {
    const reg = makeWidgetRegistry();
    const doc = makeWelcomeDoc();
    const sidebar = must(doc.regions?.['sidebar'], 'welcome doc has sidebar region');
    sidebar.push({
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
    if (res.ok) {
        const sidebarAfter = must(res.nextDoc.regions?.['sidebar'], 'sidebar region present');
        assertEq(sidebarAfter.length, 1, 'sidebar shrunk');
    }
    assert(ctrl.findInstance('w-side-2') === null, 'instance gone from doc');
}
async function testController_applyRemove_refusesRequiredEmpty(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const res = ctrl.applyRemove({ instanceId: 'w-main-1' });
    assert(!res.ok, 'rejected');
    if (!res.ok)
        assertEq(res.reason, 'required-region-empty', 'reason required-region-empty');
}
async function testController_findInstanceAndList(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const found = must(ctrl.findInstance('w-main-1'), 'instance found');
    assertEq(found.region, 'main', 'found in main');
    assertEq(found.index, 0, 'at index 0');
    const list = ctrl.listEntries();
    assertEq(list.length, 2, 'two entries in welcome doc');
    assert(list.some(function (e) {
        return e.instanceId === 'w-main-1';
    }), 'w-main-1 listed');
    assert(list.some(function (e) {
        return e.instanceId === 'w-side-1';
    }), 'w-side-1 listed');
}
// ==== 3. EditorAPI ====================================================
async function testAPI_addAndList(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const saves: PageDocument[] = [];
    const api = new EditorAPI({
        controller: ctrl,
        onCommit: async function (doc) {
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
    if (res.ok)
        assertEq(res.instanceId, 'w-agent-1', 'returned instanceId');
    assertEq(saves.length, 1, 'onCommit called');
    assertEq(api.list().length, 3, 'list has 3 entries');
    const got = must(api.get('w-agent-1'), 'w-agent-1 retrievable');
    assertEq(got.config['text'], 'from agent', 'get returns config');
}
async function testAPI_addGeneratesInstanceId(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const api = new EditorAPI({ controller: ctrl, onCommit: async function () { } });
    const res = await api.add({ widgetId: 'content.announcements', region: 'sidebar' });
    assert(res.ok, 'add ok');
    if (res.ok) {
        const id = must(res.instanceId, 'instanceId generated');
        assert(id.startsWith('w-announcements-'), 'auto-id generated with widget suffix');
    }
}
async function testAPI_moveById(): Promise<void> {
    const reg = makeWidgetRegistry();
    const doc = makeWelcomeDoc();
    const main = must(doc.regions?.['main'], 'welcome doc has main region');
    main.push({
        widgetId: 'content.announcements',
        instanceId: 'w-main-2',
        config: {},
    });
    const ctrl = new EditorController({
        pageDoc: doc,
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const api = new EditorAPI({ controller: ctrl, onCommit: async function () { } });
    const res = await api.move({ instanceId: 'w-main-2', region: 'sidebar', index: 0 });
    assert(res.ok, 'move ok');
    const after = must(api.get('w-main-2'), 'w-main-2 retrievable after move');
    assertEq(after.region, 'sidebar', 'now in sidebar');
    assertEq(after.index, 0, 'at index 0');
}
async function testAPI_updateConfig(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const api = new EditorAPI({ controller: ctrl, onCommit: async function () { } });
    const res = await api.update({
        instanceId: 'w-main-1',
        config: { mode: 'text', text: 'Updated by agent' },
    });
    assert(res.ok, 'update ok');
    const after = must(api.get('w-main-1'), 'w-main-1 retrievable after update');
    assertEq(after.config['text'], 'Updated by agent', 'config replaced');
}
async function testAPI_remove(): Promise<void> {
    const reg = makeWidgetRegistry();
    const doc = makeWelcomeDoc();
    const main = must(doc.regions?.['main'], 'welcome doc has main region');
    main.push({
        widgetId: 'content.announcements',
        instanceId: 'w-main-2',
        config: {},
    });
    const ctrl = new EditorController({
        pageDoc: doc,
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const api = new EditorAPI({ controller: ctrl, onCommit: async function () { } });
    const res = await api.remove({ instanceId: 'w-main-2' });
    assert(res.ok, 'remove ok');
    assert(api.get('w-main-2') === null, 'instance gone');
}
async function testAPI_rejectsNotEditable(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const api = new EditorAPI({
        controller: ctrl,
        onCommit: async function () { },
        isEditable: function () {
            return false;
        },
    });
    const res = await api.add({ widgetId: 'content.announcements', region: 'sidebar' });
    assert(!res.ok, 'rejected');
    if (!res.ok)
        assertEq(res.reason, 'not-editable', 'reason not-editable');
}
async function testAPI_persistError(): Promise<void> {
    const reg = makeWidgetRegistry();
    const ctrl = new EditorController({
        pageDoc: makeWelcomeDoc(),
        templateManifest: templateTwoColumn,
        widgetRegistry: reg,
    });
    const api = new EditorAPI({
        controller: ctrl,
        onCommit: async function () {
            throw new Error('disk full');
        },
    });
    const res = await api.add({ widgetId: 'content.announcements', region: 'sidebar' });
    assert(!res.ok, 'rejected');
    if (!res.ok)
        assertEq(res.reason, 'persist-failed', 'reason persist-failed');
}
async function testFreshInstanceId(): Promise<void> {
    const a = freshInstanceId('content.announcements');
    const b = freshInstanceId('content.announcements');
    assert(a !== b, 'two calls produce distinct ids');
    assert(a.startsWith('w-announcements-'), 'uses widgetId suffix');
}
// ==== 4. <content-page edit> DOM shape ================================
class StubPageStore implements PageStore {
    _map: Map<string, PageDocument>;
    saveCalls: Array<{
        pageId: string;
        doc: PageDocument;
    }> = [];
    constructor(seed?: Record<string, PageDocument>) {
        this._map = new Map();
        for (const [id, doc] of Object.entries(seed ?? {})) {
            this._map.set(id, structuredClone(doc));
        }
    }
    async get(pageId: string): Promise<PageDocument | null> {
        const d = this._map.get(pageId);
        return d ? structuredClone(d) : null;
    }
    async save(pageId: string, doc: PageDocument): Promise<void> {
        this.saveCalls.push({ pageId, doc: structuredClone(doc) });
        this._map.set(pageId, structuredClone(doc));
    }
    async list(): Promise<PageDocument[]> {
        return [...this._map.values()].map(function (d) {
            return structuredClone(d);
        });
    }
    async delete(pageId: string): Promise<void> {
        this._map.delete(pageId);
    }
}
// Shape of <content-page> the dry-run pokes properties on.
type EditorEl = {
    add: (args: unknown) => Promise<{
        ok: boolean;
        action?: string;
        instanceId?: string;
        reason?: string;
    }>;
    list: () => unknown;
    remove: (args: {
        instanceId: string;
    }) => Promise<{
        ok: boolean;
        reason?: string;
    }>;
    move: (args: unknown) => Promise<{
        ok: boolean;
    }>;
    update: (args: unknown) => Promise<{
        ok: boolean;
    }>;
};
type ContentPageEl = HTMLElement & {
    pageId?: string;
    pageStore?: PageStore;
    templateRegistry?: unknown;
    widgetRegistry?: unknown;
    correlationId?: string;
    edit?: boolean;
    canEdit?: boolean;
    editor?: EditorEl;
};
async function testContentPage_dropSlotsAndCellsHaveUniqueNames(): Promise<void> {
    const pageStore = new StubPageStore({ welcome: makeWelcomeDoc() });
    const templateRegistry = makeTemplateRegistry();
    const widgetRegistry = makeWidgetRegistry();
    const page = document.createElement('content-page') as ContentPageEl;
    page.pageId = 'welcome';
    page.pageStore = pageStore;
    page.templateRegistry = templateRegistry;
    page.widgetRegistry = widgetRegistry;
    page.correlationId = 'cid-editor-dom';
    page.edit = true;
    page.setAttribute('edit', '');
    document.body.appendChild(page);
    await waitMicrotasks(40);
    const editor = must(page.editor, 'page.editor is exposed');
    assert(typeof editor.add === 'function', 'editor.add exists');
    assert(typeof editor.list === 'function', 'editor.list exists');
    let emptySlots = findAllDescendants(page, function (el) {
        return el.tagName === 'SECTION' &&
            el.getAttribute('data-editor-slot') !== null &&
            el.getAttribute('data-empty') === 'true';
    });
    assertEq(emptySlots.length, 0, 'filled sections are not marked data-empty');
    const cells = findAllDescendants(page, function (el) {
        return el.getAttribute('data-widget-cell') !== null;
    });
    assertEq(cells.length, 2, 'two cells (main + sidebar)');
    for (const c of cells) {
        const instanceId = must(c.getAttribute('data-instance-id'), 'cell has data-instance-id');
        assertEq(c.getAttribute('name'), `cell-${instanceId}`, 'cell has unique name');
        assertEq(c.getAttribute('tabindex'), '0', 'cell tabbable');
        assert(!c.hasAttribute('draggable'), 'cell is NOT native-draggable');
    }
    const legacy = findAllDescendants(page, function (el) {
        return el.getAttribute('data-drop-zone') !== null ||
            el.getAttribute('data-drop-slot') !== null ||
            el.getAttribute('data-drop-target') !== null ||
            el.getAttribute('data-drop-empty') !== null ||
            el.getAttribute('data-drop-indicator') !== null;
    });
    assertEq(legacy.length, 0, 'no legacy drop-zone / drop-slot child markers');
    const deleteButtons = findAllDescendants(page, function (el) {
        const name = el.getAttribute('name');
        return typeof name === 'string' && name.startsWith('delete-');
    });
    assertEq(deleteButtons.length, 2, 'one delete button per cell');
    const sidebarCell = must(cells.find(function (c) {
        let node: Element | null = c;
        while (node) {
            const slot = node.getAttribute('data-slot');
            if (slot)
                return slot === 'sidebar';
            // `parentElement` is `Element | null` — exactly the narrowing
            // we want (skips DocumentFragment/Document parents and avoids
            // the `Node` widening of `parentNode`).
            node = node.parentElement;
        }
        return false;
    }), 'sidebar cell located');
    const sidebarId = must(sidebarCell.getAttribute('data-instance-id'), 'sidebar cell has instance id');
    const res = await editor.remove({ instanceId: sidebarId });
    assert(res.ok, 'sidebar remove succeeded');
    await waitMicrotasks(40);
    emptySlots = findAllDescendants(page, function (el) {
        return el.tagName === 'SECTION' &&
            el.getAttribute('data-editor-slot') !== null &&
            el.getAttribute('data-empty') === 'true';
    });
    assertEq(emptySlots.length, 1, 'one section marked empty for the emptied region');
    const emptySection = must(emptySlots[0], 'emptied section');
    assertEq(emptySection.getAttribute('data-slot'), 'sidebar', 'the empty section is sidebar');
    assertEq(emptySection.getAttribute('name'), 'drop-slot-sidebar', 'slot name is region-keyed (no index suffix)');
    page.remove();
    await waitMicrotasks(5);
}
async function testContentPage_editorAPI_add_moves_remove_persist(): Promise<void> {
    const pageStore = new StubPageStore({ welcome: makeWelcomeDoc() });
    const templateRegistry = makeTemplateRegistry();
    const widgetRegistry = makeWidgetRegistry();
    const page = document.createElement('content-page') as ContentPageEl;
    page.pageId = 'welcome';
    page.pageStore = pageStore;
    page.templateRegistry = templateRegistry;
    page.widgetRegistry = widgetRegistry;
    page.correlationId = 'cid-api-persist';
    page.edit = true;
    page.setAttribute('edit', '');
    document.body.appendChild(page);
    await waitMicrotasks(40);
    const editor = must(page.editor, 'editor exposed');
    const addRes = await editor.add({
        widgetId: 'content.announcements',
        region: 'sidebar',
        index: 1,
        instanceId: 'w-agent-1',
        config: { mode: 'text', text: 'from agent' },
    });
    assert(addRes.ok, `add ok: ${JSON.stringify(addRes)}`);
    await waitMicrotasks(40);
    assert(pageStore.saveCalls.length >= 1, 'pageStore.save called');
    const last1 = must(pageStore.saveCalls[pageStore.saveCalls.length - 1], 'last save call').doc;
    const sidebar1 = must(last1.regions?.['sidebar'], 'sidebar region present');
    assertEq(sidebar1.length, 2, 'sidebar grew after add');
    const moveRes = await editor.move({
        instanceId: 'w-agent-1',
        region: 'main',
        index: 0,
    });
    assert(moveRes.ok, `move ok: ${JSON.stringify(moveRes)}`);
    await waitMicrotasks(40);
    const last2 = must(pageStore.saveCalls[pageStore.saveCalls.length - 1], 'last save call').doc;
    const main2 = must(last2.regions?.['main'], 'main region present');
    const moved = must(main2[0], 'agent widget at main[0]');
    assertEq(moved.instanceId, 'w-agent-1', 'agent widget moved to main[0]');
    const updRes = await editor.update({
        instanceId: 'w-agent-1',
        config: { mode: 'text', text: 'revised' },
    });
    assert(updRes.ok, 'update ok');
    await waitMicrotasks(40);
    const last3 = must(pageStore.saveCalls[pageStore.saveCalls.length - 1], 'last save call').doc;
    const main3 = must(last3.regions?.['main'], 'main region present');
    const agentEntry = must(main3.find(function (e) {
        return e.instanceId === 'w-agent-1';
    }), 'agent entry present');
    assertEq(agentEntry.config?.['text'], 'revised', 'config updated');
    const rmRes = await editor.remove({ instanceId: 'w-agent-1' });
    assert(rmRes.ok, 'remove ok');
    await waitMicrotasks(40);
    const last4 = must(pageStore.saveCalls[pageStore.saveCalls.length - 1], 'last save call').doc;
    const main4 = must(last4.regions?.['main'], 'main region present');
    assert(!main4.some(function (e) {
        return e.instanceId === 'w-agent-1';
    }), 'agent widget gone');
    page.remove();
    await waitMicrotasks(5);
}
async function testContentPage_editorAPI_rejectsRequiredEmpty(): Promise<void> {
    const pageStore = new StubPageStore({ welcome: makeWelcomeDoc() });
    const templateRegistry = makeTemplateRegistry();
    const widgetRegistry = makeWidgetRegistry();
    const page = document.createElement('content-page') as ContentPageEl;
    page.pageId = 'welcome';
    page.pageStore = pageStore;
    page.templateRegistry = templateRegistry;
    page.widgetRegistry = widgetRegistry;
    page.correlationId = 'cid-api-required';
    page.edit = true;
    page.setAttribute('edit', '');
    document.body.appendChild(page);
    await waitMicrotasks(40);
    const editor = must(page.editor, 'editor exposed');
    const res = await editor.remove({ instanceId: 'w-main-1' });
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
    const telemetryEvents: Array<{
        event: string;
        payload: unknown;
    }> = [];
    const origDebug = console.debug;
    console.debug = (function (event: string, payload: unknown): void {
        telemetryEvents.push({ event, payload });
    }) as typeof console.debug;
    try {
        const page = document.createElement('content-page') as ContentPageEl;
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
        const palette = findDescendant(page, function (el) {
            return el.tagName.toLowerCase() === 'widget-palette';
        });
        assert(!palette, 'palette NOT rendered when canEdit=false');
        assert(!page.editor, 'editor API NOT exposed when canEdit=false');
        const denied = telemetryEvents.find(function (e) {
            return e.event === 'atlas.content-page.edit.denied';
        });
        assert(denied, 'atlas.content-page.edit.denied emitted');
        page.remove();
        await waitMicrotasks(5);
    }
    finally {
        console.debug = origDebug;
    }
}
// ==== 6. ValidatingPageStore rejection =================================
async function testValidatingStoreRejection_asPersistFailed(): Promise<void> {
    const inner = new InMemoryPageStore();
    await inner.save('welcome', makeWelcomeDoc());
    const store = new ValidatingPageStore(inner);
    const templateRegistry = makeTemplateRegistry();
    const widgetRegistry = makeWidgetRegistry();
    const page = document.createElement('content-page') as ContentPageEl;
    page.pageId = 'welcome';
    page.pageStore = store;
    page.templateRegistry = templateRegistry;
    page.widgetRegistry = widgetRegistry;
    page.correlationId = 'cid-editor-reject';
    page.edit = true;
    page.setAttribute('edit', '');
    document.body.appendChild(page);
    await waitMicrotasks(40);
    const editor = must(page.editor, 'editor exposed');
    const origSave = store.save.bind(store);
    store.save = async function () {
        throw new Error('schema violation: missing tenantId');
    };
    const res = await editor.add({
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
    console.log('OK');
}
main().catch(function (err: unknown) {
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('FAIL:', stack ?? err);
    process.exit(1);
});
