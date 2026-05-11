# 0009 — Cluster topology and tenant isolation

**Status:** Proposed (2026-05-11)
**Relates to:** [`0002-developer-platform-domain-map.md`](0002-developer-platform-domain-map.md) (Compute platform domains), [`0003-tenant-defined-data-model-pivot.md`](0003-tenant-defined-data-model-pivot.md) (open public signup, multi-tenant fabric), [`0004-platform-invariants-for-multi-tenant-fabric.md`](0004-platform-invariants-for-multi-tenant-fabric.md) (I13–I18), [`0008-atlas-on-atlas.md`](0008-atlas-on-atlas.md) (the platform is a tenant of itself).

## Context

Phase 1's MVP is `atlasctl push ./hello-world` → live URL. The first PR that touches `compute/cluster` or `compute/runtime` silently locks how Atlas hosts tenant workloads. Two pressures pull in opposite directions:

- **Strong tenant isolation.** Mutually-distrusting tenants on the same instance; quotas are load-bearing; the operator is not a fallback for isolation failures ([`vision.md`](../vision.md) §"Hosting model"). Namespace-only isolation gives no defense against kernel escapes, kernel-shared-state side channels, or noisy-neighbor at the node level.
- **Open public signup.** Anyone can sign up; idle tenants must cost approximately nothing, or the operator can't sustain a public reference instance (or any sizeable self-host).

A pure single-shared-cluster model resolves the second but not the first. A pure cluster-per-tenant model resolves the first but explodes the second — Hetzner's smallest VM is ~€3.79/mo, so 1,000 idle tenants cost ~$4k/mo before any workload.

The decision is the shape of the hybrid: where the line falls between "free, thin, multi-tenant" and "dedicated, isolated, paid."

## Decision

### 1. Two topologies, one trigger

Atlas runs **two cluster topologies in parallel**:

- **Sandbox cluster** — one shared k3s cluster per Atlas instance, namespace-per-tenant, heavily quota-limited. Free-tier tenants live here. Designed for exploration, demos, throwaway experiments.
- **Dedicated cluster** — one full k3s cluster per *upgraded* tenant, on dedicated Hetzner VMs (own kernel, own control plane, own network). Designed for real workloads.

The trigger between them is an explicit, tenant-initiated intent: **`Tenancy.UpgradeToDedicated`**. Until that intent fires, a tenant lives in sandbox. After it fires (and billing is configured), Atlas provisions a dedicated cluster, migrates the tenant's deployments into it, and updates routing.

This makes the cost story clean: free signups cost roughly one namespace + one Caddy route + a slot in the sandbox quota; real workloads pay for real isolation.

### 2. Sandbox cluster — shape and limits

The sandbox cluster is a single shared k3s cluster, owned and operated by Atlas's operator. Tenants in sandbox map to a k8s namespace `tenant-${tenantId}`. The same baseline as any well-run multi-tenant k8s cluster:

- **NetworkPolicy** — `default-deny-all` ingress + egress at namespace creation. Allowlist: ingress from the sandbox cluster's Caddy (only on the tenant's allocated `<slug>.atlas.example.com` hostname); egress to the public internet (initially unrestricted; mediation lands with [ADR 0006](0006-function-runtime-substrate.md)). Pod-to-pod across tenant namespaces is denied at all times.
- **PodSecurityStandards** — `restricted` profile enforced via `pod-security.kubernetes.io/enforce=restricted`. No host network, no host paths, no privilege escalation, no privileged containers, read-only root filesystem default.
- **ResourceQuota + LimitRange** — every sandbox tenant namespace gets both, sized small. Sane starting defaults (operator-configurable): 0.5 vCPU, 512 MiB memory, 2 GiB ephemeral storage, 5 pods max, 1 ingress, no `PersistentVolumeClaim`s.
- **k8s API access** — sandbox tenant workloads do not get k8s API ServiceAccounts. As in any tenant.
- **Idle reclaim** — a sandbox tenant idle for 30 days has its workloads suspended (configurable). Bytes (Repository revisions, etc.) are retained per the storage retention policy; running pods are not.

Sandbox is explicitly a **weak-isolation tier**: shared kernel, shared cluster control plane, shared nodes. The point is to be useful for exploration without being usable for production.

### 3. Dedicated cluster — shape

When a tenant upgrades, Atlas provisions a **full k3s cluster on dedicated Hetzner VMs for that tenant alone**:

- **Own VMs.** Tenant workloads run on tenant-owned Hetzner VMs. No node is shared between tenants (and no node is shared with sandbox or with the platform cluster). Kernel isolation is real because the kernel is not shared.
- **Own k3s control plane.** Each tenant cluster has its own k3s API server, etcd, scheduler. Atlas reaches it via the k8s API the same way it reaches the sandbox cluster — through the `cluster-orchestrator` port.
- **Own network.** Tenant cluster sits in its own Hetzner private network. No L2/L3 path between tenant clusters. Public ingress is the only inbound surface.
- **Same baseline primitives apply.** Inside the tenant's own cluster, deployments still go in the `tenant-${tenantId}` namespace with the same NetworkPolicy + PSS + ResourceQuota baseline as sandbox. The defenses don't relax just because the tenant owns the cluster — they're cheap insurance against tenant-authored compromises.
- **Sized to plan.** Default starting size: 1 control-plane VM (CX22 or equivalent), 1 worker VM. Plans grow nodes; node management goes through `compute/cluster` capability operations.

The dedicated cluster is the strong-isolation tier: dedicated kernel, dedicated control plane, dedicated network. The same primitives as the sandbox tier *plus* hard substrate isolation.

### 4. Atlas itself: dedicated platform cluster

Per [ADR 0008](0008-atlas-on-atlas.md), the platform is a tenant. Mechanically: **Atlas runs in its own dedicated cluster** ("the platform cluster"), same shape as any upgraded tenant's dedicated cluster. The platform cluster hosts Atlas server, projection worker, control-plane Postgres, and Caddy for `tenant-_platform` (admin/api hostnames).

The platform cluster is **not** the sandbox cluster, and **not** any tenant's dedicated cluster. It is its own k3s + own VMs + own network. The `tenant-_platform` namespace inside the platform cluster carries the same NetworkPolicy + PSS + ResourceQuota baseline as any tenant — so Atlas's own workloads run under the same primitives a tenant's would.

This keeps atlas-on-atlas mechanically true: the platform's deployment shape is the same shape any upgraded tenant has. Atlas is not a special layer — it's the first dedicated cluster, the one operators stand up at bootstrap.

### 5. Tenant ↔ cluster routing (`clusterAffinity`)

Each tenant carries a `clusterAffinity` field in `control_plane.tenants`:

- `"sandbox"` — workloads run in the shared sandbox cluster.
- `"dedicated:${clusterId}"` — workloads run in the named dedicated cluster (one per upgraded tenant).
- `"_platform"` — reserved for the platform tenant, points at the platform cluster.

Every cluster-touching operation in Atlas resolves the target cluster from the tenant's affinity before calling the `cluster-orchestrator` port. The port itself is multi-cluster aware (operations take a `cluster` handle).

### 6. Upgrade flow (one-way; downgrade is a future capability)

The `Tenancy.UpgradeToDedicated` intent (specced as a separate capability under `tenancy/`):

1. Verifies billing is configured + plan supports dedicated.
2. Provisions cluster via `CloudCompute.provisionCluster({ tenantId, plan, region })` (Hetzner VMs + k3s install). Multi-step, asynchronous, surfaces progress to the tenant.
3. Once the cluster is reachable, applies the standard tenant-cluster manifests (namespace, NetworkPolicy, PSS labels, ResourceQuota).
4. Replays existing deployments into the new cluster (rebuild from `Repository.Uploaded` Revisions, redeploy via `Runtime.Deploy`).
5. Updates ingress + DNS to point at the new cluster's load balancer.
6. Once the new cluster is serving the tenant's hostname, decommissions the sandbox namespace.
7. Flips `clusterAffinity` to `dedicated:${clusterId}`.

**Downgrade (dedicated → sandbox) is explicitly not promised.** Tenants who upgrade are expected to stay there. If a future capability adds downgrade, it lands as a separate spec; this ADR forecloses nothing but commits nothing.

### 7. Container runtime baseline

Both sandbox and dedicated clusters use k3s default containerd. **No additional sandboxing at the cluster layer** (no Kata, no gVisor at the pod runtime — gVisor's role per [ADR 0006](0006-function-runtime-substrate.md) is for tenant-authored functions, not container deployments). Dedicated clusters get their isolation from VM-level separation; sandbox tenants get strict-but-not-kernel-level isolation from PSS + NetworkPolicy + ResourceQuota.

### 8. The `cluster-orchestrator` port (multi-cluster aware)

A single port (`ports/src/cluster-orchestrator.ts`, drafted in `compute/runtime`'s capability spec — Wave 2) wraps every k8s API interaction. The port shape is multi-cluster:

```ts
interface ClusterHandle {
  clusterId: string;
  // adapter-internal: kubeconfig, API endpoint, etc.
}

interface ClusterOrchestrator {
  resolveCluster(tenantId: string): Promise<ClusterHandle>;
  createTenantNamespace(cluster: ClusterHandle, tenantId: string): Promise<void>;
  applyDeployment(cluster: ClusterHandle, tenantId: string, spec: DeploymentSpec): Promise<void>;
  // ...etc
}
```

The adapter (`adapters/k8s/`, net-new) holds a registry of cluster handles and dispatches each call to the right k8s API. For Phase 1, the registry is loaded at startup from cluster registrations stored via `compute/cluster`'s `ClusterStore`.

### 9. What's NOT decided here

- **Sandbox tenant idle-reclaim policy specifics** beyond the 30-day default. Operator-configurable; not pinned.
- **Per-tenant cluster size beyond the starting 1+1.** Plan-driven; lives in Commerce/plans.
- **Multi-region per tenant.** Phase 5+. Today: each tenant cluster is single-region.
- **Cluster autoscaling / node lifecycle.** Capability-shaped feature under `compute/cluster`; this ADR commits to "tenants get nodes" without specifying when nodes appear/disappear.
- **Tenant-facing kubeconfig.** Out of scope for Phase 1; tenants interact via `atlasctl`, not raw `kubectl`.
- **HA control plane in the dedicated tier.** Default is single-control-plane k3s; HA is a plan upgrade or a future capability.
- **Where the platform cluster runs.** [ADR 0010](0010-control-plane-runtime-location.md) covers Atlas's runtime location.

## What becomes invalid if this is reversed

- **If we collapse to single-shared-cluster:** the isolation pitch weakens to "namespace + NetworkPolicy + PSS." Mutually-distrusting paid tenants are no longer cleanly separated; kernel escapes are a real (if low-likelihood) risk path. Existing dedicated-cluster tenants would need a destructive workload migration back to sandbox.
- **If we collapse to pure-cluster-per-tenant (sandbox removed):** open public signup costs rise from "near zero per idle tenant" to "~$4/mo per idle tenant." The reference public instance becomes uneconomic; self-hosters running open signup are exposed to the same cost.
- **If we add downgrade later:** that's additive, not a reversal — the upgrade flow doesn't preclude it.
- **If sandbox baseline (NP + PSS + RQ) is relaxed:** sandbox stops being a credible isolation tier; tenants who shouldn't have escalation paths get them. Strict baseline is easier to relax than to retroactively enforce.
- **If tenant workloads ever get k8s API access (in either tier):** the trust boundary collapses. That path is closed in this ADR.

## Consequences

**Positive:**

- **Real isolation when it matters.** Paid / production tenants get dedicated VMs, dedicated control plane, dedicated network — kernel-level separation. The open-signup vision and the strong-isolation vision coexist.
- **Cheap exploration.** Free signups cost a sandbox namespace; an idle tenant costs Atlas approximately nothing.
- **Atlas-on-Atlas is mechanically true.** The platform's deployment shape is the same shape an upgraded tenant has. No special platform layer.
- **Adapter portable.** The `cluster-orchestrator` port is the seam; swapping k3s for full k8s, or Hetzner for AWS, is an adapter change.
- **Upgrade is a real product event.** "Upgrade to dedicated" is a tenant-visible decision tied to billing — natural conversion point.

**Negative:**

- **Two operational shapes.** The operator manages a sandbox cluster *and* a fleet of per-tenant dedicated clusters *and* the platform cluster. Cluster fleet management is real overhead; tools for it (registration, health, upgrade) become first-class concerns.
- **Multi-cluster from day one in the orchestrator port.** The `cluster-orchestrator` port is multi-cluster from the first PR — slightly more design surface than the single-cluster version. Justified by the topology choice; non-trivially more expensive than single-cluster.
- **Upgrade flow is a substantial capability.** Cluster provisioning + workload migration + ingress reroute + decommission is multi-stage and partially failable. Recoverable, but not a one-liner.
- **Sandbox is not a credible production substrate, by design.** Tenants who try to "use sandbox in production" get bitten by limits + idle-reclaim. Marketing has to be clear about which tier is which.
- **Per-tenant Hetzner cost on upgrade is real money.** Operator margin = tenant plan price − Hetzner cost. Plans must be priced accordingly.

## Migration

This ADR is spec-only. Concrete follow-ups:

1. **Wave 2** — `compute/runtime`, `compute/ingress`, `compute/dns` capability specs all cite this ADR for their cluster assumptions. The `cluster-orchestrator` port lands in the `compute/runtime` capability spec, multi-cluster from the start.
2. **Wave 2** — `compute/cluster` capability spec extends `cluster-registration` to cover the dedicated-cluster shape, the sandbox cluster as a special registered cluster, and the platform cluster as a special registered cluster.
3. **Wave 2** — a new `tenancy/upgrade-to-dedicated` capability spec defines the upgrade intent, cluster provisioning flow, workload migration, and rollback semantics. (May span this plan's Wave 2 and a follow-up cycle depending on scope.)
4. **Phase 1 implementation** — `adapters/k8s/` (net-new) implements multi-cluster `ClusterOrchestrator`. `adapters/hetzner-cloud/` (net-new) implements `CloudCompute` including `provisionCluster`. NetworkPolicy + PSS labels + ResourceQuota application is part of `createTenantNamespace`.
5. **Atlas-on-Atlas Stage 2** (existing scoped ticket) — when `_platform` becomes a real `control_plane.tenants` row, its `clusterAffinity` is `_platform` and its cluster is the dedicated platform cluster.
6. **Bootstrap (`atlasctl operator init`, [ADR 0010](0010-control-plane-runtime-location.md))** — provisions both the platform cluster and the sandbox cluster, deploys Atlas into the platform cluster, registers both clusters in the `ClusterStore`, seeds `_platform`.

No code changes in this PR.
