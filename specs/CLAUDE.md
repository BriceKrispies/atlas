# Atlas Specifications

Specs are the SOURCE OF TRUTH. Code implements specs, not the other way around. This is a spec-first project — read the relevant spec before writing code, and update specs before changing behavior.

## When to Read Which Spec

### Architecture & Design

| You need to understand... | Read |
|---------------------------|------|
| System principles (P1-P6), invariants (I1-I12) | `architecture.md` |
| RFC 2119 compliance rules (for compiler) | `normative_requirements.md` |
| Canonical vocabulary (nouns, verbs, pipelines) | `LEXICON.md` |
| Core concept definitions | `glossary.md` |
| Invariant conformance checklist | `conformance.md` |
| Full spec surface inventory | `spec_surface_inventory.md` |

### Cross-Cutting Concerns (`crosscut/`)

| Topic | File |
|-------|------|
| Authentication (authn) | `crosscut/authn.md` — implemented: Principal model, test-auth, JWT stub |
| Identity (users, profiles) | `crosscut/identity.md` — User entity, lifecycle, profiles, module boundaries |
| Authorization (authz) | `crosscut/authz.md` — implemented: ABAC, deny-overrides-allow, permission/role integration |
| Tenancy model | `crosscut/tenancy.md` — tenant boundaries, data isolation |
| Security patterns | `crosscut/security.md` — roles, permissions |
| Event system | `crosscut/events.md` — event vocabulary, flow patterns |
| Error handling | `crosscut/errors.md` — 9 error categories, failure semantics |
| File storage | `crosscut/storage.md` — privacy model, placeholder behavior |
| UI bundle system | `crosscut/ui.md` — versioning, lifecycle, 10 invariants |
| Widget system | `crosscut/widgets.md` — manifest, mediator, isolation modes, 10 invariants |
| atlasctl CLI | `crosscut/atlasctl.md` — operator CLI spec |

### Feature Modules (`modules/`)

8 modules — all spec-only, no domain code yet:

| Module | Surfaces | Key Concepts |
|--------|----------|-------------|
| `tokens` | Tokens Admin Page | Token registry, evaluation |
| `comms` | Email Templates, Messaging Widget, Email Notifications | Email sending flow, messaging |
| `org` | User Directory, User Detail, User Invite, Role Admin, Profile Schema Admin, Business Unit Admin | Users, roles, permissions, profiles, business units |
| `content` | Announcements Widget, Media Library | File privacy, placeholders |
| `points` | Points Admin | Point systems, balances, transactions |
| `audit` | Intents History Page | Central intent sink (consumes ALL intents) |
| `import` | Spreadsheet Uploader Widget | CSV/XLSX, validation, dry-run |
| `badges` | Badges Admin | Badge definitions, criteria, award flow |

Each module has: `README.md` (overview), `surfaces.md` (UI), `events.md` (domain events)

### Data Schemas (`schemas/`)

Conceptual schemas per module — technology-agnostic, no DDL. One file per module: `schemas/<module>.md`

JSON schema contracts: `schemas/contracts/*.schema.json`

### Frontend (`frontend/`)

See `frontend/CLAUDE.md` for the full frontend routing, or jump directly:

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
