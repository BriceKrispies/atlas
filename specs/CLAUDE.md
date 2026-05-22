# Atlas Specifications

Specs are the SOURCE OF TRUTH. Code implements specs, not the other way around. This is a spec-first project — read the relevant spec before writing code, and update specs before changing behavior.

## Canonical Domain Index

Atlas's domains are grouped into **7 platforms + 1 parked-apps platform** (multi-tenant fabric shape; see [`decisions/0002-developer-platform-domain-map.md`](decisions/0002-developer-platform-domain-map.md) for the original CMS → developer-platform re-anchor and [`decisions/0003-tenant-defined-data-model-pivot.md`](decisions/0003-tenant-defined-data-model-pivot.md) for the Extensibility revival + open-public-signup + agentic-first amendments). The substrate decisions that capability specs in Extensibility build on are recorded in [`decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](decisions/0004-platform-invariants-for-multi-tenant-fabric.md) (I13–I18 + REQ rules), [`decisions/0005-custom-schema-storage-strategy.md`](decisions/0005-custom-schema-storage-strategy.md) (db-per-tenant; supersedes the 2026-05-08 schema-per-tenant choice as of 2026-05-20), [`decisions/0006-function-runtime-substrate.md`](decisions/0006-function-runtime-substrate.md) (gVisor for tenant code), and [`decisions/0007-dsl-substrate-and-authoring-contract.md`](decisions/0007-dsl-substrate-and-authoring-contract.md) (tenant declarations as a distinct category from tenant code). The cross-cutting recursive-kernel principle — Atlas itself is a tenant of itself; code change is the exception — is recorded in [`decisions/0008-atlas-on-atlas.md`](decisions/0008-atlas-on-atlas.md). Root [`CLAUDE.md`](../CLAUDE.md) has the full per-domain table; this file owns the spec-organisation conventions.

| Platform | Domains |
|----------|---------|
| **Spine** | identity, authorization, tenancy, organization, audit, observability, search |
| **Compute** | cluster, runtime, image-build, ingress, dns *(net-new — wraps k3s, kaniko, Caddy, Hetzner Cloud)* |
| **Storage** | object-storage, block-storage, secrets *(net-new — wraps MinIO / Hetzner Object Storage / sealed-secrets)* |
| **Code** | repository, pipeline, artifact-registry *(net-new — wraps Gitea + a registry)* |
| **Workflow** | triggers, scheduling, jobs, function-runner, approvals, import-export *(reshape — same names where retained, content rewritten for "run user code")* |
| **Commerce** | billing, quotas, metering, plans *(quotas + metering moved here from old Extensibility; both load-bearing)* |
| **Extensibility** | custom-schema, functions *(revived per [ADR 0003](decisions/0003-tenant-defined-data-model-pivot.md) — tenant-defined data model + tenant-authored code; capability specs land Phase 3–4)* |
| **First-party apps** *(parked)* | cms (catalog + content-pages + authoring + page-templates) |

Most Compute / Storage / Code platform domains and several Workflow domains are **net-new and currently unspecified** — capability specs land via the slice workflow as Phase 1 of the project plan begins. Domain stub directories are created lazily when a domain's first capability is scoped, not pre-emptively. The Code platform's `repository` domain has its first capability scoped (`upload-tarball`) — see [`domains/code/repository/capabilities/upload-tarball/README.md`](domains/code/repository/capabilities/upload-tarball/README.md).

When writing or updating a spec, the canonical home is `specs/domains/<x>/` (or `specs/domains/<platform>/<domain>/` for the newly-carved Compute / Storage / Code platforms — these nest under their platform dir for clarity).

### Migrated Content (legacy CMS-shape → parked / retained)

The 2026-05-08 domain re-anchor changed several mappings. Per [`decisions/0002`](decisions/0002-developer-platform-domain-map.md), the table below records the disposition of every domain that existed in the prior 29-domain map:

| Prior domain | Disposition under the new map |
|--------------|--------------------------------|
| identity, authorization, tenancy, organization, audit, observability, search | **Kept** under Spine (unchanged) |
| catalog, widgets, authoring, content-pages, page-templates | **Parked** as first-party CMS app (`apps/cms/` once moved). Spec content stays at `specs/domains/<x>/` for now; the CMS-app PR moves it later. |
| delivery, media, maps, forms, localization | **Retired** — no on-path use in dev-platform vision; their `specs/domains/<x>/` directories are pending deletion in a follow-up cleanup PR. |
| automation, rules | **Retired** — replaced by the new Workflow domains (triggers, jobs, function-runner). |
| scheduling, approvals, import-export | **Kept** under Workflow (unchanged location). |
| communications, notifications, analytics, experimentation, gamification | **Retired** — Engagement platform is gone. Notifications about deployments / workflow runs may return as a new domain under Spine if needed. |
| custom-schema, functions | **Revived under Extensibility** per [ADR 0003](decisions/0003-tenant-defined-data-model-pivot.md). Tenant-defined entity types and tenant-authored functions are load-bearing (Salesforce-shaped data model + tenant code execution). Capability specs land Phase 3–4 via the slice workflow. |
| quotas | **Moved** to Commerce platform — load-bearing, paired with billing + metering. |
| billing | **Kept** under Commerce. |

Any spec content under retired-domain directories should be considered legacy notes only — not active. Cleanup PRs will `git rm` them once we're confident nothing references them.

### Remaining crosscut

- `crosscut/atlas-runtime.md` — Atlas-as-runtime concept paper: the runtime model, the tenant program model, the runtime boundary (platform code vs tenant declarations vs tenant code), and the relationship to Atlas-on-Atlas. **Read first** for any task that touches the kernel, the instruction set, tenant programs, or Atlas-on-Atlas framing.
- `crosscut/runtime-instruction-set.md` — the closed set of ten kernel instructions tenant programs and platform code issue (`submitIntent`, `emitEvent`, `projectEvent`, `materializeQuery`, `evaluatePolicy`, `checkQuota`, `runFunction`, `mutateSchema`, `provisionService`, `renderSurface`). Read for any task that adds an action, a handler, a port, a quota dimension, a `FunctionRuntime` consumer, a capability manifest, or a surface introspection capability.
- `crosscut/kernel-vs-data.md` — architectural inventory of trusted kernel code vs hot-changeable runtime data, plus the "could this be data?" decision rule. Read for any capability scope that proposes new behavior (the question is always "code or data?"). Distinct from `crosscut/always-on.md`, which names the same split as an *operational* contract for hot-reload mechanics.
- `crosscut/atlasctl.md` — operator CLI spec (Phase A foundation; Phase B/C deferred). System-wide / tooling, no domain home.
- `crosscut/always-on.md` — always-on contract: what's kernel (restart-required) vs. data (hot-changeable), hot-reload lifecycle, operator surface. Sets the bar [ADR 0008](decisions/0008-atlas-on-atlas.md) Stage 6 deferred.
- `crosscut/action-driven-routing.md` — catch-all contract for both the intent-side (`POST /api/v1/intents` via `HandlerRegistry`) and the query-side (`GET/POST /api/v1/queries/:queryId` via `QueryRegistry`). Read when scoping any new write action or read endpoint — both are module-only edits after `always-on.md` §6 Phase 1.
- `crosscut/errors.md` — error taxonomy (referenced by every domain).
- `crosscut/events.md` — event vocabulary (referenced by every domain).
- `crosscut/logging.md` — logging contract (structured JSON, mandatory fields, levels, redaction). Audited by the `observability-architect` agent.

The legacy `specs/modules/` folder is gone — all content has migrated.

## When to Read Which Spec

### Architecture & Design

| You need to understand... | Read |
|---------------------------|------|
| System principles (P1-P6), invariants (I1-I12) | `architecture.md` |
| End-to-end request lifecycle (5-min trace, WRITE + READ paths, gotchas) | `lifecycle.md` |
| RFC 2119 compliance rules (for compiler) | `normative_requirements.md` |
| Canonical vocabulary (nouns, verbs, pipelines) | `LEXICON.md` |
| Core concept definitions | `glossary.md` |
| Invariant conformance checklist | `conformance.md` |
| Full spec surface inventory | `spec_surface_inventory.md` |

### Remaining Crosscut + Module Files

> Most legacy content has migrated into `specs/domains/<x>/` (see "Migrated
> Content" above). The legacy `specs/modules/` folder is gone; what remains
> in `crosscut/` is system-wide material with no single domain home.

| Path | Why it's still here |
|------|---------------------|
| `crosscut/atlas-runtime.md` | Atlas-as-runtime framing — read first for kernel / instruction-set / Atlas-on-Atlas / code-as-data work |
| `crosscut/runtime-instruction-set.md` | The ten kernel instructions tenant programs issue — read when adding actions / ports / quota dimensions / surfaces / FunctionRuntime consumers |
| `crosscut/kernel-vs-data.md` | Kernel/data inventory + "could this be data?" decision rule — read when scoping any new capability or considering hot-reload extraction |
| `crosscut/always-on.md` | Always-on contract — kernel/data split, hot-reload rules ([ADR 0008](decisions/0008-atlas-on-atlas.md) Stage 6) |
| `crosscut/action-driven-routing.md` | Catch-all contract — intent + query sides; read for any new action / read endpoint |
| `crosscut/atlasctl.md` | Operator CLI — tooling, not a domain |
| `crosscut/errors.md` | Error taxonomy — referenced by every domain |
| `crosscut/events.md` | Event vocabulary — referenced by every domain |

If you're adding new system-wide cross-cut content, prefer the `crosscut/`
folder (a new file, not a domain).

### Data Schemas (`schemas/`)

Conceptual schemas per module — technology-agnostic, no DDL. One file per module: `schemas/<module>.md`

JSON schema contracts: `schemas/contracts/*.schema.json`

### Frontend specs (`specs/frontend/`)

See `WEB.md` (at the repo root) for the TypeScript stack routing, or jump directly into the spec docs below:

| Topic | File |
|-------|------|
| Constitutional rules (C1-C15) | `frontend/constitution.md` |
| Architecture + component system | `frontend/architecture.md` |
| Surface contract format + example | `frontend/surface-contract.md` |
| Testing strategy | `frontend/testing-strategy.md` |
| Accessibility | `frontend/accessibility.md` |
| Observability / telemetry | `frontend/observability.md` |
| Agent workflow (8 steps) | `frontend/ai-agent-workflow.md` |
| Repo structure | `frontend/repo-structure.md` |

### Fixtures (`fixtures/`)

Golden test fixtures. Naming: `<kind>__<expect>__<name>.json`
- Kinds: `event_envelope`, `module_manifest`, `search_documents`, `analytics_events`
- Expectations: `valid`, `invalid`
- Validate: `pnpm test` (fixtures are exercised by unit tests)

## Adding / Modifying Specs

| Task | Where |
|------|-------|
| New domain capability | Create `domains/<domain>/capabilities/<capability>/README.md` |
| New cross-cutting concern | Create `crosscut/<concern>.md` |
| New JSON schema | `schemas/contracts/<name>.schema.json` |
| New golden fixture | `fixtures/<kind>__<expect>__<name>.json` |
| New frontend spec | `frontend/<topic>.md` |
| New conceptual schema | `schemas/<module>.md` |
