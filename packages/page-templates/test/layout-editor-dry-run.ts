/**
 * Layout editor dry-run: exercises the <atlas-layout-editor> flows that
 * don't require real pointer events (add slot, rename, resize via panel,
 * delete, onSave) in a linkedom DOM.
 */

import { parseHTML } from 'linkedom';

const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
(globalThis as unknown as Record<string, unknown>)['window'] = dom.window;
(globalThis as unknown as Record<string, unknown>)['document'] = dom.document;
(globalThis as unknown as Record<string, unknown>)['HTMLElement'] = dom.HTMLElement;
(globalThis as unknown as Record<string, unknown>)['customElements'] = dom.customElements;
(globalThis as unknown as Record<string, unknown>)['Node'] = dom.Node;
(globalThis as unknown as Record<string, unknown>)['DocumentFragment'] = dom.DocumentFragment;
if (!globalThis.structuredClone) {
  globalThis.structuredClone = ((v: unknown) => JSON.parse(JSON.stringify(v))) as typeof structuredClone;
}

// Import via the package barrel so both <atlas-layout> and the editor
// register as a side effect.
await import('../src/index.ts');
const { validateLayoutDocument, emptyLayoutDocument } = await import(
  '../src/layout/index.ts'
);

type LayoutEditorEl = HTMLElement & {
  layout?: unknown;
  onChange?: (doc: unknown) => void;
  onSave?: (doc: unknown) => void;
};

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEq<T>(a: T, b: T, msg: string): void {
  if (a !== b) {
    throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function mountEditor(initial?: unknown): LayoutEditorEl {
  const el = document.createElement('atlas-layout-editor') as LayoutEditorEl;
  document.body.appendChild(el);
  if (initial) el.layout = initial;
  return el;
}

function setInputValueAndChange(input: HTMLInputElement | null, value: number | string): void {
  if (!input) return;
  input.value = String(value);
  const win = globalThis.window as unknown as { Event: typeof Event };
  const ev = new win.Event('change', { bubbles: true });
  input.dispatchEvent(ev);
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
  const addBtn = el.querySelector('[data-action="add-slot"]') as HTMLElement;
  addBtn.click();
  const sections = el.querySelectorAll(
    '[data-editor-canvas] atlas-layout > section[data-slot]',
  );
  assertEq(sections.length, 1, 'one slot after add');
  const doc = el.layout as { slots: unknown[] };
  assertEq(doc.slots.length, 1, 'doc has one slot');
  const res = validateLayoutDocument(doc);
  assert(res.ok, 'doc after add is valid');
  el.remove();
}

async function testEditor_multipleAddSlotsPlaceWithoutOverlap(): Promise<void> {
  const el = mountEditor(emptyLayoutDocument({ layoutId: 'x' }));
  const addBtn = el.querySelector('[data-action="add-slot"]') as HTMLElement;
  addBtn.click();
  addBtn.click();
  addBtn.click();
  const doc = el.layout as { slots: Array<{ name: string; col: number; row: number; colSpan: number; rowSpan: number }> };
  assertEq(doc.slots.length, 3, 'three slots');
  for (let i = 0; i < doc.slots.length; i++) {
    for (let j = i + 1; j < doc.slots.length; j++) {
      const a = doc.slots[i]!;
      const b = doc.slots[j]!;
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
  const win = globalThis.window as unknown as { Event: typeof Event };
  el.querySelector(
    '[data-editor-canvas] atlas-layout > section[data-slot="main"]',
  )!.dispatchEvent(new win.Event('click', { bubbles: true }));

  const colSpanInput = el.querySelector('input[data-field="colSpan"]') as HTMLInputElement | null;
  assert(colSpanInput, 'colSpan input present when a slot is selected');
  setInputValueAndChange(colSpanInput, 8);

  const doc = el.layout as { slots: Array<{ colSpan: number }> };
  assertEq(doc.slots[0]!.colSpan, 8, 'colSpan updated via panel');
  el.remove();
}

async function testEditor_panelRenameSlot(): Promise<void> {
  const el = mountEditor({
    layoutId: 'x',
    version: '0.1.0',
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [{ name: 'main', col: 1, row: 1, colSpan: 12, rowSpan: 1 }],
  });
  const win = globalThis.window as unknown as { Event: typeof Event };
  el.querySelector(
    '[data-editor-canvas] atlas-layout > section[data-slot="main"]',
  )!.dispatchEvent(new win.Event('click', { bubbles: true }));
  const nameInput = el.querySelector('input[data-field="name"]') as HTMLInputElement | null;
  setInputValueAndChange(nameInput, 'header');
  const doc = el.layout as { slots: Array<{ name: string }> };
  assertEq(doc.slots[0]!.name, 'header', 'slot renamed');
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
  const win = globalThis.window as unknown as { Event: typeof Event };
  el.querySelector(
    '[data-editor-canvas] atlas-layout > section[data-slot="a"]',
  )!.dispatchEvent(new win.Event('click', { bubbles: true }));
  (el.querySelector('[data-action="delete-slot"]') as HTMLElement).click();
  const doc = el.layout as { slots: Array<{ name: string }> };
  assertEq(doc.slots.length, 1, 'one slot after delete');
  assertEq(doc.slots[0]!.name, 'b', 'correct slot survived');
  el.remove();
}

async function testEditor_onChangeAndOnSaveFire(): Promise<void> {
  const el = mountEditor(emptyLayoutDocument({ layoutId: 'x' }));
  let changes = 0;
  let savedDoc: unknown = null;
  el.onChange = () => {
    changes += 1;
  };
  el.onSave = (doc) => {
    savedDoc = doc;
  };
  (el.querySelector('[data-action="add-slot"]') as HTMLElement).click();
  assert(changes >= 1, 'onChange fired for add');

  (el.querySelector('[data-action="save"]') as HTMLElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert(savedDoc !== null, 'onSave fired');
  assertEq((savedDoc as { slots: unknown[] }).slots.length, 1, 'saved doc reflects added slot');
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
  const win = globalThis.window as unknown as { Event: typeof Event };
  el.querySelector(
    '[data-editor-canvas] atlas-layout > section[data-slot="main"]',
  )!.dispatchEvent(new win.Event('click', { bubbles: true }));
  setInputValueAndChange(el.querySelector('input[data-field="colSpan"]') as HTMLInputElement | null, 99);
  assertEq(changes, 0, 'invalid edit never fired onChange');
  assertEq((el.layout as { slots: Array<{ colSpan: number }> }).slots[0]!.colSpan, 12, 'doc unchanged');
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
  // eslint-disable-next-line no-console
  console.log('OK');
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', (err as Error | undefined)?.stack ?? err);
  process.exit(1);
});
