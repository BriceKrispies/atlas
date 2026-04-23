# Interaction Contracts

Every interactive surface in Atlas — charts, editors, drag-and-drop, resize —
exposes a **committed state contract** that Playwright can read
deterministically. This document defines the contract and its canonical
intents.

## Why

User-driven state (chart selection, editor document, drag payload) lives in
component-local signals. Without a stable, test-visible handle, tests are
forced to scrape DOM, dispatch synthetic events, or rely on timing. That
produces brittle specs and leaves whole interaction surfaces untestable.

The interaction contract gives Playwright a single deterministic answer to
"did the UI accept this user action, and what state did it land in".

## Primitives

### The registry — `@atlas/test-state`

Each surface calls `registerTestState(key, reader)`. The reader returns a
JSON-safe snapshot of the surface's externally-observable state including a
`lastCommit` field. The registry installs `window.__atlasTest` in dev builds
only; in prod it is tree-shaken (`import.meta.env.DEV === false`).

Registry keys are namespaced:

| Surface type  | Key shape               | Example            |
|---------------|-------------------------|--------------------|
| Chart         | `chart:<chartId>`       | `chart:sales-q1`   |
| Editor        | `editor:<editorId>`     | `editor:page-42`   |
| Layout editor | `editor:<editorId>`     | `editor:layout-1`  |
| Drag session  | `drag:<surface>`        | `drag:layout`      |

### The commit envelope

Every user intent routes through a controller `commit(intent, patch)` that
(1) updates signals and (2) records `lastCommit`:

```js
{
  surfaceId: 'chart:sales-q1',
  intent: 'toggleSeries',
  patch: { seriesId: 'revenue', hidden: true },
  at: 1712342102931,
}
```

`@atlas/test-state` exports `makeCommit(surfaceId, intent, patch)` — surfaces
SHOULD use it to build the record so the shape stays uniform.

## Canonical intents

### Chart (`chart:<id>`)

| Intent          | Patch shape                                      |
|-----------------|--------------------------------------------------|
| `setConfig`     | `{ field, value }`                               |
| `selectSeries`  | `{ seriesId, pointIndex? }`                      |
| `toggleSeries`  | `{ seriesId, hidden }`                           |
| `setFilter`     | `{ field, op, value }`                           |
| `clearFilter`   | `{ field }`                                      |
| `setTimeRange`  | `{ preset }` or `{ from, to }`                   |
| `pushDrilldown` | `{ level, label, value }`                        |
| `popDrilldown`  | `{ toDepth }`                                    |
| `requestExport` | `{ format }` — `'csv'` \| `'png'`                |

Chart snapshot shape:

```js
{
  config, data, selection, filters, timeRange,
  hiddenSeries, drilldownStack, exportStatus,
  lastCommit,
}
```

### Editor (`editor:<id>`, layout and block)

| Intent          | Patch shape                                            |
|-----------------|--------------------------------------------------------|
| `insertBlock`   | `{ blockId, type, at }`                                |
| `removeBlock`   | `{ blockId }`                                          |
| `moveBlock`     | `{ blockId, from, to }`                                |
| `updateBlock`   | `{ blockId, patch }`                                   |
| `setSelection`  | `{ blockId \| null }`                                  |
| `applyFormatting` | `{ blockId, format }`                                |
| `drop`          | `{ widgetId, fromSlot, toSlot }` (layout)              |
| `resize`        | `{ instanceId, width?, height? }` (layout)             |
| `save`          | `{}`                                                   |

Editor snapshot shape:

```js
{ document, selection, dirty, lastCommit }
```

### Drag session (`drag:<surface>`)

Reader returns `{ active, payload, hoveredSlotId }`. Not a commit surface —
the commit lands on the owning editor when the drop completes. Tests SHOULD
assert the drag reader reports `active: true` while moving and `active: false`
after drop, and then assert the editor's `lastCommit.intent === 'drop'`.

## Rules

1. **Every user-driven state change MUST go through `commit`**. No direct
   signal writes from event handlers. This keeps `lastCommit` the single
   source of truth for "what did the UI just do".

2. **Intents are past-tense facts**, not future-tense commands. `setConfig`
   means "config was set", not "please set config". The commit is recorded
   AFTER the state has been updated.

3. **Readers MUST be pure and JSON-safe**. No DOM references, no functions,
   no class instances. The reader runs inside `page.evaluate`.

4. **`registerTestState` MUST be called from `onMount`** and its disposer
   MUST be invoked from `onUnmount` so hot reload and surface teardown stay
   clean.

5. **Rejected intents MUST NOT commit.** If a drop lands on an invalid slot,
   do not call `commit('drop', …)`. Tests rely on absence of commit to
   assert rejection.

6. **The `key` attribute disambiguates repeated children** (see
   `constitution.md` §C2.3). Every interactive child of a surface SHOULD
   have `name` + `key` so its testid is stable.

## Test helpers

`@atlas/test-fixtures` exports:

- `readChartState(page, id)`, `readEditorState(page, id)`,
  `readLayoutState(page, id)`, `readDragState(page, surface)`
- `assertCommitted(page, surfaceKey, { intent, patch }, { timeout })` —
  polls `getLastCommit` until the shape matches
- `dragWidget(page, { editorId, from, to })` — pointer-driven drag that
  ends by asserting a `drop` commit
- `resizeWidget(page, { editorId, handleSelector, dx, dy })` — pointer
  drag on a resize handle that ends by asserting a `resize` commit

## References

- `specs/frontend/constitution.md` §C2 (auto testids) and §C9 (Playwright)
- `frontend/packages/test-state/src/index.js` — registry implementation
- `frontend/packages/test-fixtures/src/test-state.js` — Playwright helpers
