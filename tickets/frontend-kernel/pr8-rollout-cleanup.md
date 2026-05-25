---
title: Roll out web-bff to authoring/sandbox + cleanup (retire admin-spa.ts, delete dead api-client transport, ratchet waivers, doc edits)
status: scoped
type: refactor
owner: frontend-dev
phase: 1
adr: specs/decisions/0017-two-kernel-frontend-architecture.md
invariants: [I1]
blocks: []
blocked_by: [frontend-kernel/pr7-admin-pilot]
files_in_scope: [apps/authoring/src, apps/sandbox/src, apps/server/src/routes/admin-spa.ts, packages/api-client/src, apps/CLAUDE.md, apps/server/CLAUDE.md, packages/CLAUDE.md, specs/architecture.md]
acceptance:
  - "authoring + sandbox load+work via web-bff (sim stays direct/in-browser — it's the IndexedDB closed-loop harness, no BFF)"
  - "apps/server/src/routes/admin-spa.ts retired; dead api-client direct-mode transport + web-kernel direct-mode wrapIntent deleted"
  - "rings.json waivers ratcheted to zero; arch:check PASS; deps:check 0 errors; full pnpm test green for affected packages"
  - "I1 canonical text updated: architecture.md + root CLAUDE.md + apps/CLAUDE.md + apps/server/CLAUDE.md reworded to 'single DOMAIN ingress' with the bff-ring edge carve-out (ADR 0017 §4)"
created: 2026-05-25
updated: 2026-05-25
---

## Why

ADR 0017 / plan PR8: finish the migration and pay down the transition debt — the dual SPA-serving path, the client-side direct-mode envelope duplication, and the deferred canonical-invariant-text edits. This is also where the I1 prose across the repo is finally reconciled with the ADR's reinterpretation (ADR 0017 §4 listed those edits as deferred-until-rings-land).

## Scope

Repoint authoring + sandbox through web-bff (sim stays direct). Retire `admin-spa.ts`. Delete the dead direct-mode transport in api-client and the direct-mode `wrapIntent` copy in web-kernel (the BFF owns the canonical one). Reword the canonical I1 statement (architecture.md, root CLAUDE.md, apps/CLAUDE.md "adding another HTTP-exposing app violates I1", apps/server/CLAUDE.md) to "single DOMAIN ingress = apps/server; an edge proxy in the `bff` ring holding no domain code is the sanctioned exception". Update packages/CLAUDE.md dep-graph + apps/CLAUDE.md inventory. Decide (with the user / architect) whether the bff-ring no-domain rule earns its own invariant ID — ADR 0017 §"Out of scope" left this open.

## Resume prompt

```
PR8 of ADR 0017 (final). 1) Repoint apps/authoring + apps/sandbox through web-bff like admin (PR7); leave apps/sim on direct/in-browser mode (IndexedDB harness). 2) Retire apps/server/src/routes/admin-spa.ts (and its main.ts mount). 3) Delete the dead direct-mode transport path in @atlas/api-client and the direct-mode wrapIntent copy in @atlas/web-kernel (BFF is canonical). 4) Ratchet any frontend-kernel waivers in architecture/rings.json to zero. 5) Reword the canonical I1 text in specs/architecture.md, root CLAUDE.md, apps/CLAUDE.md, apps/server/CLAUDE.md to "single DOMAIN ingress" + the bff-ring edge carve-out (ADR 0017 §4); update packages/CLAUDE.md + apps/CLAUDE.md inventories. 6) Raise with the user/architect whether to mint a new invariant ID for the bff-ring no-domain rule. Verify: arch:check PASS 0 waivers, deps:check 0 errors, full atlas-test green for affected, admin/authoring/sandbox BDD green via bff. Commit on main + push.
```

## Notes / log

- 2026-05-25: created, scoped. Blocked by PR7.
