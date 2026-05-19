---
title: Hour-long soak scenario for memory/pool drift
status: open
type: test
owner: module-dev
phase: 0
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - tests/load/k6/soak.js
  - .claude/gambler/bets/scenario-soak.ts
acceptance:
  - "k6 soak script runs 1h at 50 VUs and writes a JSON report"
  - "Reports tracked: max RSS, max event-loop lag, p99 over time (15min buckets), error count"
  - "README documents the metrics to inspect for memory leaks / pool drift"
created: 2026-05-12
updated: 2026-05-12
---

## Why

Steady-state and burst tests run 20s-2min and miss drift problems —
memory leaks, projection-store unbounded growth, log-pipeline
backpressure, connection-pool starvation that only manifests after
hours. A soak scenario catches these before production.

## Scope

- `tests/load/k6/soak.js`: 1h at 50 VUs (≈ 20k requests/min) against the
  default Read intent.
- Optional companion TS scenario `scenario-soak.ts` for iteration with
  shorter durations.
- Out of scope: the actual fixes for any drift surfaced; file follow-up
  tickets per finding.

## Resume prompt

```
Add tests/load/k6/soak.js: ramping-vus to 50 VUs over 30s, hold for 1h
(parameterise via SOAK_MINUTES env), ramp down 30s. Thresholds:
http_req_failed<0.01, http_req_duration p(99)<1000. Pull intent factory
from tests/load/k6/lib/intent.js. Print a per-15min summary using k6's
trend metrics. Update tests/load/k6/README.md with how to read drift
signals (compare bucket 0 vs bucket 3).
```

## Notes / log

- 2026-05-12: created.
