/**
 * Layout editor dry-run: exercises the <atlas-layout-editor> flows that
 * don't require real pointer events (add slot, rename, resize via panel,
 * delete, onSave) in a linkedom DOM. Pointer-drag interactions are
 * covered by Playwright once the sandbox specimen is live.
 */

import { parseHTML } from 'linkedom';

const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.document;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.customElements = dom.customElements;
globalThis.Node = dom.Node;
globalThis.DocumentFragment = dom.DocumentFragment;
if (!globalThis.structuredClone) {
  globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}

// Import via the package barrel so both <atlas-layout> and the editor
// register as a side effect.
await import('../src/index.js');
const { validateLayoutDocument, emptyLayoutDocument } = await import(
  '../src/layout/index.js'
);

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEq(a, b, msg) {
  if (a !== b) {
    throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function mountEditor(initial) {
  const el = document.createElement('atlas-layout-editor');
  document.body.appendChild(el);
  if (initial) el.layout = initial;
  return el;
}

function setInputValueAndChange(input, value) {
  input.value = String(value);
  const ev = new window.Event('change', { bubbles: true });
  input.dispatchEvent(ev);
}

async function testEditor_rendersToolbarCanvasPanel() {
  const el = mountEditor(
    emptyLayoutDocument({ layoutId: 'x', displayName: 'X' }),
  );
  assert(el.querySelector('[data-editor-toolbar]'), 'toolbar rendered');
  assert(el.querySelector('[data-editor-canvas] atlas-layout'), 'canvas + atlas-layout rendered');
  assert(el.querySelector('[data-editor-panel]'), 'panel rendered');
  el.remove();
}

async function testEditor_addSlotCreatesSection() {
  const el = mountEditor(emptyLayoutDocument({ layoutId: 'x' }));
  const addBtn = el.querySelector('[data-action="add-slot"]');
  addBtn.click();
  const sections = el.querySelectorAll(
    '[data-editor-canvas] atlas-layout > section[data-slot]',
  );
  assertEq(sections.length, 1, 'one slot after add');
  const doc = el.layout;
  assertEq(doc.slots.length, 1, 'doc has one slot');
  const { ok } = validateLayoutDocument(doc);
  assert(ok, 'doc after add is valid');
  el.remove();
}

async function testEditor_multipleAddSlotsPlaceWithoutOverlap() {
  const el = mountEditor(emptyLayoutDocument({ layoutId: 'x' }));
  const addBtn = el.querySelector('[data-action="add-slot"]');
  addBtn.click();
  addBtn.click();
  addBtn.click();
  const doc = el.layout;
  assertEq(doc.slots.length, 3, 'three slots');
  // No two slots overlap.
  for (let i = 0; i < doc.slots.length; i++) {
    for (let j = i + 1; j < doc.slots.length; j++) {
      const a = doc.slots[i];
      const b = doc.slots[j];
      const overlap =
        a.col < b.col + b.colSpan &&
        a.col + a.colSpan > b.col &&
        a.row < b.row + b.rowSpan &&
        a.row + a.rowSpan > b.row;
      assert(!overlap, `slots ${a.name} and ${b.name} overlap`);
    }
  }
  el.remove();
}

async function testEditor_panelEditResizesSlot() {
  const el = mountEditor({
    layoutId: 'x',
    version: '0.1.0',
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [{ name: 'main', col: 1, row: 1, colSpan: 4, rowSpan: 2 }],
  });
  // Select the only slot.
  el.querySelector(
    '[data-editor-canvas] atlas-layout > section[data-slot="main"]',
  ).dispatchEvent(new window.Event('click', { bubbles: true }));

  const colSpanInput = el.querySelector('input[data-field="colSpan"]');
  assert(colSpanInput, 'colSpan input present when a slot is selected');
  setInputValueAndChange(colSpanInput, 8);

  const doc = el.layout;
  assertEq(doc.slots[0].colSpan, 8, 'colSpan updated via panel');
  el.remove();
}

async function testEditor_panelRenameSlot() {
  const el = mountEditor({
    layoutId: 'x',
    version: '0.1.0',
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [{ name: 'main', col: 1, row: 1, colSpan: 12, rowSpan: 1 }],
  });
  el.querySelector(
    '[data-editor-canvas] atlas-layout > section[data-slot="main"]',
  ).dispatchEvent(new window.Event('click', { bubbles: true }));
  const nameInput = el.querySelector('input[data-field="name"]');
  setInputValueAndChange(nameInput, 'header');
  const doc = el.layout;
  assertEq(doc.slots[0].name, 'header', 'slot renamed');
  // Section tagged with new name.
  assert(
    el.querySelector(
      '[data-editor-canvas] atlas-layout > section[data-slot="header"]',
    ),
    'section tag updated to new name',
  );
  el.remove();
}

async function testEditor_deleteSlot() {
  const el = mountEditor({
    layoutId: 'x',
    version: '0.1.0',
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [
      { name: 'a', col: 1, row: 1, colSpan: 6, rowSpan: 1 },
      { name: 'b', col: 7, row: 1, colSpan: 6, rowSpan: 1 },
    ],
  });
  el.querySelector(
    '[data-editor-canvas] atlas-layout > section[data-slot="a"]',
  ).dispatchEvent(new window.Event('click', { bubbles: true }));
  el.querySelector('[data-action="delete-slot"]').click();
  const doc = el.layout;
  assertEq(doc.slots.length, 1, 'one slot after delete');
  assertEq(doc.slots[0].name, 'b', 'correct slot survived');
  el.remove();
}

async function testEditor_onChangeAndOnSaveFire() {
  const el = mountEditor(emptyLayoutDocument({ layoutId: 'x' }));
  let changes = 0;
  let savedDoc = null;
  el.onChange = () => {
    changes += 1;
  };
  el.onSave = (doc) => {
    savedDoc = doc;
  };
  el.querySelector('[data-action="add-slot"]').click();
  assert(changes >= 1, 'onChange fired for add');

  el.querySelector('[data-action="save"]').click();
  // Save is async; wait a microtask.
  await new Promise((r) => setTimeout(r, 0));
  assert(savedDoc !== null, 'onSave fired');
  assertEq(savedDoc.slots.length, 1, 'saved doc reflects added slot');
  el.remove();
}

async function testEditor_onChangeDoesNotFireOnInvalidEdit() {
  const el = mountEditor({
    layoutId: 'x',
    version: '0.1.0',
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [{ name: 'main', col: 1, row: 1, colSpan: 12, rowSpan: 2 }],
  });
  let changes = 0;
  el.onChange = () => {
    changes += 1;
  };
  // Select and try to push colSpan to 99 (beyond the grid) — validator
  // should reject; onChange should NOT fire.
  el.querySelector(
    '[data-editor-canvas] atlas-layout > section[data-slot="main"]',
  ).dispatchEvent(new window.Event('click', { bubbles: true }));
  setInputValueAndChange(el.querySelector('input[data-field="colSpan"]'), 99);
  assertEq(changes, 0, 'invalid edit never fired onChange');
  // Doc is unchanged.
  assertEq(el.layout.slots[0].colSpan, 12, 'doc unchanged');
  el.remove();
}

async function main() {
  await testEditor_rendersToolbarCanvasPanel();
  await testEditor_addSlotCreatesSection();
  await testEditor_multipleAddSlotsPlaceWithoutOverlap();
  await testEditor_panelEditResizesSlot();
  await testEditor_panelRenameSlot();
  await testEditor_deleteSlot();
  await testEditor_onChangeAndOnSaveFire();
  await testEditor_onChangeDoesNotFireOnInvalidEdit();
  // eslint-disable-next-line no-console
  console.log('OK');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', err?.stack ?? err);
  process.exit(1);
});
