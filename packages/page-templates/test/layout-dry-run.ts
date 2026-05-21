/* eslint-disable no-console -- dry-run scripts diagnose to stdout/stderr by design */
/**
 * Layout subsystem dry-run: exercises the data model, store, registry,
 * and <atlas-layout> rendering in a linkedom DOM.
 */
import { document } from './_lib/setup.ts';
import { must } from '../src/internal/assert.ts';
const { validateLayoutDocument, emptyLayoutDocument, nextFreeRect, InMemoryLayoutStore, ValidatingLayoutStore, LayoutRegistry, presetLayouts, } = await import('../src/layout/index.ts');
function assert(cond: unknown, msg: string): void {
    if (!cond)
        throw new Error(`assertion failed: ${msg}`);
}
function assertEq<T>(a: T, b: T, msg: string): void {
    if (a !== b) {
        throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    }
}
// ---- validator -------------------------------------------------------
function testValidate_acceptsMinimalDoc(): void {
    const res = validateLayoutDocument({
        layoutId: 'x',
        version: '0.1.0',
        grid: { columns: 12, rowHeight: 160, gap: 16 },
        slots: [{ name: 'main', col: 1, row: 1, colSpan: 12, rowSpan: 2 }],
    });
    assert(res.ok, 'minimal doc validates');
}
function testValidate_rejectsBadVersion(): void {
    const res = validateLayoutDocument({
        layoutId: 'x',
        version: 'v1',
        grid: { columns: 12, rowHeight: 160, gap: 16 },
        slots: [],
    });
    assert(!res.ok, 'rejected');
    if (!res.ok)
        assert(res.errors.some(function (e) {
            return e.path === 'version';
        }), 'version error present');
}
function testValidate_rejectsOverlap_not_yet(): void {
    const res = validateLayoutDocument({
        layoutId: 'x',
        version: '0.1.0',
        grid: { columns: 12, rowHeight: 160, gap: 16 },
        slots: [
            { name: 'a', col: 1, row: 1, colSpan: 6, rowSpan: 1 },
            { name: 'a', col: 7, row: 1, colSpan: 6, rowSpan: 1 },
        ],
    });
    assert(!res.ok, 'duplicate names rejected');
    if (!res.ok) {
        assert(res.errors.some(function (e) {
            return /duplicate/.test(e.message);
        }), 'duplicate-name error present');
    }
}
function testValidate_rejectsSlotBeyondColumns(): void {
    const res = validateLayoutDocument({
        layoutId: 'x',
        version: '0.1.0',
        grid: { columns: 6, rowHeight: 160, gap: 16 },
        slots: [{ name: 'big', col: 3, row: 1, colSpan: 6, rowSpan: 1 }],
    });
    assert(!res.ok, 'out-of-bounds rejected');
    if (!res.ok) {
        assert(res.errors.some(function (e) {
            return /extends beyond grid.columns/.test(e.message);
        }), 'bounds error present');
    }
}
// ---- emptyLayoutDocument + nextFreeRect ------------------------------
function testEmpty_andNextFreeRect(): void {
    const doc = emptyLayoutDocument({ layoutId: 'empty' });
    assertEq(doc.slots.length, 0, 'empty doc has no slots');
    const r1 = nextFreeRect(doc, { colSpan: 4, rowSpan: 2 });
    assertEq(r1.col, 1, 'first free rect starts at col 1');
    assertEq(r1.row, 1, 'first free rect starts at row 1');
    doc.slots.push({ name: 'a', ...r1 });
    const r2 = nextFreeRect(doc, { colSpan: 4, rowSpan: 2 });
    assert(r2.col !== r1.col || r2.row !== r1.row, 'next rect avoids occupied cell');
}
// ---- stores ----------------------------------------------------------
async function testInMemoryStore_roundTrip(): Promise<void> {
    const store = new InMemoryLayoutStore();
    const doc = emptyLayoutDocument({ layoutId: 'my-layout' });
    doc.slots.push({ name: 'main', col: 1, row: 1, colSpan: 12, rowSpan: 2 });
    await store.save('my-layout', doc);
    const back = must(await store.get('my-layout'), 'just saved my-layout');
    assertEq(back.layoutId, 'my-layout', 'id preserved');
    assertEq(back.slots.length, 1, 'slots preserved');
    back.slots.push({ name: 'x', col: 1, row: 1, colSpan: 1, rowSpan: 1 });
    const again = must(await store.get('my-layout'), 'still present');
    assertEq(again.slots.length, 1, "store wasn't mutated by caller");
}
async function testValidatingStore_rejectsInvalid(): Promise<void> {
    const store = new ValidatingLayoutStore(new InMemoryLayoutStore());
    let threw = false;
    try {
        await store.save('bad', {
            layoutId: 'bad',
            version: 'nope',
            grid: { columns: 12, rowHeight: 160, gap: 16 },
            slots: [],
        });
    }
    catch {
        threw = true;
    }
    assert(threw, 'validating store rejects invalid doc');
}
async function testValidatingStore_rejectsIdMismatch(): Promise<void> {
    const store = new ValidatingLayoutStore(new InMemoryLayoutStore());
    let threw = false;
    try {
        await store.save('one-id', {
            layoutId: 'different-id',
            version: '0.1.0',
            grid: { columns: 12, rowHeight: 160, gap: 16 },
            slots: [],
        });
    }
    catch {
        threw = true;
    }
    assert(threw, 'id mismatch rejected');
}
// ---- registry --------------------------------------------------------
function testRegistry_registerAndGet(): void {
    const reg = new LayoutRegistry();
    const doc = {
        layoutId: 'r',
        version: '0.1.0',
        grid: { columns: 12, rowHeight: 160, gap: 16 },
        slots: [{ name: 'main', col: 1, row: 1, colSpan: 12, rowSpan: 1 }],
    };
    reg.register(doc);
    assert(reg.has('r'), 'registered');
    const back = must(reg.get('r'), 'just registered r');
    assertEq(back.layoutId, 'r', 'get returns same id');
    back.slots = [];
    const again = must(reg.get('r'), 'still registered');
    assertEq(again.slots.length, 1, 'registry clone preserves stored value');
}
function testPresets_allValid(): void {
    for (const doc of presetLayouts) {
        const res = validateLayoutDocument(doc);
        const errs = res.ok ? undefined : res.errors;
        assert(res.ok, `preset ${doc.layoutId} invalid: ${JSON.stringify(errs)}`);
    }
    assertEq(presetLayouts.length, 6, 'six presets shipped');
}
// ---- <atlas-layout> rendering ---------------------------------------
type AtlasLayoutEl = HTMLElement & {
    layout?: unknown;
};
function testAtlasLayout_createsPositionedSections(): void {
    const el = document.createElement('atlas-layout') as AtlasLayoutEl;
    document.body.appendChild(el);
    el.layout = {
        layoutId: 'render-test',
        version: '0.1.0',
        grid: { columns: 12, rowHeight: 200, gap: 8 },
        slots: [
            { name: 'header', col: 1, row: 1, colSpan: 12, rowSpan: 1 },
            { name: 'main', col: 1, row: 2, colSpan: 8, rowSpan: 2 },
            { name: 'side', col: 9, row: 2, colSpan: 4, rowSpan: 2 },
        ],
    };
    const sections = el.querySelectorAll(':scope > section[data-slot]');
    assertEq(sections.length, 3, 'three sections rendered');
    const header = must(el.querySelector<HTMLElement>(':scope > section[data-slot="header"]'), 'header section just rendered');
    assert(header.style.gridColumn.includes('1') && header.style.gridColumn.includes('span 12'), `header grid-column set (got "${header.style.gridColumn}")`);
    assert(el.style.gridTemplateColumns.includes('repeat(12'), `host grid-template-columns set (got "${el.style.gridTemplateColumns}")`);
    assertEq(el.getAttribute('data-layout-id'), 'render-test', 'data-layout-id reflected');
    el.remove();
}
function testAtlasLayout_addAndRemoveSlots(): void {
    const el = document.createElement('atlas-layout') as AtlasLayoutEl;
    document.body.appendChild(el);
    el.layout = {
        layoutId: 't',
        version: '0.1.0',
        grid: { columns: 12, rowHeight: 160, gap: 16 },
        slots: [
            { name: 'a', col: 1, row: 1, colSpan: 6, rowSpan: 1 },
            { name: 'b', col: 7, row: 1, colSpan: 6, rowSpan: 1 },
        ],
    };
    assertEq(el.querySelectorAll(':scope > section[data-slot]').length, 2, 'two sections after first apply');
    el.layout = {
        layoutId: 't',
        version: '0.1.0',
        grid: { columns: 12, rowHeight: 160, gap: 16 },
        slots: [
            { name: 'a', col: 1, row: 1, colSpan: 4, rowSpan: 1 },
            { name: 'c', col: 5, row: 1, colSpan: 8, rowSpan: 1 },
        ],
    };
    const remaining = [
        ...el.querySelectorAll(':scope > section[data-slot]'),
    ].map(function (s) {
        return s.getAttribute('data-slot');
    });
    assertEq(remaining.length, 2, 'two sections after reconcile');
    assert(remaining.includes('a'), 'a kept');
    assert(remaining.includes('c'), 'c added');
    assert(!remaining.includes('b'), 'b removed');
    el.remove();
}
// ---- main ------------------------------------------------------------
async function main(): Promise<void> {
    testValidate_acceptsMinimalDoc();
    testValidate_rejectsBadVersion();
    testValidate_rejectsOverlap_not_yet();
    testValidate_rejectsSlotBeyondColumns();
    testEmpty_andNextFreeRect();
    await testInMemoryStore_roundTrip();
    await testValidatingStore_rejectsInvalid();
    await testValidatingStore_rejectsIdMismatch();
    testRegistry_registerAndGet();
    testPresets_allValid();
    testAtlasLayout_createsPositionedSections();
    testAtlasLayout_addAndRemoveSlots();
    console.log('OK');
}
main().catch(function (err: unknown) {
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('FAIL:', stack ?? err);
    process.exit(1);
});
