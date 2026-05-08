# 0002 — Re-anchor the domain map for a developer-platform vision

**Status:** Accepted (2026-05-08)
**Supersedes:** the 29-domain × 6-platform map originally documented in `CLAUDE.md` and `specs/CLAUDE.md`.

## Context

Atlas was originally scoped as a multi-tenant SaaS *framework* with a CMS / catalog flavor — 29 domains across Spine, Content, Workflow, Engagement, Extensibility, and Commerce. Four modules shipped on this scoping: `authz`, `catalog`, `content-pages`, `identity`. Most other domains were stubs.

The product direction has changed. Atlas is now a **self-hosted developer platform**: tenants sign up, push code, get backend resources provisioned, run workflows. See [`vision.md`](../vision.md) for the user-facing description. The CMS / catalog framing no longer matches the product; keeping it would require maintaining specs and code whose vocabulary doesn't fit.

## Decision

Replace the 29-domain map with a developer-platform-shaped layout: **6 platforms + 1 parked-apps platform, ~30 domains**. Domains and platform memberships:

| Platform | Domains | State |
|----------|---------|-------|
| **Spine** | identity, authorization, tenancy, organization, audit, observability, search | mostly retained from prior map; identity + authz are already the most built-out |
| **Compute** | cluster, runtime, image-build, ingress, dns | **net-new** — wraps k3s, kaniko, Caddy, Hetzner Cloud + Hetzner DNS |
| **Storage** | object-storage, block-storage, secrets | **net-new** — wraps MinIO / Hetzner Object Storage / k8s sealed-secrets |
| **Code** | repository, pipeline, artifact-registry | **net-new** — wraps Gitea + a container registry (Harbor or Distribution) |
| **Workflow** | triggers, scheduling, jobs, function-runner, approvals | **reshape** — same names, different content (run user code, not CMS rules) |
| **Commerce** | billing, quotas, metering, plans | quotas + metering moved here from the old Extensibility platform; both are now load-bearing because real compute means real money |
| **First-party apps** *(parked)* | cms (catalog + content-pages + authoring + page-templates) | parked from the prior platform map; not part of platform core |

### Domain disposition summary

**Retired from core (parked under first-party apps):**
- catalog, content-pages, widgets, authoring, delivery, media, maps, forms, localization

**Retired entirely:**
- engagement-platform domains (communications, notifications, analytics, experimentation, gamification) — none on-path. If any are needed later (notifications about deployments, analytics about workflow runs), they land as new domains under Spine or a new platform; they're not retained from the old map.
- custom-schema, functions (from old Extensibility) — don't have a home in the dev-platform vision today. Tenant-defined entity types and tenant-defined functions may return as future work, but not in the load-bearing path.

**Kept and recontextualised:**
- Spine domains transfer cleanly (a multi-tenant platform needs identity, authz, tenancy, audit, observability, search regardless of what runs on top).
- import-export survives as a Workflow concern (bulk operations on user data still apply).
- Workflow domain names survive but their content is rewritten (jobs run user code now, not CMS rules).

### UI / framework code is not part of the domain map

`packages/core`, `packages/design`, `packages/widgets`, `packages/widget-host`, `apps/sandbox` are **kept and reused** as the dev-platform UI toolkit. They are not domain code; they're framework infrastructure. The new dev-platform admin shell will be built on top of them.

`apps/admin`'s shell is reused; its CMS-shaped feature pages get rewritten for dev-platform features (deployments, repos, workflows, secrets, metrics).

## Consequences

**Positive:**
- The platform-owner agents now match the actual work: compute / storage / code / workflow / commerce / spine. Each owner has a clear remit instead of a stub list.
- Specs no longer carry stale domains nobody is going to write. New capability specs land under the new structure.
- The slice workflow ([`../../CLAUDE.md`](../../CLAUDE.md) → "Slice Workflow") remains valid; only the domain inventory changes.
- The CMS work is preserved at `apps/cms/` for future revival without polluting the platform core.

**Negative:**
- `modules/content-pages/`, `modules/catalog/`, related apps and packages all need to move (separate PR — this ADR is spec-only). That's a real disruption to in-flight tenancy / signup work.
- Several agent files are deleted / rewritten — historical context survives via git history but is no longer at the top of the tree.
- ~10 capability specs now need to be written (compute / storage / code / workflow ports + adapters + handlers) before significant code lands. Spec-first discipline holds, so this is gating work for Phase 1.

**Out of scope for this ADR:**
- Whether to delete or keep the parked CMS code long-term (decision: park for now; revisit after Phase 4).
- The specific port shapes for Compute / Storage / Code domains. Each gets its own capability spec when it lands.
- Renaming the project. "Atlas" is retained.

## Migration

This ADR alone is a spec change. The follow-up structural work (moving CMS code, deleting obsolete spec stubs, creating Compute/Storage/Code spec scaffolding) is staged as separate PRs:

1. **This PR (spec-only):** ADR + `vision.md` + `CLAUDE.md` updates + agent roster update. No code moves, no capability specs.
2. **Move CMS code to `apps/cms/`** (one focused PR, all import paths updated, tests still pass).
3. **Delete obsolete `specs/domains/` stub directories** (small PR; whatever doesn't have a home in the new map gets `git rm`'d).
4. **Scaffold new domain spec dirs** (`specs/domains/compute/`, `storage/`, `code/`) with `README.md` stubs each pointing back to this ADR.
5. **First capability spec** — likely `specs/domains/compute/capabilities/cluster-bootstrap/README.md` per the plan.

Implementation work follows in Phase 1 per the project plan. No platform code lands until step 4 is complete.
