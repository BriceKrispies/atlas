# Atlas Specifications

Specs are the SOURCE OF TRUTH. Code implements specs, not the other way around. This is a spec-first project — read the relevant spec before writing code, and update specs before changing behavior.

## Canonical Domain Index

Specs are organized around the **26-domain × 5-platform** taxonomy
(see root [`CLAUDE.md`](../CLAUDE.md) for the full table). Each domain's home
is `specs/domains/<domain>/`. Most are stubs today; content lives in the legacy
locations below until it migrates.

| Platform | Domains |
|----------|---------|
| **Spine** | identity, authorization, tenancy, organization, audit, observability, search |
| **Content** | authoring, delivery, media, maps, catalog, widgets, forms, localization |
| **Workflow** | automation, rules, scheduling, approvals, import-export |
| **Engagement** | communications, notifications, analytics, experimentation, gamification |
| **Commerce** | billing |

When writing or updating a spec, the canonical home is `specs/domains/<x>/`.
If existing content lives under `specs/modules/<old>/` or `specs/crosscut/<x>.md`,
either move it (preferred when the domain is being actively scoped) or
cross-reference it from the new home (the current default).

### Migrated Content (history of legacy → canonical moves)

All legacy content with a clean domain mapping has been moved into
`specs/domains/<x>/` (history preserved via `git mv`). For locality, files
are placed at the domain root or in a subfolder named after the legacy module:

| Canonical domain | Migrated content |
|------------------|------------------|
| identity | `./authn.md`, `./identity.md`, `./tokens/` |
| authorization | `./authz.md`, `./security.md`, `./authz-module/` |
| tenancy | `./tenancy.md` |
| organization | `./org/` |
| audit | `./audit/` |
| catalog | `./structured-catalog/` |
| widgets | `./widgets.md`, `./ui.md` |
| communications | `./comms/` |
| import-export | `./import/` |
| authoring | `./content-pages/`, `./content-pages.json`, `./page-templates.md` |
| media | `./storage.md`, `./content/` (incl. announcements — see split note below) |
| gamification | `./badges/`, `./points/` |

The other 14 domains have no spec content yet — their `README.md` is a stub.

### Remaining Orphans

After migration, these still sit at their legacy paths:

- `crosscut/atlasctl.md` — operator CLI spec (system-wide / tooling, no domain home)
- `crosscut/errors.md` — error taxonomy (system-wide cross-cut)
- `crosscut/events.md` — event vocabulary (system-wide cross-cut)

The legacy `specs/modules/` folder is gone — all content has migrated.

### Known split candidate

`specs/domains/media/content/` contains BOTH Media Library *and* Announcements
Widget specs (came from the legacy `modules/content/` folder). Announcements
needs its own domain or to be folded under another — flagged for a future split.

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
> Content" above). What's left in `crosscut/` and `modules/` is system-wide
> material with no single domain home, plus orphan modules that don't fit the
> 25-domain map.

| Path | Why it's still here |
|------|---------------------|
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
- Validate: `make spec-check`

## Adding / Modifying Specs

| Task | Where |
|------|-------|
| New feature module | Create `modules/<name>/` with `README.md`, `surfaces.md`, `events.md` |
| New cross-cutting concern | Create `crosscut/<concern>.md` |
| New JSON schema | `schemas/contracts/<name>.schema.json` |
| New golden fixture | `fixtures/<kind>__<expect>__<name>.json` |
| New frontend spec | `frontend/<topic>.md` |
| New conceptual schema | `schemas/<module>.md` |
