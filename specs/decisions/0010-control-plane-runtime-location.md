# 0010 — Control-plane runtime location

**Status:** Proposed (2026-05-11)
**Relates to:** [`0008-atlas-on-atlas.md`](0008-atlas-on-atlas.md) (recursive-kernel principle), [`0009-cluster-topology-and-tenant-isolation.md`](0009-cluster-topology-and-tenant-isolation.md) (hybrid sandbox + dedicated-cluster-per-tenant topology).

## Context

[ADR 0009](0009-cluster-topology-and-tenant-isolation.md) commits to a hybrid topology: a shared sandbox cluster for free tenants, a dedicated k3s cluster per upgraded tenant, and (per the recursive-kernel principle in [ADR 0008](0008-atlas-on-atlas.md)) a dedicated **platform cluster** for Atlas itself. The platform cluster is the same *shape* as any upgraded tenant's dedicated cluster — own VMs, own k3s control plane, own network, same baseline NetworkPolicy + PSS + ResourceQuota on `tenant-_platform` — just running platform workloads.

This ADR fixes the runtime *location* of Atlas's control plane: in the platform cluster, and what that means concretely for steady state, bootstrap, and break-glass.

## Decision

### 1. Steady state: Atlas runs in the platform cluster

In production steady state, Atlas's control plane runs **inside the platform cluster**, in the `tenant-_platform` namespace, governed by the same NetworkPolicy + PodSecurityStandards + ResourceQuota baseline as any tenant ([ADR 0009](0009-cluster-topology-and-tenant-isolation.md) §4). Concretely:

- `apps/server` runs as a Deployment in `tenant-_platform`. Single replica for MVP; multi-replica + cache-invalidation-across-replicas tracked separately ([ADR 0008](0008-atlas-on-atlas.md) "out of scope").
- `apps/projection-worker` runs as a Deployment in `tenant-_platform`. Single replica for MVP; leader-election tracked separately.
- Postgres (control-plane DB + per-tenant DBs of *every tenant*, sandbox and dedicated alike) runs as a StatefulSet in `tenant-_platform`, with a `PersistentVolumeClaim` per database. Phase 1 acceptable using k3s `local-path` provisioner (single-node only); Phase 2's `block-storage` capability defines durable PV provisioning.
- Caddy for `tenant-_platform`'s hostnames (admin/api surfaces) runs in the platform cluster.
- Caddy for tenant workloads runs in *their* cluster — the sandbox cluster handles all sandbox tenants' Caddy routes; each dedicated cluster has its own Caddy.

The control plane gets credentials to remote clusters (sandbox + each dedicated tenant cluster) via the `secret-store` port — kubeconfig per cluster, stored as sealed secrets, lookup keyed by `clusterId`. The `cluster-orchestrator` port adapter (`adapters/k8s/`) holds a registry of cluster handles and dispatches calls to the right API.

The control plane's *own* k8s API access (within the platform cluster) uses a `ServiceAccount` in `tenant-_platform` with cluster-scoped RBAC restricted to platform-cluster operations (the platform-cluster Caddy DaemonSet, Postgres StatefulSet, etc.).

### 2. Per-tenant data lives in `tenant-_platform`'s Postgres, not in the tenant cluster

A clarifying point: **tenant data (events, projections, repository bytes) lives in Atlas's Postgres in the platform cluster, not inside the tenant's own cluster.** Tenant clusters are *workload* substrate — they run the tenant's containers — not *data* substrate. Atlas's per-tenant DB layout (schema-per-tenant per [ADR 0005](0005-custom-schema-storage-strategy.md)) lives in one Postgres in the platform cluster, serving all tenants.

The implication: a tenant's dedicated cluster going down does not lose their data. It also means Atlas's `_platform` Postgres is the central reliability concern; HA Postgres is a Phase 2+ priority.

This is a deliberate split. Tenants get dedicated cluster *workloads* without dedicated DB. Phase 5+ may offer "BYO database" as a separate capability for tenants who need it; this ADR doesn't pre-decide it.

### 3. Bootstrap: out-of-cluster, one-shot, provisions everything

The chicken-and-egg (Atlas needs its cluster to exist before it can boot) is solved by a **one-shot operator bootstrap path** that runs from the operator's laptop or a CI runner. The bootstrap path is explicitly not the steady-state runtime:

`atlasctl operator init` (Phase A surface, capability spec lives in `crosscut/atlasctl.md` extension):

1. Reads operator config (Hetzner credentials via the `secret-store` adapter; cluster sizing; instance domain like `atlas.example.com`).
2. Provisions the **platform cluster** — Hetzner VMs + k3s install + baseline manifests for `tenant-_platform`.
3. Provisions the **sandbox cluster** — Hetzner VMs + k3s install + baseline configuration. Registers it as a cluster handle for Atlas to use once Atlas is up.
4. Deploys Atlas's manifests into the platform cluster (server, worker, Postgres, platform-cluster Caddy).
5. Runs the Atlas-on-Atlas Stage 2 bootstrap (per the existing scoped ticket): seeds the `_platform` row in `control_plane.tenants` with `clusterAffinity: "_platform"`, mints the `PlatformRobotPrincipal`, registers the platform cluster and the sandbox cluster in the `ClusterStore`.
6. Hands off — from this point, all further changes flow through the running Atlas (`atlasctl` talks to the server, not directly to clusters).

The bootstrap is the minimum needed to escape the cold-start. It is not how operators run upgrades, scale Atlas, register new dedicated tenant clusters (those go through `compute/cluster` capability operations), or recover from incidents — those flow through the running Atlas.

### 4. Per-tenant dedicated cluster provisioning is *not* bootstrap

When a tenant upgrades (`Tenancy.UpgradeToDedicated` per [ADR 0009](0009-cluster-topology-and-tenant-isolation.md) §6), Atlas itself — already running in the platform cluster — provisions the tenant's dedicated cluster via the `CloudCompute` and `cluster-orchestrator` ports. This is steady-state runtime, audited, idempotent, observable. **No operator hands required for tenant upgrades; the platform handles its tenants.**

Tenant cluster provisioning is multi-step, asynchronous, and partially failable (Hetzner can run out of capacity, k3s install can fail, network can be slow). The upgrade capability spec (Wave 2) defines the state machine and retry/rollback semantics; this ADR commits only that the entry point is an in-platform-cluster Atlas, not an out-of-band operator script.

### 5. Break-glass fallback

When the in-cluster Atlas is itself broken (server crash-looping, platform-cluster DB unreachable, etc.), operators have a documented `kubectl` fallback against the **platform cluster's** k8s API. This is a runbook escape hatch, not a normal path. It bypasses Atlas's audit trail by definition; the audit gap is acceptable because:

- The operator is acting *as* the platform, not *as* a tenant.
- The gap is rare and operator-attested.

The break-glass exception applies only to the platform cluster. **There is no break-glass into a tenant's dedicated cluster.** Atlas is the only party with credentials to tenant cluster k8s APIs; if Atlas can't reach a tenant cluster, the resolution is to fix Atlas, not to side-door into the tenant's cluster. The only exception: if a tenant's cluster has to be force-decommissioned (cost runaway, tenant offboarding), the operator can delete the underlying Hetzner VMs directly through Hetzner's UI / API — but that's destroying substrate, not reaching into running tenant workloads.

### 6. Multi-replica + leader-election deferred

Phase 1 ships single-replica `apps/server` and single-replica `apps/projection-worker`. Multi-replica server (cache invalidation across replicas, sticky-sessionless ingress) and leader-elected projection-worker are tracked as a separate slice — the `state.ts:159` self-acknowledged debt and ADR 0008's "out of scope" item. This ADR locks the *runtime location*; it does not commit a replica count.

### 7. What's NOT decided here

- **Where the sandbox cluster runs.** [ADR 0009](0009-cluster-topology-and-tenant-isolation.md) commits that a sandbox cluster exists; provisioning it on Hetzner (or anywhere) is operator-side at bootstrap.
- **How tenant cluster provisioning fails or rolls back.** Capability spec for `tenancy/upgrade-to-dedicated` (Wave 2 or a follow-up).
- **Self-hoster upgrade story for Atlas itself.** Rolling deployment within the platform cluster, blue/green, etc., is a Phase 1 polish item; the *location* (in the platform cluster) is what this ADR fixes.
- **Postgres HA shape.** Phase 1 single-node-acceptable; Phase 2's `block-storage` + a dedicated capability define HA Postgres.
- **Hot-reload of Atlas code.** [ADR 0008](0008-atlas-on-atlas.md) "out of scope"; `crosscut/always-on.md` (future) sets the bar.

## What becomes invalid if this is reversed

- **Out-of-cluster steady-state weakens [ADR 0008](0008-atlas-on-atlas.md).** The platform is no longer "shaped like a tenant" at the runtime layer — it runs on VMs while every tenant runs in k3s. The recursive-kernel principle becomes a spec-level claim only.
- **Out-of-cluster steady-state breaks operator-experience symmetry.** Operators learn two ops models (k3s for tenants + VM/systemd for the platform). Adding capacity, restarting, scaling all bifurcate.
- **Reversing later (in → out)** would mean every operator who deployed Atlas needs a migration runbook to extract the control plane from the platform cluster onto separate hosts.
- **Reversing later (out → in)** would be easier (additive: deploy Atlas into the cluster it already manages), but the ADR-0008 narrative weakens during the gap.
- **If tenant data ever moves into tenant clusters** (e.g., per-tenant Postgres in each dedicated cluster): a tenant cluster outage now also means a tenant data outage. The current model (data centrally in `tenant-_platform`, workloads in tenant cluster) keeps the blast radii separate.

## Consequences

**Positive:**

- **Atlas-on-Atlas runs, not just claims.** The platform's deployment shape matches an upgraded tenant's shape at the runtime layer.
- **One ops model.** k3s + Atlas's tenant primitives, applied to the platform cluster the same as any tenant cluster.
- **Symmetric resource accounting.** `tenant-_platform`'s ResourceQuota shows up alongside every tenant's.
- **Adapter portable.** When the cluster substrate changes (k3s → full k8s, Hetzner → AWS), the platform cluster migrates with the cluster fleet; no separate migration of control-plane hosts.
- **Tenant cluster lifecycle is Atlas-driven, not operator-driven.** Once bootstrap is done, dedicated cluster provisioning is a runtime audited operation.

**Negative:**

- **Bootstrap complexity grows.** `atlasctl operator init` now provisions *two* clusters (platform + sandbox), deploys Atlas into one, and registers both. More moving parts than a single-cluster bootstrap.
- **Cluster-ate-its-own-tail risk for the platform cluster.** When the platform cluster's k8s API is down, Atlas can't talk to it. Mitigated by the documented break-glass `kubectl` path.
- **In-cluster Postgres on `local-path` for MVP.** Single-node-only until `block-storage` lands; multi-node-from-day-one self-hosters need to BYO PV CSI or wait for Phase 2.
- **Central Postgres is a central reliability concern.** A platform-cluster Postgres outage takes every tenant's writes offline; durability + HA become a high-priority Phase 2 area.
- **Restart blast radius for the platform cluster** is real. A platform-cluster crash means tenant deploys/queries fail. Tenant *running workloads* keep running (they're in tenant clusters; the platform cluster is the control plane, not the data plane for traffic).

## Migration

This ADR is spec-only. Concrete follow-ups:

1. **Wave 2** — `compute/runtime` capability spec defines the cluster-orchestrator port (multi-cluster, per [ADR 0009](0009-cluster-topology-and-tenant-isolation.md) §8) and the `tenant-_platform` Deployment shape inside the platform cluster. `compute/ingress` defines Caddy-as-DaemonSet wiring per cluster (one Caddy per cluster, not one Caddy total).
2. **Wave 2 / Phase 1 implementation** — `infra/k8s/` (currently a placeholder per `PROGRESS.md`) gets the platform-cluster Atlas manifests (server, worker, Postgres StatefulSet, Caddy DaemonSet, SA + ClusterRole + RoleBinding for in-cluster k8s API access) plus the sandbox-cluster baseline manifests.
3. **`atlasctl operator init`** capability spec extension to `crosscut/atlasctl.md` (Phase A) lands as a Wave 2 ticket. Provisions platform cluster + sandbox cluster + Atlas bootstrap + ClusterStore seed.
4. **Break-glass runbook** (`docs/operations/break-glass.md` — net-new) lands with the first platform-cluster Atlas deploy.

No code changes in this PR.
