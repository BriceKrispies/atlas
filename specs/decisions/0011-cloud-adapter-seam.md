# 0011 — Cloud adapter seam

**Status:** Proposed (2026-05-11)
**Relates to:** [`0002-developer-platform-domain-map.md`](0002-developer-platform-domain-map.md) (adapter-first wrapping), [`0009-cluster-topology-and-tenant-isolation.md`](0009-cluster-topology-and-tenant-isolation.md) (k3s + cluster-orchestrator port), [`0010-control-plane-runtime-location.md`](0010-control-plane-runtime-location.md) (in-cluster control plane). [`vision.md`](../vision.md) §"Wrapped components".

## Context

[`vision.md`](../vision.md) commits Atlas to **wrapping existing tools, not rebuilding them**. The wrapped-components table names Hetzner Cloud (compute nodes), Hetzner DNS, MinIO/Hetzner Object Storage, kaniko, k3s, Caddy, Gitea, sealed-secrets. Phase 1 needs Hetzner Cloud (cluster substrate) + Hetzner DNS (tenant subdomains).

Hexagonal layering (architecture I1 + the dep-cruiser rule in `modules/CLAUDE.md`) requires `modules/*` not to import `adapters/*`. Cloud SDK calls clearly belong in `adapters/*`. The genuine question is one level up: **does every cloud SDK call go through a `ports/*` interface from the first PR, or do we let early adapters call SDKs directly with a "we'll extract a port when a second cloud lands" promise?**

Two real positions:

1. **Adapter-first from PR 1 (mandatory port boundary).** Every cloud SDK call lives behind a port in `ports/src/`. The first implementation is `adapters/hetzner-cloud/`. The adapter contract is shaped by what Atlas needs, not by Hetzner's SDK surface.
2. **Hetzner-direct allowed in early adapters.** Adapters under `adapters/*` may import the Hetzner SDK directly, with a follow-up to extract a port when (and if) a second cloud is needed. Faster Phase 1; defers the abstraction cost.

The "adapter without a port" pattern already exists in tension form: `adapters/node/` wraps Postgres against ports (`ports/src/event-store.ts`, `ports/src/projection-store.ts`, etc.) — every database operation goes through a port. There is no `adapters/node/src/raw-pg-helpers.ts` that domain code can reach. The bar for cloud SDKs should match the bar for databases.

A nuance: YAGNI applies to the port's *breadth* (don't predict every cloud operation we'll ever need), not to its *existence* (every operation we *do* need is named in a port).

## Decision

### 1. Adapter-first, mandatory, from PR 1

Every cloud SDK call must live behind a port in `ports/src/`. Domain code (`modules/*`) calls the port. Adapters (`adapters/<provider>/*`) implement the port against the provider SDK. **There is no "import the Hetzner SDK from a module" path, ever.**

This applies to:

- Cloud compute (node provisioning, VM lifecycle).
- Cloud DNS (record CRUD).
- Cloud object storage (Phase 2; named here so the precedent is set).
- Any future cloud-managed service Atlas wraps.

It does **not** apply to:

- Tools that run *inside the cluster* and are reached via the k8s API (kaniko-as-Job, Caddy-as-DaemonSet, sealed-secrets-as-controller). Those go through the `cluster-orchestrator` port ([ADR 0009](0009-cluster-topology-and-tenant-isolation.md) §5), which is itself the seam. The k8s API client (`@kubernetes/client-node` or equivalent) is the SDK behind that port.
- The k3s install / node-bootstrap shell scripts that `atlasctl operator init` runs ([ADR 0010](0010-control-plane-runtime-location.md) §2). Bootstrap is operator-side and explicitly out of the steady-state code path.

### 2. Port surface is shaped by Atlas's needs, not the SDK

Each port exposes capability-shaped operations, not a thin SDK passthrough:

- `ports/src/cloud-compute.ts` — `CloudCompute` with operations Atlas actually performs: `provisionNode({ size, region, sshKey })`, `listNodes()`, `deleteNode(nodeId)`, `getNodeStatus(nodeId)`. NOT every `@hetzner/cloud-sdk` method.
- `ports/src/cloud-dns.ts` — `CloudDNS` with `upsertRecord({ zone, name, type, value, ttl })`, `deleteRecord({ zone, name, type })`, `listRecords(zone)`. NOT zone management, not soa records — those are operator-side, not Atlas-side.

When the second cloud's adapter is written and a need shows up that the port doesn't expose, the port *grows* — but the growth is owned by domain need, not by SDK availability.

### 3. One adapter per provider, naming convention

- `adapters/hetzner-cloud/` — implements `CloudCompute`. Wraps `@hetzner/cloud-sdk` (or the current Hetzner Node SDK). Lives alongside `adapters/node/` etc.
- `adapters/hetzner-dns/` — implements `CloudDNS`. Wraps the Hetzner DNS API (separate from Hetzner Cloud SDK).
- `adapters/k8s/` — implements `ClusterOrchestrator` ([ADR 0009](0009-cluster-topology-and-tenant-isolation.md) §5). Wraps `@kubernetes/client-node`.
- Future: `adapters/aws-ec2/`, `adapters/aws-route53/`, `adapters/cloudflare-dns/`, etc. Each one is a thin port implementation; none drag domain code along.

Adapter packages follow `adapters/CLAUDE.md` conventions: barrel export from `index.ts`, no cross-adapter imports, contract tests in `packages/contract-tests/`.

### 4. Contract tests are the regression net for adapter swaps

Each cloud port gets a contract-test suite in `packages/contract-tests/src/<port>.test.ts`. Both the real-provider adapter and an in-memory test-fixture adapter (`adapters/cloud-fixture/` or per-port) must pass identically.

- The fixture adapter is what tests run against (no real Hetzner calls in unit tests).
- The real adapter has a smoke-test pass run against a sandbox Hetzner project on a separate cadence (CI nightly or operator-triggered, not per-PR).
- A second real adapter (when added) is expected to pass the same contract suite without changes — that's the seam paying off.

### 5. Authentication / secrets handling

Cloud SDK credentials (Hetzner API tokens, etc.) live in the secret-store port (`ports/src/secret-store.ts`, lifted in [ADR 0008](0008-atlas-on-atlas.md) Stage 1). Adapters read credentials at construction via the secret-store, never from `process.env` directly. This keeps the secret-store as the single authority for "where credentials live" and makes per-tenant credential isolation straightforward when it's needed.

### 6. What's NOT decided here

- **Multi-region cloud accounts.** Phase 5+. Today: one region, one credential, one adapter instance.
- **Bring-your-own-cloud for self-hosters who aren't on Hetzner.** Operationally supported (the seam exists); concretely a different adapter package (e.g., `adapters/aws-ec2/`) someone has to write. Atlas ships Hetzner adapters by default; alternatives are community / commercial extensions.
- **Per-tenant cloud credentials.** Phase 1 is single-credential (Atlas operator's). Tenant-supplied cloud credentials (e.g., a tenant who wants their workload on their own AWS account) is a Phase 5+ capability and a different shape entirely.

## What becomes invalid if this is reversed

- **If a module ever imports a cloud SDK directly:** dep-cruiser / `pnpm deps:check` should reject it (the existing `modules/CLAUDE.md` rule already forbids `modules → adapters` imports; this ADR extends the spirit to `modules → cloud-SDK`). The boundary check fails.
- **If we let `adapters/*` skip the port entirely (e.g., a `hetzner-direct.ts` helper module domain code can call):** the contract-test seam disappears. The next-cloud extraction becomes a rewrite of every call site, not an adapter swap.
- **If the port shape mirrors the SDK 1:1:** adapter #2 doesn't fit; the port becomes Hetzner-shaped instead of Atlas-shaped. The remediation is then a port rewrite + every adapter rewrite — much bigger than the original "extract later" promise sounded.

Reversing the decision later (relaxing to "Hetzner-direct allowed") is technically possible but would violate the wrapping principle in [`vision.md`](../vision.md) and the hexagonal layering established in [ADR 0008](0008-atlas-on-atlas.md). The reversal cost increases with every domain that relies on the seam.

## Consequences

**Positive:**

- **Cloud-portability is a real property, not a marketing claim.** A self-hoster on AWS writes (or finds) `adapters/aws-ec2/`; nothing in `modules/*` changes.
- **Contract tests catch adapter regressions.** When the SDK ships a breaking change, the contract test fails — domain code is unaffected.
- **Per-tenant credential isolation is a future-easy add.** The secret-store port gates credential lookup; making it tenant-scoped is a focused change, not a refactor of every cloud call site.
- **Symmetry with the existing data-adapter pattern.** No special-casing for cloud calls vs database calls; one rule to learn.
- **Load-bearing for the topology in [ADR 0009](0009-cluster-topology-and-tenant-isolation.md).** Every `Tenancy.UpgradeToDedicated` triggers a Hetzner provisioning event; cluster lifecycle, autoscaling, and decommission all hit `CloudCompute`. The seam isolates that traffic from domain code and gives the contract test surface to catch regressions before they hit a tenant.

**Negative:**

- **Slight up-front cost per cloud capability.** Every Phase 1 cloud surface (compute provisioning, DNS records) ships a port + an adapter + a fixture adapter + a contract suite. Roughly 2–3 extra files vs "just call the SDK."
- **Port-shape decisions get made early.** The first port's operations are chosen with one provider in view; some shape adjustments are likely when adapter #2 lands. Mitigated by keeping ports narrow (capability-shaped, not SDK-shaped) and treating adjustments as expected, not as failures.
- **Bootstrap script exception.** `atlasctl operator init`'s shell-out to k3s install isn't behind a port (it's operator-side, one-shot). The exception is documented; the line between "operator-side bootstrap" and "Atlas-side runtime" is a small thing operators must learn.

## Migration

This ADR is spec-only. Concrete follow-ups:

1. **Wave 2** — `compute/cluster` (cluster-substrate provisioning), `compute/dns` capability specs reference `CloudCompute` and `CloudDNS` ports respectively. The port files (`ports/src/cloud-compute.ts`, `ports/src/cloud-dns.ts`) are drafted within those capability specs and land in implementation PRs.
2. **Phase 1 implementation** — net-new packages: `adapters/hetzner-cloud/` (implements `CloudCompute`), `adapters/hetzner-dns/` (implements `CloudDNS`), `adapters/k8s/` (implements `ClusterOrchestrator` from [ADR 0009](0009-cluster-topology-and-tenant-isolation.md) §5). Each ships with a contract-test suite under `packages/contract-tests/`.
3. **dep-cruiser** — extend the existing module-isolation rule to forbid `modules/*` from importing any package whose name matches `@hetzner/*`, `@aws-sdk/*`, or any future cloud-SDK pattern. Caught at `pnpm deps:check`.
4. **`atlasctl operator init`** is the documented exception (operator-side bootstrap; not Atlas runtime). Its scope is fixed: provision cluster + deploy Atlas + seed `_platform`. Anything beyond that flows through Atlas.

No code changes in this PR.
