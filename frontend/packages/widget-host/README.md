# @atlas/widget-host

Runtime for the Atlas widget system: a `<widget-host>` custom element
that reads a page layout, resolves widgets from a registry, and mounts
them under a per-host mediator + capability bridge.

This package is the implementation surface for the contract defined in
[`specs/crosscut/widgets.md`](../../../specs/crosscut/widgets.md). That
spec — plus the JSON schemas under
[`specs/schemas/contracts/`](../../../specs/schemas/contracts) — is the
source of truth. Do not duplicate semantics here; read the spec first.

## Scope of this step

Implements:

- `WidgetRegistry` + module-default registry
- `WidgetMediator` with per-instance topic permissions and async dispatch
- `CapabilityBridge` with per-instance capability enforcement
- Inline and shadow host strategies
- `<widget-host>` element with layout validation and a per-mount error
  boundary
- Manifest + layout validators (ajv) against copies of the canonical
  schemas

Not implemented (Step 5):

- `iframe` isolation host + postMessage transport. The isolation switch
  in `host-element.js` throws `WidgetIsolationError` when a widget
  declares `isolation: iframe`, so only one code path changes in Step 5.

## Verification

`test/dry-run.mjs` spins up a `linkedom` DOM, registers a stub widget,
mounts it into a detached `<widget-host>`, and asserts publish,
subscribe, capability, and undeclared-topic behavior end-to-end.

```
pnpm install     # from the frontend/ root
pnpm --filter @atlas/widget-host dry-run
```

The script prints `OK` and exits 0 on success.

If `linkedom` custom-element behavior regresses in the future, the
fallback is to verify the same scenarios via sandbox specimens once
Step 4 adds them; leave the `dry-run` script intact and document the
deferral here.
