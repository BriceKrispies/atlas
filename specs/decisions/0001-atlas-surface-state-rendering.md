# ADR-0001: AtlasSurface state rendering

**Status:** Accepted
**Date:** 2026-05-04
**Scope:** `@atlas/core` — `AtlasSurface` base class

## Context

`AtlasSurface` is the base class every page-level UI surface in Atlas extends.
It manages four runtime states: **loading**, **success**, **empty**, **error**.
Each state has a corresponding `_show*` method that paints the surface.

The original implementation (pre-2026-05) replaced the *entire* surface body
on every state transition. That meant:

- The skeleton (loading) replaces everything inside the surface
- The empty-state markup (heading + body + action, from the static `empty`
  config) replaces everything
- The error markup (message + retry) replaces everything
- `render()` output replaces everything on success

This worked for tile-shaped surfaces where the empty state IS the surface.
It broke for page-shaped surfaces where the surface has persistent chrome
(page heading, breadcrumbs, action bar) that the user expects to see across
states. Concretely: `apps/admin/src/features/authz/policies-list` declared
its `<atlas-heading>Authorization policies</atlas-heading>` inside `render()`,
which meant the heading vanished whenever the policies list was empty —
catching this surfaced as a Playwright e2e test that asserted both the page
heading and the empty-state body were visible together. They couldn't be.

## Decision

**The surface frame from `render()` persists across states.** State-specific
markup populates a designated body region inside the frame, not the whole
surface.

The body region is opt-in via a `data-surface-body` attribute on any element
inside the surface's `render()` output:

```ts
override render(): DocumentFragment {
  return html`
    <atlas-stack gap="lg">
      <atlas-heading level="1">Authorization policies</atlas-heading>
      <atlas-button name="create-button">New policy</atlas-button>
      <div data-surface-body>
        ${this._renderTable(rows)}
      </div>
    </atlas-stack>
  `;
}
```

When the surface enters loading / empty / error, `AtlasSurface` mounts the
frame (calls `render()`), locates the `[data-surface-body]` element, and
replaces only its contents with the state-specific markup.

**Surfaces that do NOT include a body slot** keep the legacy full-replacement
behavior. This preserves backward compatibility for tile / dialog surfaces
where the empty state is the entire UI.

## Options considered

| Option | What "empty" replaces | Trade-offs |
|---|---|---|
| **A — Full replacement (legacy)** | Entire surface body | Simple, but kills any persistent chrome the author put in `render()`. Wrong default for page-shaped surfaces |
| **B — Body-slot opt-in (chosen)** | Only the contents of `[data-surface-body]` if present; falls back to (A) otherwise | Backward compatible; explicit opt-in; one rule the framework enforces. Slight cost: authors of page-shaped surfaces have to remember the wrapper |
| **C — Per-surface mode flag** | Author sets `static frameMode: 'replace' \| 'overlay'` | Maximum flexibility, no consistency. Risk: every surface picks differently and the app behaves inconsistently |

We chose **B** because:
- Most page-shaped surfaces want the overlay behavior (header / actions /
  breadcrumbs persistent), so the new default matches the common case.
- Tile and dialog surfaces keep the existing behavior with no migration —
  they just don't include the slot.
- A single rule (`look for data-surface-body`) is easier to reason about
  than per-surface configuration.

## Consequences

### Positive

- Page-shaped surfaces (admin pages, authoring views, list/detail pages)
  can declare their header once and have it persist across all four states
  without manual re-injection in `empty.heading`.
- Empty-state UX gets meaningfully better: the user sees "Authorization
  policies — No policy versions yet" with the same header they'd see if
  data existed, instead of a context-free "No policy versions yet" card.
- Tests that assert "frame X visible across states" become possible (and
  natural). Before this ADR, such an assertion had to be split into one
  test per state.

### Negative

- Authors of new page-shaped surfaces have to remember to wrap their body
  region in `<div data-surface-body>`. Forgetting it means the surface
  silently uses the legacy behavior — heading disappears in empty state.
  Mitigation: `packages/core/CLAUDE.md` documents the rule prominently in
  the AtlasSurface section.
- Surfaces that have legitimate full-replacement behavior (tiles, dialogs)
  rely on the absence of the slot — so removing the slot from a surface
  that doesn't want it is a meaningful change, not a no-op.
- The `render()` output now has to be safe to call when `this.data` is
  empty/null (because the framework calls render to mount the frame
  before deciding to replace the body). Most existing surfaces already
  handle this defensively (e.g., `(this.data ?? []) as PolicySummary[]`),
  but it's now a documented contract.

### Migration cost

- Existing surfaces: zero forced churn. Surfaces continue to work.
- Surfaces that *want* the new behavior: one-line wrapper change. See the
  PoliciesListPage migration in this same change as the worked example.

## Implementation pointer

`packages/core/src/component.ts` — `AtlasSurface._showEmpty`,
`_showLoading`, `_showError`. Each tries to mount the frame + replace the
body slot first; falls back to legacy full-replacement if no slot is
found.

## See also

- `packages/core/CLAUDE.md` — load-bearing rule for surface authors
- `packages/design/CLAUDE.md` — cross-reference
- `tests/bdd/README.md` — note for test authors writing assertions across surface states
