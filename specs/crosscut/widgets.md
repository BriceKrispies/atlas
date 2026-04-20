# Widgets

## Overview

A **Widget** is an isolated UI island that renders inside a configurable surface (a content page, a dashboard, a detail view). Widgets are the unit of composition for tenant-configurable layouts: tenant admins place widget instances into page slots, supply per-instance configuration, and the platform renders them without the widgets knowing about or depending on each other.

Widgets are delivered as code inside a **UI Bundle** (see `crosscut/ui.md`). A bundle's `provides.widgets` list references widget identifiers; the widget source lives in the bundle. Widget **placement and configuration** is tenant data, not bundle code — the split mirrors the data/code separation defined for UI Bundles.

Widgets may only communicate with other widgets through an explicit **Mediator** (see "Mediator Semantics" below). Widgets may only reach the platform (backend, storage, navigation) through an explicit **Capability Bridge**. Both constraints exist so that:

- Two widgets written by different authors cannot collide in the DOM, in global state, or in network side effects.
- A widget's reach into the platform is declared in its manifest, reviewable, and revocable.
- The same widget source code runs unchanged under lighter or stronger isolation modes.

## What a Widget Is

A widget is:
- A web component class extending `AtlasSurface` (frontend `@atlas/core`)
- Accompanied by a **manifest** declaring identity, version, config schema, isolation mode, capabilities, and mediator topics
- Instantiated by a `<widget-host>` element, which passes `config` and `context` before mount
- Scoped to a single page-load of a single host — state does not leak across hosts or instances

## What a Widget Is NOT

A widget is NOT:
- A global singleton — multiple instances of the same widget may coexist on one page, each with its own config
- Free to `fetch()`, read `document.cookie`, or call platform APIs directly — all platform access goes through the Capability Bridge
- Free to reference sibling widgets directly — cross-widget communication is Mediator-only
- Responsible for its own auth — the host injects a serializable principal via `context`
- Allowed to mutate the DOM outside of its assigned mount container

## Widget Manifest

Every widget exports a manifest alongside its element class. The manifest is validated against `schemas/contracts/widget_manifest.schema.json` at registration time.

Required fields:

| Field | Description |
|-------|-------------|
| `widgetId` | Globally unique, kebab-case, namespaced by module (e.g. `content.announcements`, `comms.messaging`) |
| `version` | Semantic version of this widget |
| `displayName` | Human-readable label |
| `configSchema` | JSON schema id identifying the shape of per-instance config |
| `isolation` | One of `inline`, `shadow`, `iframe` — see "Isolation Modes" |

Optional fields:

| Field | Description |
|-------|-------------|
| `capabilities` | Array of capability names the widget is permitted to invoke (e.g. `["backend.query"]`) |
| `provides.topics` | Mediator topics the widget may publish or answer |
| `consumes.topics` | Mediator topics the widget may subscribe to |
| `slots` | Slot names in which this widget is allowed to be placed (default: any) |

The manifest is the widget's **contract with the host**. Any capability, topic, or DOM effect not declared is denied.

## Isolation Modes

A widget declares one isolation mode. The host chooses a host implementation based on this flag. Widget source code does not change between modes.

### `inline`

The widget element is attached directly to the host's light DOM. Fastest, smallest overhead. Widget styles can affect and be affected by page CSS. Suitable for first-party widgets the platform team trusts.

Guarantees:
- Mediator isolation (topic enforcement)
- Capability isolation (declared-only)
- Error boundary (widget failure does not take down siblings)

### `shadow`

The widget element is mounted inside a closed shadow root attached to a host-managed container. Style boundary is enforced; `document.querySelector` across the boundary returns nothing.

Adds on top of `inline`:
- CSS containment
- DOM encapsulation (page JS cannot read or mutate widget internals)

### `iframe`

The widget runs inside a sandboxed `<iframe>` (`sandbox="allow-scripts"`, no `allow-same-origin`). Host and widget communicate exclusively over `postMessage`. Widget has no access to the page's JS realm, cookies, localStorage, or DOM. Suitable for third-party or untrusted widgets.

Adds on top of `shadow`:
- JS realm separation
- No shared globals, no shared prototypes
- Origin-separated storage (widget's `localStorage` is its own)

## Mediator Semantics

Every `<widget-host>` owns one `WidgetMediator` instance. The mediator is the sole channel for widget-to-widget communication.

Scope:
- One mediator per host instance. Widgets on page A cannot hear widgets on page B.
- Widgets identify themselves by their `instanceId` (supplied in the page layout) so the mediator can enforce per-widget permissions.

Topics:
- Topics are first-class. A widget may only `publish` topics listed in its `provides.topics`.
- A widget may only `subscribe` to topics listed in its `consumes.topics`.
- Undeclared publish or subscribe throws `UndeclaredTopicError`.

Dispatch:
- All delivery is asynchronous (microtask-scheduled) regardless of isolation mode. Widgets MUST NOT rely on synchronous ordering.
- `publish(topic, payload)` — fire and forget. Returns `void` (not a Promise).
- `request(topic, payload) → Promise<result>` — ask-style. Resolves with the first subscriber's return value. Rejects if no subscriber returns a value within an implementation-defined timeout.
- Payloads MUST be JSON-serializable. No functions, no class instances, no DOM nodes.

## Capability Bridge

Every host owns one `CapabilityBridge` instance. The bridge is the sole channel for widget-to-platform side effects.

- The host registers capability implementations (e.g. `backend.query`, `backend.command`, `storage.get`, `navigation.go`).
- A widget invokes a capability via `context.request(capabilityName, args) → Promise`.
- A widget may only invoke capabilities listed in its `manifest.capabilities`.
- Undeclared invocation throws `CapabilityDeniedError`.
- Capability argument shapes are capability-defined; the host validates.

The Capability Bridge exists so that the set of platform effects a widget can produce is reviewable in its manifest. Granting a new capability to a widget is an explicit, auditable change.

## Context

Before calling `onMount`, the host assigns `widget.config` (validated against `manifest.configSchema`) and `widget.context` to every widget instance. `context` is JSON-serializable for `iframe` parity:

| Field | Description |
|-------|-------------|
| `correlationId` | Correlation id for this mount's observability |
| `principal` | Serializable principal (id, roles, permissions — no functions) |
| `tenantId` | Current tenant id |
| `locale` | Active locale |
| `theme` | Active theme id |
| `channel` | Mediator proxy: `publish(topic, payload)`, `subscribe(topic, handler)`, `request(topic, payload)` |
| `request` | Capability bridge proxy: `request(capabilityName, args) → Promise` |
| `log` | Structured log sink |

`channel` and `request` are the only "live" fields — under `iframe` isolation they are message-based proxies; under `inline` they call into the host directly. The widget's code is identical either way.

## Lifecycle

| Step | Widget responsibility | Host responsibility |
|------|-----------------------|---------------------|
| Resolve | — | Look up `widgetId` in registry, retrieve manifest |
| Validate | — | Validate `manifest`, `layout` entry, and `config` against `configSchema` |
| Instantiate | — | Choose host implementation by `manifest.isolation`; construct the container |
| Inject | — | Assign `this.config` and `this.context` |
| Mount | Implement `onMount()` | Append widget to its container |
| Update | Implement `onConfigChange(newConfig)` (optional) | Detect layout edits, re-validate, call update hook |
| Unmount | Implement `onUnmount()` | Detach, drop subscriptions, revoke context handles |

## Page Layout

A content page stores its widget placement as a JSON document validated against `schemas/contracts/page_layout.schema.json`:

```json
{
  "version": 1,
  "slots": {
    "main": [
      { "widgetId": "content.announcements", "instanceId": "w-001", "config": { "mode": "text", "text": "Welcome!" } }
    ]
  }
}
```

Layouts are tenant data; the bundle does not contain them. The `<widget-host>` element reads a layout, resolves each entry, and mounts it into the matching slot.

## Authorization Integration

Widget placement and configuration are authorized as normal resource operations on the content page (see `modules/content-pages.json` — `ContentPages.WidgetInstanceAdded`). Widgets themselves do not authorize — they only consume the principal passed through `context`. Capability invocations may trigger new authorization checks on the host side (e.g. `backend.query` still passes through ingress authz).

## Tenancy Integration

- A widget's `widgetId` is platform-global — multiple tenants use the same widget source from the same bundle.
- A widget's `config` and `instanceId` are tenant-scoped, stored as part of the containing page.
- Widgets see only the tenant that loaded them via `context.tenantId`. No cross-tenant leakage is possible because every capability call re-binds to the host's tenant context.

## Observability

The host MUST emit telemetry for:
- Widget mount and unmount (with `widgetId`, `instanceId`, `correlationId`, elapsed ms)
- Widget error (mount failure, render exception, capability denial, topic violation)
- Capability invocation (capability name, duration, outcome)

Widget code SHOULD route application-level logging through `context.log` rather than `console.*` so the host can correlate it to the mount.

## Invariants

- **INV-WIDGET-01**: A widget manifest MUST declare `widgetId`, `version`, `displayName`, `configSchema`, and `isolation`.
- **INV-WIDGET-02**: A widget MUST NOT publish or subscribe to a topic not declared in its manifest.
- **INV-WIDGET-03**: A widget MUST NOT invoke a capability not declared in its manifest.
- **INV-WIDGET-04**: Cross-widget communication MUST pass through the host's mediator; direct element references or shared globals are prohibited.
- **INV-WIDGET-05**: Mediator dispatch MUST be asynchronous regardless of isolation mode.
- **INV-WIDGET-06**: Widget `config` MUST validate against the schema identified by `manifest.configSchema` before the widget is mounted.
- **INV-WIDGET-07**: A widget mount failure MUST NOT unmount sibling widgets in the same host.
- **INV-WIDGET-08**: A widget running under `isolation: iframe` MUST NOT be granted `allow-same-origin`.
- **INV-WIDGET-09**: `context.config`, `context.principal`, and all mediator payloads MUST be JSON-serializable.
- **INV-WIDGET-10**: `widgetId` referenced by a page layout MUST be present in the active bundle's `provides.widgets` list.

## Open Questions

- Should widgets support partial config updates, or only whole-config replacement on `onConfigChange`?
- Does the mediator support wildcard subscriptions (e.g. `page.*`)? Current design says no — declare explicitly.
- Should the manifest declare a minimum host version, parallel to `platformCompatibility` on UI bundles?
- How does a widget declare required permissions on the principal (e.g. "only renders for users with `Content.Announcement.Read`")? Current design: the host decides whether to mount based on the capabilities' authz, not the widget. Revisit if we find use cases that don't fit.
- Is there a "preview mode" where a widget receives a fake principal + sandboxed capabilities for the admin's configuration UI? (Likely yes — track as a separate surface.)
