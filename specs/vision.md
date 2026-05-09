# Atlas Vision

**Atlas is a multi-tenant platform fabric.** A tenant signs up, defines the data model their application needs, optionally provisions backend services to run alongside it, writes functions and workflows against their own data, and gets identity, authorization, audit, observability, and search applied uniformly to every operation — for free, by virtue of being a tenant on Atlas.

Atlas is **software**. Anyone can self-host it. The author runs a public hosted instance (`atlas.<domain>`) as one example deployment, with open public signup, but the public instance is not a privileged form — it's the same software anyone else runs.

## The dream

Atlas's value-add is the **glue layer that doesn't otherwise exist** for solo and small-team operators who want to host applications for their tenants without rebuilding the multi-tenant chassis from scratch each time.

Three things every tenant gets:

1. **A tenant-defined data model.** Tenants declare their own entity types, fields, and relationships through Atlas's API. Atlas stores the data (DB-per-tenant), serves it through tenant-scoped queries, generates UI over it, and audits every read and write. Salesforce-shaped: the data model lives **in** Atlas, defined as data, not as code that needs a deploy.
2. **On-demand backend services.** Tenants request the supporting infrastructure their workload needs — block storage, object storage, secrets, container compute, ingress, DNS — and Atlas provisions it inside the tenant's isolation boundary. Vercel-shaped: the tenant declares *what they need*, Atlas figures out *how to give it to them*. Atlas does not rebuild any of these primitives; it wraps existing tools (k3s, kaniko, Caddy, MinIO, Hetzner Cloud, sealed-secrets) and applies the multi-tenant chassis on top.
3. **Tenant-authored code execution.** Tenants write functions that fire on data events, expose HTTP endpoints, or run on schedules — sandboxed, quota-governed, and tenant-scoped. They write workflows that orchestrate their functions, deployments, and external calls. Atlas runs all of it through the same single ingress, the same audit log, the same observability surface.

### Agentic from day one

Atlas is designed to be operable by AI agents from the start, not retrofitted later. Three concrete commitments:

- **Single ingress (Invariant I1).** Every operation — UI, CLI, API, agent — flows through `apps/server`. There is no "side door" that bypasses authz, audit, or observability.
- **Structured logs and machine-readable surfaces.** Every log line is structured JSON with mandatory correlation/tenant/principal fields ([`crosscut/logging.md`](crosscut/logging.md)). Every UI surface exposes its state in a form an agent can read (the `surface-contract.md` model).
- **One CLI, one API, one audit trail.** `atlasctl` is the operator surface; the same HTTP API backs both the UI and any agent. Anything an agent needs to do, a tenant or operator can do too — and vice versa.

### Atlas-on-Atlas

The platform is a tenant of itself. Atlas's own admin operations run through the same chassis any tenant uses, not through a privileged side-layer. Three concrete commitments:

- **The platform is a tenant.** Atlas's own state lives in `control_plane.tenants` as an ordinary row (`_platform`). The same identity / authz / audit / observability pipeline that governs any tenant operation governs Atlas's own admin operations. There is no privileged platform layer that bypasses the chassis.
- **Code change is the exception.** Schemas, policies, intents, and surface manifests are data wherever sensible. New behavior asks first **"could this have been data?"** before reaching for a code change. The kernel is small (`packages/ingress`, event-log append, projection rebuild, policy evaluation); the rest is data candidates.
- **Always-on.** Server and database run continuously; tenant changes never restart them. The "what counts as restart-required" bar is documented in `crosscut/always-on.md`.

See [`decisions/0008-atlas-on-atlas.md`](decisions/0008-atlas-on-atlas.md) for the principle and the staged path from today's `_platform`-as-magic-string state to a real recursive kernel.

### What every tenant gets for free

Because they are a tenant on Atlas, not because they wrote code for it:

- **Identity** — federated login, API keys, principal scopes.
- **Authorization** — policy enforcement on every request, deny-overrides-allow, evaluated before any side effect (Invariants I2, I4).
- **Tenancy isolation** — at the data layer (per-tenant DB), the runtime layer (network policies, namespace scoping, quota enforcement), and the search layer (tenant-scoped indexes, Invariant I7).
- **Audit** — every state change recorded with `correlationId` and `tenantId`, queryable by the tenant and by the operator.
- **Observability** — structured logs, metrics, and traces with consistent vocabulary across every domain.
- **Search** — tenant-scoped, never cross-leaking.

These are the **tiny core**. Atlas's own control-plane schema stays small (tenants, users, principals, policies, audit events, deployments, jobs, quotas) — tenant-domain concepts live in tenant DBs, not in Atlas's core.

## The first viable thing

The dream is large; the first demo is concrete. The MVP that proves the chassis works:

```sh
atlasctl signup
atlasctl push ./hello-world      # any directory with a Dockerfile
```

A friend gets a signup link. They run the commands above. A few minutes later their app is serving traffic at `https://<their-slug>.atlas.example.com`, with a GitHub-feeling repo view, a workflow that ran their build, deployment logs they can read, and an audit trail of everything that just happened.

What's running in MVP:

- **Hetzner Cloud** for nodes, **k3s** for orchestration, **kaniko** for in-cluster image builds, **Caddy** for ingress + automatic TLS, **MinIO** for object storage, **Gitea** (later phase) for git, **sealed-secrets** for k8s secret management.
- All of it containerized; Atlas's control plane (server, projection worker, web UI) runs alongside.
- Public signup is open — the operator can disable it, but it works out of the box.

This MVP doesn't yet exercise the tenant-defined data model or the on-demand service catalog — those are later phases. It exercises the **chassis**: signup → tenancy → repo → workflow → deployment, all flowing through one ingress, one audit log, one observability surface. The chassis is what every later phase composes onto.

## Hosting model

Atlas is software anyone can self-host. There is no "Atlas Cloud" the company; there is the project, and there are deployments of the project.

- **Self-hosted** — operator runs Atlas on their own infrastructure (Hetzner, AWS, bare metal, a Pi cluster — anywhere k3s runs). Tenancy is internal: the operator's customers, team members, or applications.
- **Public instance** — the project author runs `atlas.<domain>` with open public signup, as a reference deployment and a way for anyone to try Atlas without standing up a cluster. Same software as self-hosted.
- **Hybrid** — a self-host can choose to open public signup, gate it by invite, or keep it operator-only. Atlas treats all three the same way; signup gating is configuration.

What this means for the platform:

- Public signup must work without operator intervention (signup → email verify → tenant provisioned → admin user created), and must work safely (rate-limiting, quota defaults, abuse signals). Open public signup is supported from day one, not retrofitted.
- Multi-tenant isolation must be **strict** even between mutually-distrusting tenants on the same instance. The operator is not a fallback for isolation failures.
- Quota enforcement is **load-bearing**. A tenant over their CPU-seconds, storage-bytes, function-invocations, or signup-rate budget cannot consume more — and cannot bring down the rest of the instance.

## Wrapped components

Atlas does not rebuild git, container orchestration, object storage, identity providers, or cloud APIs. It **wraps** existing tools as adapters and contributes the layer on top: the multi-tenant chassis, the developer UX, the unified audit, the single CLI/API.

| Concern | Wrapped component |
|---------|-------------------|
| Container orchestration | k3s (lightweight Kubernetes) |
| Image build | kaniko (in-cluster, daemonless) |
| Ingress + TLS | Caddy (with automatic ACME) |
| Compute nodes | Hetzner Cloud |
| Object storage | MinIO (or Hetzner Object Storage) |
| Git hosting | Gitea (Phase 3) |
| Secret management | k8s sealed-secrets |
| DNS | Hetzner DNS (Phase 1+) |

Adapters keep these substitutable. The contract is the port (`@atlas/ports`), not the tool. An operator deploying Atlas elsewhere can swap any wrapped component without touching domain code.

## What Atlas is not (today, on purpose)

- **Not a CMS.** The previous CMS-flavored work survives as a parked first-party app (`apps/cms/`); see [`decisions/0002-developer-platform-domain-map.md`](decisions/0002-developer-platform-domain-map.md) for the disposition.
- **Not multi-region.** MVP is single-region (one cluster); cross-region failover is later.
- **Not a public IaaS competitor.** Atlas is multi-tenant and supports open public signup, but it's not designed to compete with AWS/GCP/Heroku on raw resource economics or breadth of services. The value is the chassis, not the substrate.
- **Not a no-code platform.** Tenants who want to build with Atlas write code (functions, workflows, custom UI). The data model is declarative; the behavior is code.

## Core invariants

The platform invariants from [`architecture.md`](architecture.md) (I1–I12) **all hold**, with these emphasized for the multi-tenant fabric:

- **Tenant isolation** applies to **data, runtime workloads, search indexes, and quota accounting** — not just data rows.
- **Authorization** runs at the platform boundary AND at every provisioning surface (compute, storage, code, function execution, schema mutation).
- **Quotas** are load-bearing — over-budget tenants cannot deploy, cannot run functions, cannot grow data. Real money and real isolation are at stake.
- **Audit completeness** — every state change emits an event with `correlationId` + `tenantId` + `principalId`. There is no audit-skipping path.

## How a tenant's code reaches the internet (Phase 1 MVP)

```
atlasctl push ./hello-world
        │
        ▼
apps/server (Hono) — POST /api/v1/deployments
        │  • validates intent, runs authz, checks quota
        ▼
ImageBuilder port (kaniko)
        │  • builds the Dockerfile inside the cluster, pushes to registry
        ▼
Orchestrator port (k3s API)
        │  • applies a Deployment + Service in the tenant namespace
        ▼
IngressController port (Caddy)
        │  • adds a hostname + ACME cert for <slug>.atlas.example.com
        ▼
public internet
```

Every step emits an audit event with the same `correlationId`. Every step is tenant-scoped. Every step goes through one of the wrapping ports.

## Roadmap (one-liner per phase)

- **Phase 0** (now): Foundation hardening — finish signup, retire CMS framing, align specs with the multi-tenant-fabric vision.
- **Phase 1** (~M1–M3): `atlasctl push` → live URL. Single-region compute MVP. Open public signup with sane defaults.
- **Phase 2** (~M4–M6): Per-tenant storage (object + block) + secrets. Quota enforcement against real resource use.
- **Phase 3** (~M7–M9): Atlas-hosted git + workflow runs (manual / scheduled / on-push). Tenant-defined functions land in this phase or early Phase 4.
- **Phase 4** (~M10–M12): Tenant-defined data model (`custom-schema`) + tenant-authored functions wired to schema events. Billing wired to real usage. Production-ready.
- **Phase 5+**: Service catalog beyond the wrapped MVP set (managed Postgres, Redis, search, etc.). Multi-region. Marketplace of tenant-shareable schemas/functions.

The Salesforce-shaped data model and the Vercel-shaped service provisioning live in Phases 3–4 and Phase 5+ respectively. Phase 1's MVP is the chassis they all run on.

Detailed phasing in the internal plan; the [domain-map ADR (0002)](decisions/0002-developer-platform-domain-map.md) records the prior re-anchor, [ADR 0003](decisions/0003-tenant-defined-data-model-pivot.md) records this vision (un-retiring `custom-schema` + `functions`, codifying agentic-first, framing Atlas as software with a public reference deployment), [ADR 0004](decisions/0004-platform-invariants-for-multi-tenant-fabric.md) lands the new platform invariants I13–I18 and six normative requirements that make the multi-tenant-fabric tenets mechanically checkable, [ADR 0005](decisions/0005-custom-schema-storage-strategy.md) commits `custom-schema` to schema-per-tenant Postgres storage, [ADR 0006](decisions/0006-function-runtime-substrate.md) commits the `functions` MVP runtime to gVisor with the port shape kept swappable for V8 isolates and Firecracker, [ADR 0007](decisions/0007-dsl-substrate-and-authoring-contract.md) commits tenant declarations (DSL artifacts) to a shared substrate distinct from tenant code, and [ADR 0008](decisions/0008-atlas-on-atlas.md) records the recursive-kernel principle (Atlas itself is a tenant of itself; code change is the exception).
