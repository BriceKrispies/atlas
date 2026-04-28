# Atlas widget config schema extensions

The five `*.config.schema.json` files in this folder are JSON Schema (draft-07)
documents that describe a widget's per-instance config. Today the page-editor
inspector renders one flat field list; **stage 4** will rewrite the inspector
to honor a small set of `x-atlas-*` extension keys defined here.

> **Disclaimer.** Stage 4 will honor these keys. Until then they are inert
> metadata: the current `property-panel.ts` ignores anything outside the
> standard JSON Schema vocabulary, so adding these keys is a safe, forward
> compatible change.

All keys are namespaced (`x-atlas-…`) so they never collide with standard
JSON Schema and are stripped automatically by validators in strict mode.

---

## `x-atlas-section` _(per-property string)_

Identifies which inspector section a property belongs to. Sections are
free-form, but the editor team curates a shared vocabulary so widgets feel
consistent:

| id            | meaning                                                |
| ------------- | ------------------------------------------------------ |
| `content`     | The user-visible text / data the widget shows.         |
| `appearance`  | Visual variant, color, density, size.                  |
| `data`        | Bindings to projections / data sources.                |
| `behavior`    | Selection mode, pagination, interaction.               |
| `advanced`    | Power-user knobs (row keys, accessibility overrides).  |

```jsonc
"text": {
  "type": "string",
  "x-atlas-section": "content"
}
```

A property without `x-atlas-section` falls into the implicit "general"
bucket.

---

## `x-atlas-section-order` _(schema-root array)_

Declares the render order and labels of sections at the schema root. Each
entry is `{ id, label, defaultOpen? }`.

```jsonc
"x-atlas-section-order": [
  { "id": "content",    "label": "Content",    "defaultOpen": true },
  { "id": "appearance", "label": "Appearance", "defaultOpen": false }
]
```

If a property references a section id that's not listed here, the inspector
appends it to the end (alphabetical).

---

## `x-atlas-when` _(per-property object)_

Conditional visibility. A field is shown only when another sibling field
(at the same `properties` level) matches the given value.

```jsonc
"trendLabel": {
  "type": "string",
  "x-atlas-when": { "field": "trend", "equals": ["up", "down", "flat"] }
}
```

Semantics are intentionally minimal: **single-field equality only**.
`equals` accepts either a scalar (equality test) or an array (set
membership — the field is shown if its value is any one of the listed
values). No `notEquals`, no cross-field combinators, no boolean operators.
Multi-condition logic belongs in stage 5+.

---

## `x-atlas-control` _(per-property string)_

Override the control type the inspector picks based on JSON type. Useful
when a string needs a textarea or an enum needs a dropdown instead of a
chip row.

| value       | renders as                                           |
| ----------- | ---------------------------------------------------- |
| `textarea`  | multi-line text area (string fields only)            |
| `select`    | `<select>` dropdown (enum fields)                    |
| `chips`     | chip / button row (enum fields, the current default) |
| `color`     | color picker (string fields holding CSS colors)      |
| `csv`       | comma-separated input for a string-encoded list      |

```jsonc
"content": {
  "type": "string",
  "x-atlas-control": "textarea"
}
```

If absent, the inspector picks a control from the JSON type as it does today.

---

## `x-atlas-presets` _(schema-root array)_

A list of named presets the inspector can render as one-click buttons.
Each entry is `{ id, label, description?, config }` where `config` is a
**partial config object** that is merged onto the current instance config
(shallow merge, top-level keys overwrite).

```jsonc
"x-atlas-presets": [
  {
    "id": "h1-page-title",
    "label": "H1 page title",
    "description": "Top-level page heading.",
    "config": { "level": 1 }
  }
]
```

Presets are advisory: the inspector does not enforce that the resulting
config validates, but well-behaved presets should produce a valid config
when merged onto a typical starting state.
