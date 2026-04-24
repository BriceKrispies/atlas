# Atlas Design-System Component Conventions

Normative contract for files in `packages/design/src/atlas-*.ts`. Every element
MUST follow these rules. Phase-2+ agents refactor against this doc verbatim.

Companion utilities: `packages/design/src/util.ts` — `uid`, `escapeAttr`,
`escapeText`, `createSheet`, `adoptSheet`. Core helpers: `AtlasElement.boolAttr`,
`AtlasElement.strAttr`, `AtlasElement.define` (idempotent).

## 1. Render pipeline

Shadow root is built ONCE in `connectedCallback` via a `_buildShell()` method.
`attributeChangedCallback(name)` dispatches to `_sync(name)` which touches ONLY
the region affected by `name`. Full `innerHTML` replacement is reserved for
structural attributes (call them out per component, e.g. `label`, `placeholder`
for text inputs typically are surgical-only).

Never re-render the entire shell from an attribute a user might be typing into —
that blows away caret position, focus, and composing IME state.

```ts
export class AtlasThing extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'disabled', 'placeholder'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncAll();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return; // shell not up yet; connectedCallback will sync
    this._sync(name);
  }

  private _built = false;
  private _buildShell(): void { /* assemble DOM once */ this._built = true; }
  private _sync(_name: string): void { /* targeted update */ }
  private _syncAll(): void { /* apply every observed attr after build */ }
}
```

## 2. Styles

Use `createSheet(cssText)` at module scope plus `adoptSheet(root, sheet)` in
the constructor. Do NOT inline `<style>${styles}</style>` in template strings;
do NOT construct the sheet inside the constructor.

```ts
import { adoptSheet, createSheet } from './util.ts';

const sheet = createSheet(`
  :host { display: block; }
  button { min-height: var(--atlas-touch-target-min, 44px); }
`);

class AtlasThing extends AtlasElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }
}
```

`adoptSheet` is idempotent — safe to call per instance; the sheet is shared.

## 3. Escaping

Every attribute or text value interpolated into `innerHTML` MUST go through
`escapeAttr` (for `attr="${…}"`) or `escapeText` (for text nodes). No
exceptions, even for "trusted" values — consistency matters.

```ts
import { escapeAttr, escapeText } from './util.ts';

const label = this.getAttribute('label') ?? '';
root.innerHTML = `
  <label for="${escapeAttr(this._inputId)}">${escapeText(label)}</label>
`;
```

Structured DOM assembly (`document.createElement` + `element.textContent = …`)
is always safe and needs no escaping.

## 4. IDs

Internal element ids (for `<label for>`, `aria-describedby`, etc.) use
`uid('atlas-cb')` — never inline `Math.random()` or incrementing counters.

```ts
import { uid } from './util.ts';
private readonly _inputId = uid('atlas-cb');
```

## 5. Event contract

Interactive controls emit native DOM events with atlas semantics layered on top:

- **`input`** — fires on every keystroke / drag / intermediate change (where
  applicable). Mirrors the native `<input>` event.
- **`change`** — fires on commit: blur for text, release for slider, toggle for
  checkbox/switch/radio, selection for select/multi-select. Never on every
  keystroke.
- CustomEvents carry a typed `detail`: `CustomEvent<AtlasThingChangeDetail>`.
  Export the detail interface alongside the class.
- Controls with BOTH `surfaceId` (from surface context) AND `name` (attribute)
  ALSO emit `${surfaceId}.${name}-changed` via `this.emit(...)` on commit.
- Click-only controls (button, nav-item) emit `${surfaceId}.${name}-clicked`
  via `this.emit(...)`.

```ts
export interface AtlasThingChangeDetail { value: string; }

// on commit:
this.dispatchEvent(new CustomEvent<AtlasThingChangeDetail>('change', {
  detail: { value }, bubbles: true, composed: true,
}));
const name = this.getAttribute('name');
if (name && this.surfaceId) this.emit(`${this.surfaceId}.${name}-changed`, { value });
```

## 6. Form association

Every form control sets `static formAssociated = true`, attaches
`ElementInternals` in the constructor, and keeps the form state in sync:

- Call `internals.setFormValue(value)` on commit.
- Call `internals.setValidity({ customError: true }, message)` when invalid;
  `internals.setValidity({})` when valid.

Form controls (exhaustive list): `atlas-input`, `atlas-textarea`,
`atlas-select`, `atlas-multi-select`, `atlas-checkbox`, `atlas-radio` (radio
group), `atlas-switch`, `atlas-number-input`, `atlas-slider`,
`atlas-date-picker`, `atlas-search-input`, `atlas-file-upload`.

```ts
class AtlasInput extends AtlasElement {
  static formAssociated = true;
  private _internals: ElementInternals;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._internals = this.attachInternals();
  }

  private _commit(value: string): void {
    this._internals.setFormValue(value);
    if (this.hasAttribute('required') && !value) {
      this._internals.setValidity({ valueMissing: true }, 'Required');
    } else {
      this._internals.setValidity({});
    }
  }
}
```

## 7. Boolean/string attribute reflection

Replace hand-written `get/set` boilerplate with the core helpers.

```ts
class AtlasCheckbox extends AtlasElement {
  declare checked: boolean;
  declare disabled: boolean;
  declare required: boolean;
  declare type: string;

  static {
    Object.defineProperty(this.prototype, 'checked', AtlasElement.boolAttr('checked'));
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'required', AtlasElement.boolAttr('required'));
    Object.defineProperty(this.prototype, 'type', AtlasElement.strAttr('type', 'text'));
  }
}
```

Decorators are NOT enabled in the TS config — do not use `@reflectBool`.

## 8. Type hygiene

- No `as unknown as X` double-casts. If you need one, the types are wrong —
  fix them or add a narrowing type guard.
- No non-null assertions (`!`) after type narrowing. Use early returns.
- No cross-module access to `_private` fields. If another module needs it, it
  is public API — give it a real name.
- Every element file exports its class and declares its tag:

  ```ts
  declare global {
    interface HTMLElementTagNameMap {
      'atlas-thing': AtlasThing;
    }
  }
  ```

- `AtlasElement.define('atlas-thing', AtlasThing)` is idempotent; importing
  the module twice is safe.
