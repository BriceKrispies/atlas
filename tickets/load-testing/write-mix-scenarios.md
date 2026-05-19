---
title: Mixed read/write/authz workload scenarios
status: open
type: test
owner: module-dev
phase: 0
vision: []
invariants: [I3, I10, I12]
blocks: []
blocked_by: []
files_in_scope:
  - tests/load/k6/lib/intent.js
  - tests/load/k6/mixed-workload.js
  - .claude/gambler/bets/lib/intents.ts
acceptance:
  - "Intent factory exposes read / page-create / policy-evaluate shapes"
  - "Mixed scenario runs with --mix=80/15/5 (read/write/authz) and reports per-intent-type p99"
  - "Write scenarios produce real events the projection chain processes (verifiable via /events SSE)"
created: 2026-05-12
updated: 2026-05-12
---

## Why

Current load scenarios fire only `ContentPages.Page.Read` — cheap, no
events emitted, fall-through generic path. Real production traffic
includes writes (page-create, policy-activate) that exercise event
append + dispatcher chain + cache-tag invalidation, plus authz flows
that hit the policy bundle. Read-only load understates the saturation
point and hides write-side bottlenecks entirely.

## Scope

- Extend `tests/load/k6/lib/intent.js` and `.claude/gambler/bets/lib/intents.ts`
  with factories for `ContentPages.Page.Create`, `Authz.Policy.Evaluate`
  (or whatever the canonical authz-only intent is), and `ContentPages.Page.Update`.
- New scenario `tests/load/k6/mixed-workload.js`: weighted random pick
  between intent kinds (read 80%, write 15%, authz 5% by default).
- Report per-intent-type p99 / error rate so a regression in the write
  path doesn't get smoothed into the read-heavy aggregate.

## Resume prompt

```
Build mixed-workload scenarios. Step 1: extend the intent factories
(tests/load/k6/lib/intent.js + .claude/gambler/bets/lib/intents.ts) with
Create, Update, and one authz-only shape. Pull the schemas from
packages/schemas/src/generated/ — keep payloads minimal but
schema-valid. Step 2: tests/load/k6/mixed-workload.js with a weighted
selector and per-intent-type tagged metrics
(http_req_duration{intent_type=...}). Step 3: brief README addition
explaining the mix flag and why read-only load understates the ceiling.
```

## Notes / log

- 2026-05-12: created.
