/**
 * DnD subsystem dry-run: unit-tests the leaf modules in a linkedom DOM.
 *
 * Covers the pieces that don't need a real pointer event loop:
 *   - CommitBoundary: success, thrown error, no-handler
 *   - Projection: source ghost, active target toggling, clear
 *   - DragOverlay: mount/move/unmount transforms + cloneSourcePreview
 *
 * The pointer-driven pieces (sensor + controller hit-test + full drop
 * path) live in apps/sandbox/tests/edit-drag-drop.test.js and need a
 * real browser.
 */

import { parseHTML } from 'linkedom';

const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.document;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.Node = dom.Node;
if (!globalThis.structuredClone) {
  globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}

const {
  Projection,
  DragOverlay,
  CommitBoundary,
  cloneSourcePreview,
} = await import('../src/dnd/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ---- CommitBoundary --------------------------------------------------

async function testCommit_successPath() {
  const boundary = new CommitBoundary({
    onDrop: async ({ payload }) => ({ ok: true, payloadId: payload.id }),
  });
  const res = await boundary.commit({
    payload: { type: 'cell', id: 'x' },
    target: { id: 'z', containerId: 'main', element: document.createElement('div') },
  });
  assertEq(res.ok, true, 'commit ok');
  assertEq(res.payloadId, 'x', 'payload.id returned');
}

async function testCommit_throwWrapsAsResult() {
  const boundary = new CommitBoundary({
    onDrop: async () => { throw new Error('boom'); },
  });
  const res = await boundary.commit({
    payload: { type: 'cell', id: 'x' },
    target: { id: 'z', containerId: 'main', element: document.createElement('div') },
  });
  assertEq(res.ok, false, 'ok=false on throw');
  assertEq(res.reason, 'commit-threw', 'reason=commit-threw');
  assertEq(res.message, 'boom', 'message passed through');
}

async function testCommit_noHandler() {
  const boundary = new CommitBoundary({});
  const res = await boundary.commit({
    payload: {}, target: { id: 'z', containerId: 'c', element: document.createElement('div') },
  });
  assertEq(res.ok, false, 'ok=false when no handler');
  assertEq(res.reason, 'no-commit-handler', 'reason=no-commit-handler');
}

// ---- Projection ------------------------------------------------------

async function testProjection_sourceGhostAndActiveTarget() {
  const p = new Projection();
  const source = document.createElement('div');
  const t1 = document.createElement('div');
  const t2 = document.createElement('div');
  p.setSourceGhost(source, 'ghost');
  assertEq(source.getAttribute('data-dnd-source'), 'ghost', 'source marked ghost');
  p.setActiveTarget(t1);
  assertEq(t1.getAttribute('data-dnd-over'), 'true', 't1 marked over');
  p.setActiveTarget(t2);
  assertEq(t1.getAttribute('data-dnd-over'), null, 't1 cleared');
  assertEq(t2.getAttribute('data-dnd-over'), 'true', 't2 marked');
  p.markCandidates([t1, t2]);
  assertEq(t1.getAttribute('data-dnd-candidate'), 'true', 'candidate set');
  p.clear();
  assertEq(source.getAttribute('data-dnd-source'), null, 'source cleared');
  assertEq(t1.getAttribute('data-dnd-candidate'), null, 'candidate cleared');
  assertEq(t2.getAttribute('data-dnd-over'), null, 'over cleared');
}

// ---- DragOverlay -----------------------------------------------------

async function testOverlay_mountMoveUnmount() {
  const overlay = new DragOverlay();
  const preview = document.createElement('div');
  overlay.mount(preview, { x: 100, y: 50 }, { x: 10, y: 5 });
  const wrapper = overlay.element;
  assert(wrapper, 'overlay wrapper exists');
  assert(wrapper.parentNode === document.body, 'mounted on body');
  assert(
    wrapper.style.transform.includes('90px') && wrapper.style.transform.includes('45px'),
    `transform set with pickup offset (got ${wrapper.style.transform})`,
  );
  overlay.move({ x: 200, y: 100 });
  assert(
    wrapper.style.transform.includes('190px') && wrapper.style.transform.includes('95px'),
    `transform updated (got ${wrapper.style.transform})`,
  );
  overlay.unmount();
  assert(!overlay.element, 'wrapper cleared');
}

async function testClonePreview_matchesSourceFootprint() {
  const el = document.createElement('div');
  el.id = 'my-source';
  el.textContent = 'hi';
  const preview = cloneSourcePreview(el, {
    top: 0, left: 0, right: 80, bottom: 24, width: 80, height: 24,
  });
  assertEq(preview.style.width, '80px', 'preview width matches');
  assertEq(preview.style.height, '24px', 'preview height matches');
  assertEq(preview.hasAttribute('id'), false, 'id stripped from clone');
  assertEq(preview.getAttribute('data-dnd-overlay-preview'), '', 'preview marker set');
}

// ---- main ------------------------------------------------------------

async function main() {
  await testCommit_successPath();
  await testCommit_throwWrapsAsResult();
  await testCommit_noHandler();
  await testProjection_sourceGhostAndActiveTarget();
  await testOverlay_mountMoveUnmount();
  await testClonePreview_matchesSourceFootprint();
  // eslint-disable-next-line no-console
  console.log('OK');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', err?.stack ?? err);
  process.exit(1);
});
