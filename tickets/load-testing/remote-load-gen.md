---
title: Remote / distributed load generation
status: open
type: test
owner: user
phase: 0
vision: []
invariants: []
blocks: []
blocked_by: [load-testing/multi-tenant-seeding]
files_in_scope:
  - infra/load/
  - tests/load/k6/remote.md
acceptance:
  - "A documented procedure exists for running k6 from a Hetzner box against a deployed Atlas instance"
  - "k6 output flows back to a central place (Grafana Cloud k6 / S3 / local pull)"
  - "Procedure covers: provisioning, running, tearing down, cost"
created: 2026-05-12
updated: 2026-05-12
---

## Why

Local-machine load tests lie about network latency, kernel TCP tuning,
and the gap between load-gen and server (which is normally tens of ms,
not microseconds). To verify the real production throughput / latency
numbers, the load tester needs to run from a box co-located with the
target — typically a Hetzner instance in the same region as the
deployed Atlas. This is the test that matters once the local
optimisations stop moving the needle.

## Scope

- Provisioning script / doc for a small Hetzner box (or AWS/GCP equivalent)
  with k6 pre-installed.
- A `tests/load/k6/remote.md` runbook: "from cold, how do I produce a load
  report against the public reference instance?"
- Storage / retrieval of the run output. Grafana Cloud k6 is the easy
  answer but adds a vendor; consider S3 + a parse script as the
  no-vendor alternative.
- Cost note — k6 distributed runs can rack up bandwidth bills fast.

## Resume prompt

```
Produce a runbook for executing the k6 steady-state and burst scenarios
from a remote box against a deployed Atlas instance. Pick the simplest
shape that works (probably: one ad-hoc Hetzner CPX21 + a Terraform/Pulumi
fragment OR a documented manual provision). Cover: provisioning,
runtime (single command), output retrieval, tear-down, cost. Land it
under infra/load/ and link from tests/load/k6/README.md. Out of scope:
fully-managed k6 cloud unless that turns out cheaper.
```

## Notes / log

- 2026-05-12: created. Blocked by multi-tenant seeding because the most
  interesting remote-load runs use multi-tenant workloads.
