# Atlas Vision

**Atlas is a self-hosted developer platform.** A tenant signs up, gets a key, pushes their code, and Atlas provisions backend resources (compute, storage, DNS, secrets) and runs their workflows. Think "your own GitHub + a small AWS" running on a Hetzner footprint.

The trinity:

1. **Secure signup → login.** A tenant creates an account, gets an API key + an admin user, and is isolated from every other tenant.
2. **Provision resources.** Atlas can spin up compute (a Kubernetes-managed app deployment), allocate storage (object + block + secrets), and bind DNS / TLS for a tenant-scoped subdomain — all through one CLI and one HTTP API.
3. **Run workflows.** A tenant defines workflows that run on Atlas — manually, on a schedule, or on git-push to an Atlas-hosted repo.

The MVP demo: hand a friend a key. They run

```sh
atlasctl signup
atlasctl push ./hello-world      # any directory with a Dockerfile
```

and a few minutes later their app is serving traffic at `https://<their-slug>.atlas.example.com`.

## Where Atlas's value lives

Atlas does not rebuild git, container orchestration, object storage, or cloud APIs. It **wraps** existing tools as adapters and contributes the layer that doesn't otherwise exist for solo / small-team operators:

- A **single, audited multi-tenant control plane** — identity, authorization, tenancy, audit, observability — applied uniformly to every operation.
- A **single CLI** (`atlasctl`) and HTTP API for every capability — push code, provision resources, run workflows, view logs, manage secrets.
- A **single tenant lifecycle** — signup, provisioning, quota enforcement, billing, suspension — that ties compute / storage / code / workflow together instead of treating them as separate products.

Wrapped components in MVP:

- **k3s** (lightweight Kubernetes) for container orchestration
- **kaniko** for in-cluster image builds
- **Caddy** for ingress + automatic TLS
- **Hetzner Cloud** for nodes
- Later: **Gitea** for git, **MinIO** or Hetzner Object Storage for blobs, **sealed-secrets** for k8s secret management

Atlas's adapters keep these substitutable. The contract is the port, not the tool.

## What Atlas is not (today, on purpose)

- Not a public IaaS / PaaS. Atlas is single-operator, multi-tenant. Not designed to compete with AWS or Heroku.
- Not a container registry / git hosting service in its own right. Those run inside Atlas as wrapped components.
- Not multi-region. MVP is single-region (one Hetzner cluster); cross-region failover is later.
- Not a CMS. The previous CMS-flavored work survives as a parked first-party app (`apps/cms/`); see [decisions/0002-developer-platform-domain-map.md](decisions/0002-developer-platform-domain-map.md) for the disposition.

## The core invariants this depends on

The platform invariants from [`architecture.md`](architecture.md) (I1–I12) **all still hold**, plus the runtime layer adds new responsibilities — most importantly:

- Tenant isolation now applies to **runtime workloads** (network policies, pod resource limits, secret scoping), not just data rows.
- Authorization runs at the platform boundary AND at every provisioning surface (compute, storage, code).
- Quotas are **load-bearing** — a tenant over their CPU-seconds budget cannot deploy. Real money is at stake when compute is real.

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

- **Phase 0** (now): Foundation hardening — finish signup, retire CMS framing, align specs.
- **Phase 1** (~M1–M3): `atlasctl push` → live URL, single-tenant compute MVP.
- **Phase 2** (~M4–M6): Multi-tenant + per-tenant storage + secrets.
- **Phase 3** (~M7–M9): Atlas-hosted git + workflow runs (manual / scheduled / on-push).
- **Phase 4** (~M10–M12): Quotas + billing wired to real usage; production-ready.

Detailed phasing in the internal plan; the [domain-map ADR](decisions/0002-developer-platform-domain-map.md) records what changed and why.
