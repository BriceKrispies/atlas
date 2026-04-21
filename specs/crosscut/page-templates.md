# Page Templates

## Overview

A **Page Template** is the shared outer chrome for a content page. It defines a set of named **regions** (drop zones) and renders the visual scaffold around them. A **Page Document** picks a template by id and fills each region with an ordered list of **widget entries**.

Templates are to pages what widget manifests are to widgets: a declarative contract plus a custom element that renders the frame. Both ship in UI Bundles (see `crosscut/ui.md`) alongside widgets, so a tenant admin can add a new layout by installing a bundle that exports it.

Templates exist so that:

- Every content page inherits consistent chrome (header, nav, spacing) without reimplementing it.
- Tenant admins can pick from a library of layouts per page, instead of hand-writing layout markup.
- The region model gives the widget-host a stable set of slot names to target — the template and the widgets negotiate placement through slot permissions, not through DOM coincidence.
- The platform can evolve layouts (add new templates, version existing ones) without touching widget code.

## What a Page Template Is

A page template is:
- A web component class extending `AtlasElement` (frontend `@atlas/core`)
- Accompanied by a **manifest** declaring identity, version, and region definitions
- Registered into a `TemplateRegistry` at bundle-init time, the same way widgets are
- Instantiated by a `<content-page>` element, which inserts it into the DOM and mounts a `<widget-host>` whose slots = the template's regions

## What a Page Template Is NOT

A page template is NOT:
- A place for business logic — it renders chrome and exposes region containers, nothing more.
- Aware of which widgets live in it — widget identity comes from the page document, not the template.
- A layout grid — regions are named drop zones, not coordinates. Templates that want a grid render it internally and expose named regions on top.
- Tenant data — the template is bundle code; only the *choice* of template and the region contents are tenant data.

## Template Manifest

Every template exports a manifest alongside its element class. The manifest is validated against `schemas/contracts/page_template.schema.json` at registration time.

Required fields:

| Field | Description |
|-------|-------------|
| `templateId` | Globally unique, kebab-case, dot-separated (e.g. `template.one-column`, `template.two-column`) |
| `version` | Semantic version of this template |
| `displayName` | Human-readable label used in the template picker |
| `regions` | Ordered array of region declarations (see below) |

Optional fields:

| Field | Description |
|-------|-------------|
| `description` | Longer description shown in the picker |
| `preview` | URL to a preview thumbnail (template-picker UI) |

### Region Declaration

Each region has:

| Field | Description |
|-------|-------------|
| `name` | Region name (kebab-case). Matches the slot name a widget's manifest declares in its `slots`. |
| `required` | If `true`, the page document MUST place at least one widget in this region. |
| `maxWidgets` | Optional upper bound on how many widgets may be placed. `null`/absent = unbounded. |
| `allowedSlots` | Optional array of widget `slots` values a widget must declare to be placed here. If absent, any widget whose `slots` includes this region's `name` is allowed. |

The manifest is the template's **contract with the host and the editor**: any region not listed cannot be filled; `maxWidgets` is enforced on every drop; widgets that don't declare a matching slot in their manifest are refused.

## Page Document

A **Page Document** is the tenant-scoped record that binds a page to a template and stores the widget placement for each region. It is validated against `schemas/contracts/page_document.schema.json`.

```json
{
  "pageId": "welcome",
  "tenantId": "acme",
  "templateId": "template.two-column",
  "templateVersion": "0.1.0",
  "regions": {
    "main": [
      { "widgetId": "content.announcements", "instanceId": "w-main-1", "config": { "mode": "text", "text": "Welcome!" } }
    ],
    "sidebar": [
      { "widgetId": "content.announcements", "instanceId": "w-side-1", "config": { "mode": "text", "text": "Need help? Email support." } }
    ]
  },
  "status": "published",
  "meta": { "title": "Welcome", "slug": "/welcome" }
}
```

The `regions[name][i]` entry reuses the `WidgetInstance` definition from `page_layout.schema.json` — there is ONE widget-entry shape in the platform, not two.

### templateVersion

`templateVersion` is stored with every page so a template author can:
- Evolve templates additively (add a new optional region) and have old page docs silently upcast.
- Make breaking changes (rename or remove a region) and migrate explicitly by bumping the version and writing a migration.

At render time, if the stored `templateVersion` is strictly less than the registered template's version, the `<content-page>` element SHOULD upcast using a template-supplied migration function (not part of v1). If the stored version is ahead of the registered version, the render MUST fail closed with a clear error.

## Template & Page Lifecycle

| Step | Owner |
|------|-------|
| Register template | Bundle init — calls `templateRegistry.register({ manifest, element })` |
| Load page document | `<content-page>` calls `pageStore.get(pageId)` |
| Validate page document | `pageStore` (or `ValidatingPageStore` decorator) — against `page_document.schema.json` |
| Resolve template | `<content-page>` looks up `templateId` in the registry |
| Validate regions | `<content-page>` — every region name in the document MUST exist in the template's manifest; required regions MUST be non-empty |
| Render chrome | `<content-page>` instantiates the template element |
| Mount widgets | `<content-page>` inserts a `<widget-host>` whose `layout.slots` = the document's `regions` |
| Edit | Editor mode (`<content-page edit>`) — see below |
| Save | Editor calls `pageStore.save(pageId, nextDoc)` on every successful change |

## PageStore Port

The `<content-page>` element does not know where page documents live. It talks to a `PageStore` port passed in as a property:

```ts
interface PageStore {
  get(pageId: string): Promise<PageDocument | null>;
  save(pageId: string, doc: PageDocument): Promise<void>;
  list(): Promise<PageDocument[]>;
  delete(pageId: string): Promise<void>;
}
```

Two adapters are planned:

| Adapter | Use |
|---------|-----|
| `InMemoryPageStore` | Sandbox today; unit tests; offline authoring demos |
| `HttpPageStore` | Admin app once backend persistence lands |

Both adapters MUST be wrappable by `ValidatingPageStore`, a decorator that validates every input and output against `page_document.schema.json`. The decorator is the enforcement point for the frozen v1 shape — it guarantees that the in-memory path and the backend path produce the same documents.

The repository-port shape lets the admin app swap persistence layers at bootstrap with a **one-line** change. Nothing downstream of the store needs to know which adapter is wired.

## Editor Mode

`<content-page>` supports an `edit` boolean attribute. When set:

- Each mounted widget cell gains a chrome overlay with a drag handle, a delete button, and a focus ring. The widget body below stays interactive.
- A `<widget-palette>` renders adjacent to the page body, listing every widget in the registry that could be placed into *some* region of the active template.
- Pointer-based drag and drop lets the user:
  - Move a widget from one region to another.
  - Reorder widgets within a region.
  - Add a new widget by dragging it out of the palette.
  - Delete a widget by clicking its delete button (or pressing `Delete` while focused on its cell).

Drops are validated against **three** constraints, checked in order, in a pure `dropZones.computeValidTargets(widgetId, page, template)` function:

1. **Target region MUST exist in the template's manifest.**
2. **Widget's `manifest.slots` MUST include the target region's name** (or the region's `allowedSlots` MUST include one of the widget's slots, if the region declares `allowedSlots`).
3. **`region.maxWidgets` MUST NOT be exceeded** after the move or add.

If any constraint fails, the drop zone is shown as invalid (typically a red outline). Failed drops do not call `pageStore.save()`.

Keyboard parity is non-optional (WCAG 2.1 AA, SC 2.1.1):

- Widget cells are tabbable (`tabindex="0"`).
- `Space` / `Enter` on a focused cell picks it up; arrow keys move between regions or within a region; `Space` / `Enter` again drops; `Escape` cancels.
- Palette chips are buttons; activating one enters an "add mode" where arrow keys pick a region and `Enter` places the widget.
- Changes are announced to an `aria-live="polite"` region ("Announcements moved from Main to Sidebar").

Every successful edit calls `pageStore.save(pageId, nextDoc)`. The element then re-reads and re-renders; widget unmount/remount is handled by `<widget-host>`'s existing teardown path.

## Authorization Integration

- **View**: authorized against the containing page at the existing `ContentPages.Page.View` scope (see `modules/content-pages.json`).
- **Edit**: authorized at `ContentPages.Page.UpdateLayout` (new action — tracked in the backend migration plan, not implemented yet).
- **Widget invocation of capabilities**: unchanged — the widget-host's `CapabilityBridge` still enforces manifest-declared capabilities at call time.

Region-level and widget-instance-level permissions are out of scope for v1. The editor is an all-or-nothing scope at the page level.

## Observability

The `<content-page>` element MUST emit telemetry for:
- Page load (pageId, templateId, templateVersion, correlationId, elapsedMs)
- Page load failure (missing page, missing template, validation failure)
- Edit action (drop, delete, add; before/after region+index; widgetId; correlationId)
- Save failure (schema violation, store rejection)

Widget mount/unmount telemetry is already emitted by `<widget-host>` and is not duplicated here.

## Invariants

- **INV-TEMPLATE-01**: A template manifest MUST declare `templateId`, `version`, `displayName`, and at least one `region`.
- **INV-TEMPLATE-02**: Every region name referenced by a page document MUST exist in the resolved template's manifest.
- **INV-TEMPLATE-03**: A widget MAY be placed in a region only if the widget's manifest `slots` includes the region's name (or satisfies the region's `allowedSlots` if present).
- **INV-TEMPLATE-04**: A region's `maxWidgets` MUST NOT be exceeded after any edit operation.
- **INV-TEMPLATE-05**: Every `required: true` region MUST contain at least one widget entry in a saved page document.
- **INV-TEMPLATE-06**: A page document MUST validate against `page_document.schema.json` at both read and write time; a failing document MUST NOT be rendered or persisted.
- **INV-TEMPLATE-07**: The `PageStore` port interface MUST be stable across adapters; swapping adapters at bootstrap MUST NOT require code changes outside the single wiring point.
- **INV-TEMPLATE-08**: A stored `templateVersion` greater than the registered template's version MUST fail closed at render time. A stored version less than the registered version MAY be upcast if the template declares a migration.
- **INV-TEMPLATE-09**: Editor drag/drop MUST enforce INV-TEMPLATE-02, 03, and 04 before calling `pageStore.save()`; invalid drops MUST NOT mutate the store.
- **INV-TEMPLATE-10**: Editor keyboard interaction MUST reach every action that pointer drag reaches (pick up, move, cancel, drop, delete, add from palette).

## Page Document Shape — Frozen at v1

The page document shape (`page_document.schema.json`) is **frozen at v1**. Both `InMemoryPageStore` and the future `HttpPageStore` MUST round-trip the shape byte-equivalent (modulo JSON key ordering).

A round-trip fixture (`fixtures/page_document__valid__backend_round_trip.json`) is treated as a contract test: a backend implementation that fails to return this document verbatim on GET is non-conformant.

Breaking the v1 shape requires a new schema version (`page_document.v2.json`), not an in-place edit.

## Open Questions

- Should templates be allowed to declare **default widgets** (e.g., a fresh two-column page seeds with an empty announcements widget in main)? Current plan: no — keep templates chrome-only; let the editor's "new page" flow seed defaults.
- Should there be a **global layout** that wraps every page (site nav, header, footer) above the template? Current plan: yes, but that's an admin-app shell concern, not a template concern.
- Should **region-level ABAC** eventually be a thing (e.g., a "moderator" widget region only editable by a specific role)? Flagged for later; v1 is page-level only.
- Does the admin app need **template-picker previews** that render real templates with placeholder widgets? Likely yes; treat as a separate surface when the editor lands.
- Undo/redo in the editor: trivially addable via snapshot-on-save; deferred from v1.
