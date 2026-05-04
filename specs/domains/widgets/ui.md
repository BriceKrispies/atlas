# UI Bundles

## Overview

A **UI Bundle** is a versioned, deployable artifact containing the compiled frontend code for an Atlas tenant interface. UI Bundles decouple the delivery of frontend code from the platform release cycle, allowing tenants to select which UI version is active for their users.

UI Bundles are **artifacts** (compiled code packages), not data. UI composition concerns—such as navigation structure, page layouts, widget configurations, and settings—remain as tenant-scoped data managed by the platform. A bundle provides the code that renders this data.

## What a UI Bundle Is

A UI Bundle provides:
- **Routes**: Compiled page components mapped to URL paths
- **Widgets**: Embeddable UI components for use in configurable surfaces — see `crosscut/widgets.md` for the widget contract, manifest, isolation modes, and mediator
- **Themes**: Visual styling (CSS, design tokens) for the tenant interface

A UI Bundle is:
- A build artifact produced by the frontend build pipeline
- Versioned using semantic versioning
- Immutable once published
- Validated against platform compatibility requirements

## What a UI Bundle Is NOT

A UI Bundle is NOT:
- Source code—only compiled/bundled output
- Tenant data or configuration—that remains in the database
- Navigation structure—nav is platform data, not bundle code
- Per-tenant customizations—bundles are shared artifacts

## Versioning and Compatibility

### Bundle Versioning

Bundles use semantic versioning (`MAJOR.MINOR.PATCH`):
- **MAJOR**: Breaking changes to routes, widgets, or theme contracts
- **MINOR**: New routes, widgets, or features (backward compatible)
- **PATCH**: Bug fixes and minor improvements

### Platform Compatibility

Each bundle declares a platform compatibility range specifying the minimum and maximum platform API versions it supports:

```
platformCompatibility: {
  minVersion: "1.2.0",
  maxVersion: "2.0.0"
}
```

The platform rejects bundle activation if the current platform version falls outside the declared range.

### Compatibility Constraints

- INV-UI-01: A bundle MUST declare its platformCompatibility range
- INV-UI-02: The platform MUST reject activation of a bundle incompatible with the current platform version
- INV-UI-03: A tenant MUST have exactly one active bundle at any time

## Tenant Selection Model

### Active Bundle

Each tenant has exactly one active UI bundle. The active bundle determines:
- Which frontend code is served to the tenant's users
- Which routes are available
- Which widgets can be rendered
- Which theme is applied

### Selection Authority

Bundle selection is a **control-plane / tenant-admin operation**:
- Only tenant administrators can change the active bundle
- Changes take effect on next page load (no live hot-swap within a session)
- The previous bundle remains available for rollback

### Selection Constraints

- INV-UI-04: Bundle selection MUST be authorized under `Platform.UIBundle.Select` action
- INV-UI-05: Bundle selection MUST be scoped to the tenant making the selection
- INV-UI-06: Selecting an unpublished or nonexistent bundle MUST fail with `RESOURCE_NOT_FOUND`

## Bundle Lifecycle

### States

A bundle progresses through these states:

1. **draft**: Under development, not deployable
2. **published**: Available for tenant selection
3. **deprecated**: Still functional but discouraged; tenants should migrate
4. **archived**: No longer selectable; existing selections remain active until changed

### Lifecycle Constraints

- INV-UI-07: Only `published` bundles MAY be selected as active
- INV-UI-08: A bundle in `archived` state MUST NOT be newly selected
- INV-UI-09: A tenant using an `archived` bundle continues to function until they select a different bundle

## Authorization Integration

### Actions

The following actions are registered for UI bundle management:

| Action | Resource | Description |
|--------|----------|-------------|
| `Platform.UIBundle.List` | UIBundle | List available bundles |
| `Platform.UIBundle.Read` | UIBundle | View bundle details |
| `Platform.UIBundle.Select` | UIBundle | Set active bundle for tenant |
| `Platform.UIBundle.Publish` | UIBundle | Publish a draft bundle |
| `Platform.UIBundle.Deprecate` | UIBundle | Mark bundle as deprecated |

### Policy Scope

- `Platform.UIBundle.Select` is typically restricted to tenant administrators
- `Platform.UIBundle.Publish` and `Platform.UIBundle.Deprecate` are control-plane operations

## Tenancy Integration

### Tenant Scoping

- Bundle definitions are **platform-global** (not tenant-scoped)—the same bundle can be used by multiple tenants
- Bundle **selection** (which bundle is active) is tenant-scoped
- Bundle **configuration data** (e.g., theme overrides if supported) would be tenant-scoped

### Tenant Isolation

- A tenant's bundle selection has no effect on other tenants
- Bundle selection changes are recorded in the tenant's audit log

## Observability

### Telemetry Context

UI Bundle identity is part of request context for observability:
- `ui_bundle_id`: The active bundle identifier
- `ui_bundle_version`: The active bundle version

These attributes appear in:
- Request logs from the UI
- Error reports
- Performance traces
- Analytics events

### Observability Constraints

- INV-UI-10: Telemetry from UI requests SHOULD include `ui_bundle_id` and `ui_bundle_version`
- The format and transport of telemetry is implementation-specific

## Integrity Metadata

Bundles MAY include integrity metadata for verification:

- **checksum**: Hash of bundle contents (e.g., SHA-256)
- **signature**: Cryptographic signature for provenance verification

Integrity validation is implementation-specific and not required for MVP.

## Open Questions

- What is the bundle storage mechanism? (S3, CDN, artifact registry?)
- How are bundles built and uploaded? (CI/CD integration)
- Are per-tenant theme overrides supported, or only bundle-level themes?
- Should there be a "preview" mode for testing bundles before activation?
- How does bundle activation interact with active user sessions? (cache invalidation)
- Is there a default/fallback bundle for new tenants?
- Should bundles support feature flags or gradual rollout?
