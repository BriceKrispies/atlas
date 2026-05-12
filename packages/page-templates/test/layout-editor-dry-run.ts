/**
 * Layout editor dry-run: exercises the <atlas-layout-editor> flows that
 * don't require real pointer events (add slot, rename, resize via panel,
 * delete, onSave) in a linkedom DOM.
 */

import { document, dispatchEventOn, setInputValueAndChange } from './_lib/setup.ts';
import { must } from '../src/internal/assert.ts';
import type { LayoutDocument } from '../src/layout/layout-document.ts';

// Import via the package barrel so both <atlas-layout> and the editor
// register as a side effect.
await import('../src/index.ts');
const { validateLayoutDocument, emptyLayoutDocument } = await import(
  '../src/layout/index.ts'
);

type LayoutEditorEl = HTMLElement & {
  layout?: LayoutDocument;
  onChange?: (doc: LayoutDocument) => void;
  onSave?: (doc: LayoutDocument) => void;
};

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEq<T>(a: T, b: T, msg: string): void {
  if (a !== b) {
    throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function mountEditor(initial?: LayoutDocument): LayoutEditorEl {
  const el = document.createElement('atlas-layout-editor') as LayoutEditorEl;
  document.body.appendChild(el);
  if (initial) el.layout = initial;
  return el;
}

async function testEditor_rendersToolbarCanvasPanel(): Promise<void> {
  const el = mountEditor(
    emptyLayoutDocument({ layoutId: 'x', displayName: 'X' }),
  );
  assert(el.querySelector('[data-editor-toolbar]'), 'toolbar rendered');
  assert(el.querySelector('[data-editor-canvas] atlas-layout'), 'canvas + atlas-layout rendered');
  assert(el.querySelector('[data-editor-panel]'), 'panel rendered');
  el.remove();
}

async function testEditor_addSlotCreatesSection(): Promise<void> {
  const el = mountEditor(emptyLayoutDocument({ layoutId: 'x' }));
  const addBtn = must(
    el.querySelector<HTMLElement>('[data-action="add-slot"]'),
    'add-slot button just rendered',
  );
  addBtn.click();
  const sections = el.querySelectorAll(
    '[data-editor-canvas] atlas-layout > section[data-slot]',
  );
  assertEq(sections.length, 1, 'one slot after add');
  const doc = must(el.layout, 'layout populated by add-slot click');
  assertEq(doc.slots.length, 1, 'doc has one slot');
  const res = validateLayoutDocument(doc);
  assert(res.ok, 'doc after add is valid');
  el.remove();
}

async function testEditor_multipleAddSlotsPlaceWithoutOverlap(): Promise<void> {
  const el = mountEditor(emptyLayoutDocument({ layoutId: 'x' }));
  const addBtn = must(
    el.querySelector<HTMLElement>('[data-action="add-slot"]'),
    'add-slot button just rendered',
  );
  addBtn.click();
  addBtn.click();
  addBtn.click();
  const doc = must(el.layout, 'layout populated by add-slot clicks');
  assertEq(doc.slots.length, 3, 'three slots');
  for (let i = 0; i < doc.slots.length; i++) {
    for (let j = i + 1; j < doc.slots.length; j++) {
      const a = must(doc.slots[i], `slots[${i}] just pushed`);
      const b = must(doc.slots[j], `slots[${j}] just pushed`);
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

async function testEditor_panelEditResizesSlot(): Promise<void> {
  const el = mountEditor({
    layoutId: 'x',
    version: '0.1.0',
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [{ name: 'main', col: 1, row: 1, colSpan: 4, rowSpan: 2 }],
  });
  const slotEl = must(
    el.querySelector('[data-editor-canvas] atlas-layout > section[data-slot="main"]'),
    'main slot just rendered',
  );
  dispatchEventOn(slotEl, 'click');

  const colSpanInput = el.querySelector<HTMLInputElement>('input[data-field="colSpan"]');
  assert(colSpanInput, 'colSpan input present when a slot is selected');
  setInputValueAndChange(colSpanInput, 8);

  const doc = must(el.layout, 'layout still present');
  const slot0 = must(doc.slots[0], 'slots[0] still present');
  assertEq(slot0.colSpan, 8, 'colSpan updated via panel');
  el.remove();
}

async function testEditor_panelRenameSlot(): Promise<void> {
  const el = mountEditor({
    layoutId: 'x',
    version: '0.1.0',
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [{ name: 'main', col: 1, row: 1, colSpan: 12, rowSpan: 1 }],
  });
  const slotEl = must(
    el.querySelector('[data-editor-canvas] atlas-layout > section[data-slot="main"]'),
    'main slot just rendered',
  );
  dispatchEventOn(slotEl, 'click');
  const nameInput = el.querySelector<HTMLInputElement>('input[data-field="name"]');
  setInputValueAndChange(nameInput, 'header');
  const doc = must(el.layout, 'layout still present');
  const slot0 = must(doc.slots[0], 'slots[0] still present');
  assertEq(slot0.name, 'header', 'slot renamed');
  assert(
    el.querySelector(
      '[data-editor-canvas] atlas-layout > section[data-slot="header"]',
    ),
    'section tag updated to new name',
  );
  el.remove();
}

async function testEditor_deleteSlot(): Promise<void> {
  const el = mountEditor({
    layoutId: 'x',
    version: '0.1.0',
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [
      { name: 'a', col: 1, row: 1, colSpan: 6, rowSpan: 1 },
      { name: 'b', col: 7, row: 1, colSpan: 6, rowSpan: 1 },
    ],
  });
  const slotA = must(
    el.querySelector('[data-editor-canvas] atlas-layout > section[data-slot="a"]'),
    'slot a just rendered',
  );
  dispatchEventOn(slotA, 'click');
  const deleteBtn = must(
    el.querySelector<HTMLElement>('[data-action="delete-slot"]'),
    'delete-slot button just rendered',
  );
  deleteBtn.click();
  const doc = must(el.layout, 'layout still present');
  assertEq(doc.slots.length, 1, 'one slot after delete');
  const survivor = must(doc.slots[0], 'one slot survived');
  assertEq(survivor.name, 'b', 'correct slot survived');
  el.remove();
}

async function testEditor_onChangeAndOnSaveFire(): Promise<void> {
  const el = mountEditor(emptyLayoutDocument({ layoutId: 'x' }));
  let changes = 0;
  // Explicit `let` widening — the assignment happens in an onSave
  // callback whose timing TS can't see, so the variable's type at the
  // read site below would otherwise narrow to `null` only.
  let savedDoc: LayoutDocument | null = null as LayoutDocument | null;
  el.onChange = () => {
    changes += 1;
  };
  el.onSave = (doc) => {
    savedDoc = doc;
  };
  const addBtn = must(
    el.querySelector<HTMLElement>('[data-action="add-slot"]'),
    'add-slot button just rendered',
  );
  addBtn.click();
  assert(changes >= 1, 'onChange fired for add');

  const saveBtn = must(
    el.querySelector<HTMLElement>('[data-action="save"]'),
    'save button just rendered',
  );
  saveBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  const saved = must(savedDoc, 'onSave fired');
  assertEq(saved.slots.length, 1, 'saved doc reflects added slot');
  el.remove();
}

async function testEditor_onChangeDoesNotFireOnInvalidEdit(): Promise<void> {
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
  const slotEl = must(
    el.querySelector('[data-editor-canvas] atlas-layout > section[data-slot="main"]'),
    'main slot just rendered',
  );
  dispatchEventOn(slotEl, 'click');
  setInputValueAndChange(
    el.querySelector<HTMLInputElement>('input[data-field="colSpan"]'),
    99,
  );
  assertEq(changes, 0, 'invalid edit never fired onChange');
  const doc = must(el.layout, 'layout still present');
  const slot0 = must(doc.slots[0], 'slots[0] still present');
  assertEq(slot0.colSpan, 12, 'doc unchanged');
  el.remove();
}

async function main(): Promise<void> {
  await testEditor_rendersToolbarCanvasPanel();
  await testEditor_addSlotCreatesSection();
  await testEditor_multipleAddSlotsPlaceWithoutOverlap();
  await testEditor_panelEditResizesSlot();
  await testEditor_panelRenameSlot();
  await testEditor_deleteSlot();
  await testEditor_onChangeAndOnSaveFire();
  await testEditor_onChangeDoesNotFireOnInvalidEdit();
  console.log('OK');
}

main().catch((err: unknown) => {
  const stack = err instanceof Error ? err.stack : undefined;
  console.error('FAIL:', stack ?? err);
  process.exit(1);
});
