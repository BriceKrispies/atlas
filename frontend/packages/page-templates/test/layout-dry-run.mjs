/**
 * Layout subsystem dry-run: exercises the data model, store, registry,
 * and <atlas-layout> rendering in a linkedom DOM.
 */

import { parseHTML } from 'linkedom';

const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.document;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.customElements = dom.customElements;
globalThis.Node = dom.Node;
if (!globalThis.structuredClone) {
  globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}

const {
  validateLayoutDocument,
  emptyLayoutDocument,
  nextFreeRect,
  InMemoryLayoutStore,
  ValidatingLayoutStore,
  LayoutRegistry,
  presetLayouts,
  AtlasLayoutElement,
} = await import('../src/layout/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEq(a, b, msg) {
  if (a !== b) {
    throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ---- validator -------------------------------------------------------

function testValidate_acceptsMinimalDoc() {
  const { ok } = validateLayoutDocument({
    layoutId: 'x',
    version: '0.1.0',
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [
      { name: 'main', col: 1, row: 1, colSpan: 12, rowSpan: 2 },
    ],
  });
  assert(ok, 'minimal doc validates');
}

function testValidate_rejectsBadVersion() {
  const res = validateLayoutDocument({
    layoutId: 'x',
    version: 'v1',
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [],
  });
  assert(!res.ok, 'rejected');
  assert(res.errors.some((e) => e.path === 'version'), 'version error present');
}

function testValidate_rejectsOverlap_not_yet() {
  // Overlap detection isn't enforced by the schema-level validator; the
  // editor handles it interactively. Just confirm duplicate names fail.
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
  assert(
    res.errors.some((e) => /duplicate/.test(e.message)),
    'duplicate-name error present',
  );
}

function testValidate_rejectsSlotBeyondColumns() {
  const res = validateLayoutDocument({
    layoutId: 'x',
    version: '0.1.0',
    grid: { columns: 6, rowHeight: 160, gap: 16 },
    slots: [{ name: 'big', col: 3, row: 1, colSpan: 6, rowSpan: 1 }],
  });
  assert(!res.ok, 'out-of-bounds rejected');
  assert(
    res.errors.some((e) => /extends beyond grid.columns/.test(e.message)),
    'bounds error present',
  );
}

// ---- emptyLayoutDocument + nextFreeRect ------------------------------

function testEmpty_andNextFreeRect() {
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

async function testInMemoryStore_roundTrip() {
  const store = new InMemoryLayoutStore();
  const doc = emptyLayoutDocument({ layoutId: 'my-layout' });
  doc.slots.push({ name: 'main', col: 1, row: 1, colSpan: 12, rowSpan: 2 });
  await store.save('my-layout', doc);
  const back = await store.get('my-layout');
  assert(back, 'found');
  assertEq(back.layoutId, 'my-layout', 'id preserved');
  assertEq(back.slots.length, 1, 'slots preserved');
  // Independent copy (mutation of retrieved doesn't affect stored).
  back.slots.push({ name: 'x', col: 1, row: 1, colSpan: 1, rowSpan: 1 });
  const again = await store.get('my-layout');
  assertEq(again.slots.length, 1, 'store wasn\'t mutated by caller');
}

async function testValidatingStore_rejectsInvalid() {
  const store = new ValidatingLayoutStore(new InMemoryLayoutStore());
  let threw = false;
  try {
    await store.save('bad', {
      layoutId: 'bad',
      version: 'nope',
      grid: { columns: 12, rowHeight: 160, gap: 16 },
      slots: [],
    });
  } catch {
    threw = true;
  }
  assert(threw, 'validating store rejects invalid doc');
}

async function testValidatingStore_rejectsIdMismatch() {
  const store = new ValidatingLayoutStore(new InMemoryLayoutStore());
  let threw = false;
  try {
    await store.save('one-id', {
      layoutId: 'different-id',
      version: '0.1.0',
      grid: { columns: 12, rowHeight: 160, gap: 16 },
      slots: [],
    });
  } catch {
    threw = true;
  }
  assert(threw, 'id mismatch rejected');
}

// ---- registry --------------------------------------------------------

function testRegistry_registerAndGet() {
  const reg = new LayoutRegistry();
  const doc = {
    layoutId: 'r',
    version: '0.1.0',
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [{ name: 'main', col: 1, row: 1, colSpan: 12, rowSpan: 1 }],
  };
  reg.register(doc);
  assert(reg.has('r'), 'registered');
  const back = reg.get('r');
  assertEq(back.layoutId, 'r', 'get returns same id');
  // Registry returns a clone.
  back.slots = [];
  const again = reg.get('r');
  assertEq(again.slots.length, 1, 'registry clone preserves stored value');
}

function testPresets_allValid() {
  for (const doc of presetLayouts) {
    const { ok, errors } = validateLayoutDocument(doc);
    assert(ok, `preset ${doc.layoutId} invalid: ${JSON.stringify(errors)}`);
  }
  assertEq(presetLayouts.length, 6, 'six presets shipped');
}

// ---- <atlas-layout> rendering ---------------------------------------

function testAtlasLayout_createsPositionedSections() {
  const el = document.createElement('atlas-layout');
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
  // Without an inner <widget-host>, atlas-layout places sections directly
  // on itself — useful for preview-only scenarios (e.g. the layout editor
  // canvas without content).
  const sections = el.querySelectorAll(':scope > section[data-slot]');
  assertEq(sections.length, 3, 'three sections rendered');
  const header = el.querySelector(':scope > section[data-slot="header"]');
  assert(header, 'header section exists');
  assert(
    header.style.gridColumn.includes('1') && header.style.gridColumn.includes('span 12'),
    `header grid-column set (got "${header.style.gridColumn}")`,
  );
  assert(
    el.style.gridTemplateColumns.includes('repeat(12'),
    `host grid-template-columns set (got "${el.style.gridTemplateColumns}")`,
  );
  assertEq(el.getAttribute('data-layout-id'), 'render-test', 'data-layout-id reflected');
  el.remove();
}

function testAtlasLayout_addAndRemoveSlots() {
  const el = document.createElement('atlas-layout');
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
  assertEq(
    el.querySelectorAll(':scope > section[data-slot]').length,
    2,
    'two sections after first apply',
  );

  // Drop a slot, add another — sections reconcile in place.
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
  ].map((s) => s.getAttribute('data-slot'));
  assertEq(remaining.length, 2, 'two sections after reconcile');
  assert(remaining.includes('a'), 'a kept');
  assert(remaining.includes('c'), 'c added');
  assert(!remaining.includes('b'), 'b removed');
  el.remove();
}

// ---- main ------------------------------------------------------------

async function main() {
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
  // eslint-disable-next-line no-console
  console.log('OK');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', err?.stack ?? err);
  process.exit(1);
});
