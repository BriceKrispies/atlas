# Widgets

**Platform:** Content
**Status:** Active — content migrated from legacy locations.

## Purpose

Widget definitions, instances, configuration schemas. Tenant-facing concerns: which widgets exist, which a tenant has enabled, install/configure flows, marketplace-like UX, version pinning, capability grants.

The widget **runtime** (load, isolate, render) is platform plumbing in
`packages/widget-host/` — not part of this domain. This domain owns the *policy*
layer that the runtime mechanically respects.

## Capabilities

TBD. List capabilities here as they're scoped. Capabilities are the agent
ownership unit — one capability ≈ one agent.

Per-tenant code-splitting falls out naturally: at session boot, the runtime
fetches the tenant's enabled-widget manifest and dynamic-imports only those
bundles (`bundles/` is the code-split unit).

## Cross-references

- Package: `packages/widget-host/` (runtime), `packages/widgets/` (composite widgets), `packages/design/` (primitives)
- Spec: [./widgets.md](./widgets.md) — manifest, mediator, isolation modes, 10 invariants
- Spec: [./ui.md](./ui.md) — UI bundle system, 10 invariants
