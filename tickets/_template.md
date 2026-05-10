---
title: <one-line title>
status: open
type: capability                 # capability | refactor | test | spec | adr | drift-finding | chore
owner: <agent-type | platform-owner | user>
phase: 0                         # 0=scope, 1=impl, 2=sdet, 3=architect, 4=security, 5=merge
capability:                      # path to capability spec, or omit
adr:                             # path to ADR, or omit
vision: []
invariants: []
blocks: []                       # ticket paths (e.g., seeder/phase-1.4-adapter-seed-memory)
blocked_by: []                   # ticket paths (e.g., chore/commit-untracked-deliverables)
files_in_scope: []
acceptance: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## Why

<one paragraph: vision tenet / ADR / capability ref / drift finding citation>

## Scope

<what the agent does — and explicitly what's out of scope>

## Resume prompt

```
<verbatim prompt the dispatcher hands the agent. Self-contained.>
```

## Notes / log

- YYYY-MM-DD: created
