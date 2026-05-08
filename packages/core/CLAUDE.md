# `@atlas/core` — UI Primitives

The foundation every Atlas UI element extends. Three concerns:

1. **`AtlasElement`** — base class for every custom element on a page
2. **`AtlasSurface`** — top-level surface (page / widget / dialog) that owns load state
3. **Signals + `html` template** — fine-grained reactivity and safe rendering

`/packages/core` exports nothing else. Anything heavier (a real component, a
widget, a layout template) belongs in another package.

## Public Surface

`src/index.ts` exports:

```ts
// signals.ts
export { signal, computed, effect, batch };
export type { Signal, Computed, EffectCleanup, EffectCallback };

// html.ts
export { html };
export type { HtmlValue };

// component.ts
export { AtlasElement, AtlasSurface };
export type { SurfaceState, SurfaceLoadingConfig, SurfaceEmptyConfig, SurfaceBackendAdapter };
```

## `AtlasElement`

`packages/core/src/component.ts:28` — extends `HTMLElement`.

Every interactive or testable UI primitive in Atlas extends this. It bakes in:

- **Test IDs.** When a `name` attribute is present and a parent `AtlasSurface` provides a `surfaceId`, `connectedCallback` sets `data-testid="${surfaceId}.${name}"` (or `${surfaceId}.${name}.${key}` if `key` is also set). This is what makes Playwright tests stable.
- **Reactive render.** If a subclass overrides `render()` to return a `DocumentFragment`, `connectedCallback` wires it through `effect(...)` — the fragment re-runs on signal changes.
- **Lifecycle hooks.** `onMount()` and `onUnmount()` for subclasses to override; `disconnectedCallback` cleans up the render effect.
- **Telemetry.** `emit(name, props)` logs a structured event with surface context.
- **Idempotent registration.** `AtlasElement.define(tag, class)` is a no-op if the tag is already registered to the same class; it warns once if registered to a different class.

### Selector / attribute handling

There is **no constructor-arg selector**. Components register themselves via:

```ts
AtlasElement.define('atlas-button', AtlasButton);
```

Reflected attributes are wired with two static helpers:

```ts
class AtlasButton extends AtlasElement {
  declare variant: string;
  declare disabled: boolean;
  static {
    Object.defineProperty(this.prototype, 'variant',
      AtlasElement.strAttr('variant', ''));
    Object.defineProperty(this.prototype, 'disabled',
      AtlasElement.boolAttr('disabled'));
  }
}
```

- `AtlasElement.strAttr(name, default?)` — string attribute with optional default
- `AtlasElement.boolAttr(name)` — presence-only boolean attribute

These replace the ~30 hand-rolled `get/set` blocks the design system used to carry.

### API summary

| Member | Purpose |
|--------|---------|
| `static define(tag, class)` | Register custom element (idempotent) |
| `static boolAttr(name)` | Property descriptor for boolean attribute |
| `static strAttr(name, default?)` | Property descriptor for string attribute |
| `static observedAttributes` | Override to opt in to `attributeChangedCallback` |
| `render()` | Subclass override; return `DocumentFragment` from `html\`...\`` |
| `onMount()` / `onUnmount()` | Subclass lifecycle hooks |
| `emit(name, props)` | Telemetry with surface context |
| `surface` (getter) | Walks DOM (and shadow hosts) to nearest `AtlasSurface` |
| `surfaceId` (getter) | The nearest surface's id, or `''` |
| `attributeChangedCallback(...)` | Subclass override |

## `AtlasSurface`

Top-level container — page, widget shell, or dialog. Provides `surfaceId` for
descendants and owns `SurfaceState` (`loading | empty | success | error |
unauthorized`). Configures loading and empty placeholders via
`SurfaceLoadingConfig` / `SurfaceEmptyConfig`.

A page in `apps/admin`, `apps/authoring`, or `apps/sandbox` is typically a
custom element that extends `AtlasSurface` and holds child `AtlasElement`s.

### State rendering — body-slot pattern

**The surface frame from `render()` persists across loading / empty / success /
error.** Static `empty` populates the body region (slot), not the whole
surface. Authors opt in by including a `data-surface-body` element somewhere
in their `render()` output:

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

What this buys you: the heading and actions stay visible on every state.
When data is empty, only the contents of `[data-surface-body]` get replaced
with the empty markup; loading and error states do the same.

**Surfaces that don't include the slot keep the legacy full-replacement
behavior** — appropriate for tile / dialog / first-run surfaces where the
empty state IS the entire UI.

**Implication for `render()`:** the framework calls `render()` to mount the
frame *before* deciding whether to overlay an empty/error state. Author's
render bodies must therefore handle null/empty `this.data` gracefully (e.g.
`(this.data ?? []) as Row[]`). Most existing surfaces already do this.

Full rationale + alternatives considered: [`specs/decisions/0001-atlas-surface-state-rendering.md`](../../specs/decisions/0001-atlas-surface-state-rendering.md).

## Signals

Fine-grained reactivity, no virtual DOM. From `signals.ts`:

```ts
const count = signal(0);
const doubled = computed(() => count.value * 2);
const dispose = effect(() => console.log(doubled.value));

batch(() => { count.set(1); count.set(2); }); // effects fire once
dispose();
```

- `signal(v)` — readable+writable atom (`.value` / `.set(v)`)
- `computed(fn)` — derived signal; auto-updates
- `effect(fn)` — runs immediately + on dep changes; returns cleanup
- `batch(fn)` — coalesce multiple writes into a single notification

`AtlasElement.connectedCallback` wraps `render()` in `effect(...)` automatically — read a signal in `render()` and the element re-renders when it changes.

## `html` Template Tag

Tagged template that returns a `DocumentFragment` with safe interpolation —
auto-escapes text, supports event listeners (`@click=…`) and property bindings
(`.value=…`).

```ts
import { html, signal } from '@atlas/core';

const name = signal('world');
return html`<p>Hello ${name.value}</p>`;
```

Use `html\`\`` for any DOM building inside `render()`. Never `innerHTML =`.

## Dos and Don'ts

- **Do** extend `AtlasElement` for every custom element. Even purely visual ones — the test-id machinery and lifecycle wiring are worth it.
- **Do** wrap every page / widget / dialog shell in an `AtlasSurface`.
- **Do** read signals in `render()`; don't manage your own `requestAnimationFrame`.
- **Don't** add fields here that aren't primitives. Components go in `/packages/design`; widgets in `/packages/widgets`.
- **Don't** import `@atlas/design` from here. The dependency goes one way: design → core.
