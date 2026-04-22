# DnD Subsystem

Slim Pointer Events drag-and-drop for the page-templates editor.
No HTML5 `dragstart` / `dataTransfer`. No framework dependencies.
Vanilla JS, assumes a DOM plus `window` / `document`.

## Why not native HTML5 DnD?

The editor previously used native HTML5 DnD (`draggable="true"`,
`dragstart` / `dragover` / `drop`, `dataTransfer.setData`). We removed
it because:

1. **Not really programmable.** The browser owns the drag image, the
   cursor, activation timing, and acceptable targets.
2. **Can't be exercised by tests.** Playwright's `dragTo` synthesizes
   HTML5 drag events but does NOT dispatch real PointerEvents — any
   logic in pointer handlers stays untested without a human cursor.
3. **Touch is second-class.** iOS Safari's native drag requires a
   long-press and works poorly.

The subsystem below replaces it with a Pointer Events pipeline that
looks like a very small dnd-kit: pointer events at the bottom, commit
boundary at the top.

## What this subsystem does (and doesn't) do

It drives a **single-slot** drop model:

- Each region in the template holds at most one widget.
- Empty regions render a single drop target; filled regions render
  none.
- Nothing reorders on drop or pickup. Moving a widget between regions
  is a commit, not a live DOM shuffle.

It does NOT do:

- Interstitial / between-sibling drop zones
- FLIP or visual reorder of siblings during drag
- Autoscroll (the edit surface fits one screen)
- Collision strategies — a plain pointer-in-rect test is enough with
  a handful of slot targets
- Measurement caching — slot rects are few and cheap to read
- Keyboard-drag navigation (click-to-select lives in `edit-mount.js`,
  not here)

The subsystem used to do all of those. When the editor moved to a slot
model, they stopped earning their keep and were deleted. See
`ARCHITECTURE.md` history if you need the old layered pipeline.

## Layering

```
  ┌─────────────────────────────────────────────────────────────┐
  │  consumer (edit-mount.js)                                   │
  │    - registerSource(cellEl | chipEl, { getPayload })        │
  │    - setTargets([{ id, element, accepts, containerId }])    │
  │    - onDrop({ payload, target }) → commits to EditorAPI     │
  └──────────────────────────┬──────────────────────────────────┘
                             │
  ┌──────────────────────────▼──────────────────────────────────┐
  │  controller.js                                              │
  │    - wires sensor callbacks to overlay + projection + commit│
  │    - pointer-in-rect hit test against registered targets    │
  └──┬──────────────┬──────────────┬──────────────┬─────────────┘
     │              │              │              │
  ┌──▼──┐     ┌─────▼────┐   ┌─────▼─────┐   ┌────▼────┐
  │sens │     │ overlay  │   │projection │   │ commit  │
  │ -or │     │          │   │           │   │         │
  └─────┘     └──────────┘   └───────────┘   └─────────┘
```

Every module is independently testable. Everything except the sensor
(which needs real pointer events) is covered by
`test/dnd-dry-run.mjs`. The sensor is exercised end-to-end by
`apps/sandbox/tests/edit-drag-drop.test.js` and
`apps/sandbox/tests/edit-dnd-subsystem.test.js`.

## Module responsibilities

### `types.js`
JSDoc typedefs only. No runtime code.

### `sensor.js` — pointer-to-lifecycle adapter
- Owns every `pointerdown` / `pointermove` / `pointerup` /
  `pointercancel` listener.
- Decides when motion crosses the activation threshold (default 4px).
- Calls `setPointerCapture` on the source so Safari / nested scroll
  containers don't steal events.
- Suppresses `selectstart`, `contextmenu`, and native `dragstart` for
  the duration of a drag.
- **Knows nothing about slots, widgets, or commits.** It emits
  `{ source, pointer, event }` lifecycle callbacks; the controller
  decides what to do with them.

### `overlay.js` — visual representation
- `DragOverlay.mount(previewEl, pointer, pickupOffset)` inserts a
  `position: fixed` wrapper under `document.body` and positions it
  with a single `translate3d()`.
- `move(pointer)` updates the transform. No layout reads, no
  top/left writes.
- `cloneSourcePreview(sourceEl, rect)` deep-clones the source and
  pins its width/height to the source footprint.

### `projection.js` — DOM marker writer
- Writes `data-dnd-source`, `data-dnd-over`, `data-dnd-candidate` on
  elements. Only module allowed to mutate these attributes.
- Doesn't read layout. Doesn't listen for events.
- CSS in `editor-styles.js` reacts to the attributes.

### `commit.js` — the commit boundary
- `CommitBoundary.commit({ payload, target })` calls the consumer's
  `onDrop` and wraps the result:
  - thrown exception → `{ ok: false, reason: 'commit-threw', message }`
  - no handler → `{ ok: false, reason: 'no-commit-handler' }`
  - otherwise → whatever `onDrop` returned.
- **Exactly one place in the subsystem where side effects leave.**
  Everything before is recoverable; everything after is the
  consumer's responsibility.

### `styles.js`
`ensureDndStyles(elOrRoot)` injects the base CSS (overlay, ghost,
over-target) once per root — document or shadow root.

### `controller.js` — orchestrator
- The only module that imports all the others.
- Owns per-drag transient state (payload, pickup offset, active
  target) directly — no separate session store.
- Hit-testing is a plain loop over registered targets, returning the
  first whose rect contains the pointer. With a handful of slots that
  is both simpler and robust to scroll/layout shifts without caching.

## Constraints worth re-reading before extending

### Keep out of the sensor

- No knowledge of regions, widgets, chips, or page structure.
- No hit testing. (Controller's job.)
- No DOM mutation. (Visuals live in overlay/projection.)
- No commit logic.
- No layout reads on the hot path — one rect read at pickup, nothing
  during pointermove.

### Keep out of the commit boundary

- No DOM mutation.
- No decision about whether a drop is acceptable — target's `accepts`
  predicate runs in the controller before commit.
- No retry, debounce, or queueing. One call, one result.
- No domain logic. The consumer's `onDrop` translates
  `{ payload, target }` into `EditorAPI.move` / `.add`.

If something wants to live "inside" the commit boundary, it probably
belongs in the consumer's `onDrop`, or as a new stage in the
controller *before* commit (e.g. a validation stage that can
short-circuit without invoking the consumer).
