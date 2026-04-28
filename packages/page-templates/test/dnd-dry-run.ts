/**
 * DnD subsystem dry-run: unit-tests the leaf modules in a linkedom DOM.
 */

import { parseHTML } from 'linkedom';

const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
(globalThis as unknown as Record<string, unknown>)['window'] = dom.window;
(globalThis as unknown as Record<string, unknown>)['document'] = dom.document;
(globalThis as unknown as Record<string, unknown>)['HTMLElement'] = dom.HTMLElement;
(globalThis as unknown as Record<string, unknown>)['Node'] = dom.Node;
if (!globalThis.structuredClone) {
  globalThis.structuredClone = ((v: unknown) => JSON.parse(JSON.stringify(v))) as typeof structuredClone;
}

const {
  Projection,
  DragOverlay,
  CommitBoundary,
  cloneSourcePreview,
} = await import('../src/dnd/index.ts');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ---- CommitBoundary --------------------------------------------------

async function testCommit_successPath(): Promise<void> {
  const boundary = new CommitBoundary({
    onDrop: async ({ payload }) => ({ ok: true, payloadId: payload.id }),
  });
  const res = await boundary.commit({
    payload: { type: 'cell', id: 'x' },
    target: { id: 'z', containerId: 'main', element: document.createElement('div') as unknown as HTMLElement },
  });
  assertEq(res.ok, true, 'commit ok');
  assertEq((res as { payloadId?: string }).payloadId, 'x', 'payload.id returned');
}

async function testCommit_throwWrapsAsResult(): Promise<void> {
  const boundary = new CommitBoundary({
    onDrop: async () => {
      throw new Error('boom');
    },
  });
  const res = await boundary.commit({
    payload: { type: 'cell', id: 'x' },
    target: { id: 'z', containerId: 'main', element: document.createElement('div') as unknown as HTMLElement },
  });
  assertEq(res.ok, false, 'ok=false on throw');
  assertEq(res.reason, 'commit-threw', 'reason=commit-threw');
  assertEq((res as { message?: string }).message, 'boom', 'message passed through');
}

async function testCommit_noHandler(): Promise<void> {
  const boundary = new CommitBoundary({});
  const res = await boundary.commit({
    payload: { type: '', id: '' },
    target: { id: 'z', containerId: 'c', element: document.createElement('div') as unknown as HTMLElement },
  });
  assertEq(res.ok, false, 'ok=false when no handler');
  assertEq(res.reason, 'no-commit-handler', 'reason=no-commit-handler');
}

// ---- Projection ------------------------------------------------------

async function testProjection_sourceGhostAndActiveTarget(): Promise<void> {
  const p = new Projection();
  const source = document.createElement('div') as unknown as HTMLElement;
  const t1 = document.createElement('div') as unknown as HTMLElement;
  const t2 = document.createElement('div') as unknown as HTMLElement;
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

async function testOverlay_mountMoveUnmount(): Promise<void> {
  const overlay = new DragOverlay();
  const preview = document.createElement('div') as unknown as HTMLElement;
  overlay.mount(preview, { x: 100, y: 50 }, { x: 10, y: 5 });
  const wrapper = overlay.element;
  assert(wrapper, 'overlay wrapper exists');
  assert(wrapper!.parentNode === document.body, 'mounted on body');
  assert(
    wrapper!.style.transform.includes('90px') && wrapper!.style.transform.includes('45px'),
    `transform set with pickup offset (got ${wrapper!.style.transform})`,
  );
  overlay.move({ x: 200, y: 100 });
  assert(
    wrapper!.style.transform.includes('190px') && wrapper!.style.transform.includes('95px'),
    `transform updated (got ${wrapper!.style.transform})`,
  );
  overlay.unmount();
  assert(!overlay.element, 'wrapper cleared');
}

async function testClonePreview_matchesSourceFootprint(): Promise<void> {
  const el = document.createElement('div') as unknown as HTMLElement;
  el.id = 'my-source';
  el.textContent = 'hi';
  const preview = cloneSourcePreview(el, {
    top: 0,
    left: 0,
    right: 80,
    bottom: 24,
    width: 80,
    height: 24,
  });
  assertEq(preview.style.width, '80px', 'preview width matches');
  assertEq(preview.style.height, '24px', 'preview height matches');
  assertEq(preview.hasAttribute('id'), false, 'id stripped from clone');
  assertEq(preview.getAttribute('data-dnd-overlay-preview'), '', 'preview marker set');
}

// ---- main ------------------------------------------------------------

async function main(): Promise<void> {
  await testCommit_successPath();
  await testCommit_throwWrapsAsResult();
  await testCommit_noHandler();
  await testProjection_sourceGhostAndActiveTarget();
  await testOverlay_mountMoveUnmount();
  await testClonePreview_matchesSourceFootprint();
  // eslint-disable-next-line no-console
  console.log('OK');
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', (err as Error | undefined)?.stack ?? err);
  process.exit(1);
});
