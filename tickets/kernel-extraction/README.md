# Kernel Extraction — set readme

This set is the backlog lane for the **Kernel Touch Retrospective** loop defined at [`specs/crosscut/always-on.md` §11](../../specs/crosscut/always-on.md#§11-kernel-touch-retrospective). Each ticket here is one of two things:

- A **retrospective** (`type: drift-finding`) — filed in the same PR as a kernel-surface change, naming the category that forced the touch, the missing seam, and a link to the extraction-plan ticket. Required by [I20](../../specs/architecture.md#i20-operator-feature-delivery-is-an-intent) and `always-on.md` §11.1.
- An **extraction plan** (`type: refactor` or `type: capability`) — the scoped follow-up whose acceptance bar reads: *"a change of category X lands as data, not as a kernel diff."* Linked from a retrospective; merging closes the category.

A retrospective without a linked extraction-plan ticket fails the architect gate. An extraction-plan ticket without a retrospective is allowed (some categories are scoped pre-emptively from `vision-keeper` audits).

## When to file in this set

File here, not in `chore/` or `drift-<month>/`, whenever the touch is to the kernel surface enumerated at `always-on.md` §2. File in `chore/` for non-kernel hygiene; file in a `drift-YYYY-MM/` set for vision-keeper / observability-architect audit findings that are not kernel-extraction shaped.

## Lifecycle

Retrospective tickets land as `status: scoped` (they record a decision already made; nothing to implement). Their `acceptance:` is procedural — five body fields filled, extraction-plan ticket linked — and they archive to `done` when the architect verifies in the same review that gated the kernel-touch PR.

Extraction-plan tickets follow the normal slice-workflow lifecycle (`scoped` → `in-flight` → `review` → `architect` → `done`). They archive when the next change of the named category demonstrably lands as data.

## Vision-keeper audit lane

The monthly `vision-keeper` drift audit reads this set looking for:

- Categories that recur three or more times across retrospectives without an extraction-plan ticket merging. Escalated as drift.
- Long-open extraction-plan tickets (>90 days `scoped` or `in-flight`). Escalated as scope-vs-velocity dishonesty.
- Retrospectives whose §5 "confidence" field claimed `closed` but whose category appears in a later retrospective. Escalated as self-contradiction.

See [`tickets/CLAUDE.md`](../CLAUDE.md) for the general ticket contract; this readme covers only what is specific to the kernel-extraction lane.
