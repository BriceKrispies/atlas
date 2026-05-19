# Atlas Runtime

Atlas, named for what it is.

This document is the concept paper. The dense material — the instruction set, the kernel/data inventory, the always-on lifecycle — lives in sibling docs and is cross-referenced from here. Read this first if you want the framing; read the siblings when you need the mechanics.

---

## § What Atlas is

Atlas is a multi-tenant platform fabric implemented as a governed application runtime — an application VM. A tenant submits a **program** (intents, schemas, policies, workflows, functions, surfaces, deployments, storage declarations) and the runtime executes it. Every step the runtime takes is the same shape regardless of which tenant submitted the program: an **instruction** is decoded from a tenant intent, authorization is checked, idempotency is asserted, quota is debited, the matching handler runs, an event is appended, projections advance, and a reply is materialized. The runtime is the small trusted core that performs this loop; the program is the data the runtime executes against. See [`vision.md`](../vision.md) for the user-facing pitch; this document names what kind of system delivers that pitch.

---

## § The tenant program model

A tenant program is composed of declarations and code. All of it is data submitted through Atlas's single ingress (Invariant I1); none of it requires a kernel rebuild. The pieces, with their canonical lexicon entries:

- **Intents** — the unit of tenant-initiated change. The runtime decodes an intent into an action and dispatches. See [`LEXICON.md` §Intent](../LEXICON.md).
- **Actions** — the declared verbs a module exposes. The runtime refuses any verb not in the registry. See [`LEXICON.md` §Action](../LEXICON.md).
- **Schemas** — the tenant-defined data model. Entity types, fields, and relations live in the tenant's per-tenant Postgres schema. See [`LEXICON.md` §CustomSchema](../LEXICON.md) and §ObjectType.
- **Policies** — authorization rules evaluated before any side effect (Invariants I2, I4). Per-tenant Cedar bundles loaded hot, no restart.
- **Workflows** — orchestrations of actions, scheduled or event-triggered. Declarative substrate distinct from tenant code per [ADR 0007](../decisions/0007-dsl-substrate-and-authoring-contract.md).
- **Functions** — tenant-authored code that fires on events, schedules, or HTTP. Sandboxed per [ADR 0006](../decisions/0006-function-runtime-substrate.md). See [`LEXICON.md` §TenantFunction](../LEXICON.md).
- **Surfaces** — machine-readable UI views. Every surface declares its state so an agent (or a test) can read it without scraping pixels. See [`LEXICON.md` §MachineReadableSurface](../LEXICON.md).
- **Deployments** — the runtime workloads a tenant provisions (containers, ingress, DNS). Wraps k3s + Caddy + Hetzner; the multi-tenant chassis is what Atlas adds on top.
- **Storage declarations** — object / block / secret stores requested by the tenant and provisioned inside the tenant's isolation boundary.

Each piece is **declared as data** (a row, a manifest, a bundle, a function artifact) and **executed through the runtime** (the ingress pipeline, the dispatcher chain, the projection loop). Tenants do not patch Atlas to add a schema; they `POST` an intent. The runtime is not extended by tenants; it is *configured* by them. Resource bounds are enforced per-tenant by quota (see [`LEXICON.md` §Quota](../LEXICON.md)).

---

## § The runtime boundary

Atlas distinguishes three execution categories. The table is reproduced verbatim from [`architecture.md` §"Tenant declarations vs tenant code"](../architecture.md):

| Category | Authored by | Executes in | Boundary |
|---|---|---|---|
| **Platform code** | Atlas maintainers | `apps/server`, `apps/projection-worker`, adapters | hexagonal layering |
| **Tenant declarations** | Tenants (DSL artifacts: templates, queries, formulas, validations) | `apps/server` via platform DSL evaluator | ADR 0007 §2 contract |
| **Tenant code** | Tenants (`functions`) | `FunctionRuntime` adapter, out-of-process | I14, I15 |

In plain language: **tenant code never executes in `apps/server`**. Per I14, tenant-authored functions run only through the `FunctionRuntime` port whose adapter is out-of-process (gVisor-backed k8s Jobs in MVP). Per I15, every outbound network call from tenant code traverses the egress port, audited and quota-debited. Tenant declarations *do* execute in-process — that is the carve [ADR 0007](../decisions/0007-dsl-substrate-and-authoring-contract.md) §2 makes — because their substrate contract guarantees boundedness, determinism, and no ambient I/O. A DSL that cannot satisfy that contract is tenant code by definition and goes through `FunctionRuntime`.

The hexagon is how the runtime admits new substrate without weakening these invariants: unsafe or hot-path behavior can be **extracted behind ports/adapters**, with the port surface enforced by typecheck and the adapter contract enforced by `packages/contract-tests`. Adding a new tenant runtime (V8 isolates, Firecracker, WASM host) is an adapter swap, not a kernel rewrite. The boundary is the port; the substrate is replaceable.

---

## § Kernel and data — pointer

The runtime has a small **kernel** (the ingress pipeline shape, the event-log append, the projection-rebuild loop, the port type surface, the HTTP bootstrap) and a large **data plane** (Cedar policies, tenant schemas, tenant functions, DSL artifacts, log levels, custom-domain mappings, the idempotency store, cache contents). A change asks first *"could this have been data?"* — if yes, default to data; if no, the kernel carve must justify why. The full inventory of which surface is kernel and which is data lives in [`./kernel-vs-data.md`](./kernel-vs-data.md). The operational hot-reload contract — lifecycle, request-boundary atomicity, invariant preservation across reload, multi-replica coordination — lives in [`./always-on.md`](./always-on.md). This document does not restate either.

The point of naming the runtime is to make the kernel small *on purpose*. Not everything becomes data; **kernel code remains small, trusted, and restart-required**. The discipline is not "minimize the kernel at all costs" but "any growth of the kernel is a deliberate carve recorded in [`./always-on.md` §2](./always-on.md), not an accident." Tenant programs change all the time; the runtime that executes them does not.

---

## § Relationship to Atlas-on-Atlas

Atlas Runtime is the *what*. [ADR 0008](../decisions/0008-atlas-on-atlas.md) — Atlas-on-Atlas — is the *consequence*. Because the runtime admits tenant programs uniformly, the platform's own admin operations are themselves a program submitted by the `_platform` tenant. There is no privileged platform layer that bypasses the chassis; the chassis governs Atlas's own behaviour with the same machinery it governs any other tenant's.

The recursive-kernel principle from ADR 0008 §"What stays code, what becomes data" answers the same question this document frames: the runtime is the kernel, and the kernel is small by design. Tenant declarations, policies, schemas, and (in time) module wiring are data the runtime executes. The operational contract for changing data while the runtime stays up — what's hot, what's restart-required, how a reload preserves invariants — is the always-on contract at [`./always-on.md`](./always-on.md). ADR 0008 records *why* the platform is a tenant; this document records *what kind of system* makes that statement coherent.

---

## § Invariants preserved

This doc adds framing, not new normative rules; every invariant stands. The canonical definitions live in [`architecture.md`](../architecture.md); the one-liners below exist so the runtime framing can be read without context-switching.

- **I1** — Single Ingress Enforcement: every request enters through exactly one chokepoint (see [architecture.md §I1](../architecture.md)).
- **I2** — Authorization Precedes Execution: no side effects on denied requests (see [architecture.md §I2](../architecture.md)).
- **I3** — Idempotency Before Execution: dedup before handler dispatch (see [architecture.md §I3](../architecture.md)).
- **I4** — Deny-Overrides-Allow Authorization: any deny wins (see [architecture.md §I4](../architecture.md)).
- **I5** — Correlation Propagation: `correlationId` flows through the entire request (see [architecture.md §I5](../architecture.md)).
- **I6** — Causation Linkage: events name the event or intent that caused them (see [architecture.md §I6](../architecture.md)).
- **I7** — Tenant Isolation in Search: `tenantId` always in scope (see [architecture.md §I7](../architecture.md)).
- **I8** — Permission-Filtered Search: results respect the caller's authz (see [architecture.md §I8](../architecture.md)).
- **I9** — Cache Keys Include TenantId: unless explicitly PUBLIC (see [architecture.md §I9](../architecture.md)).
- **I10** — Event-Driven Cache Invalidation: tag-based, not TTL (see [architecture.md §I10](../architecture.md)).
- **I11** — Deterministic Time Bucketing: analytics windows are reproducible (see [architecture.md §I11](../architecture.md)).
- **I12** — Projections Are Rebuildable: from event history alone (see [architecture.md §I12](../architecture.md)).
- **I13** — Quota Enforcement Precedes Execution: over-budget tenants rejected before side effects (see [architecture.md §I13](../architecture.md)).
- **I14** — Tenant Code Isolation: tenant functions run only via `FunctionRuntime`, out-of-process (see [architecture.md §I14](../architecture.md)).
- **I15** — Egress Mediation: outbound calls from tenant code traverse the egress port (see [architecture.md §I15](../architecture.md)).
- **I16** — Schema-Mutation Scope: tenant DDL confined to the issuing tenant's schema, DDL allowlist (see [architecture.md §I16](../architecture.md)).
- **I17** — API / CLI / UI Parity: every action reachable from every surface (see [architecture.md §I17](../architecture.md)).
- **I18** — Surface State Machine-Readability: every surface exposes its state for agents and tests (see [architecture.md §I18](../architecture.md)).

---

## § Reading order

Newcomers, in order:

1. [`vision.md`](../vision.md) — what Atlas is for and who it's for.
2. [`./atlas-runtime.md`](./atlas-runtime.md) — this document; the runtime framing.
3. [`./runtime-instruction-set.md`](./runtime-instruction-set.md) — the instructions the runtime executes and the ports that carry them.
4. [`./kernel-vs-data.md`](./kernel-vs-data.md) — the per-surface inventory of what is kernel and what is data.
5. [`../architecture.md`](../architecture.md) — principles P1–P6 and the canonical invariant definitions I1–I18.
6. [`../decisions/0008-atlas-on-atlas.md`](../decisions/0008-atlas-on-atlas.md) — the recursive-kernel principle and its staged path.
7. [`./always-on.md`](./always-on.md) — the operational contract for changing data while the runtime stays up.
