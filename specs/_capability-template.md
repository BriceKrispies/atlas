# Capability Template

Copy this file to `specs/domains/<domain>/capabilities/<capability>/README.md` when scoping a new capability. Fill every section. Delete this header when copying.

Modeled on `specs/domains/tenancy/capabilities/custom-domains/README.md` — read that as a worked example before filling this in.

---

# Capability: <Name>

**Domain:** <domain>
**Capability:** <kebab-case-name>
**Status:** Draft | Active | Stubbed | Done

## Purpose

One paragraph. The value proposition: who is the actor, what do they do, what changes for them. No implementation talk yet.

## Invariants Touched

List the I1–I12 IDs this capability interacts with. For each, a one-line note on how the capability respects (or relies on) it.

- **I_** — _how this capability interacts with the invariant_
- ...

If none — say so explicitly. Capabilities that touch zero invariants are rare; usually you've missed one.

## Lexicon

New or affected terms in `specs/LEXICON.md`. If the capability introduces a noun/verb/pipeline word that isn't already in the lexicon, list it here and update `LEXICON.md` as part of the spec PR — not the implementation PR.

- `<term>` — _definition; link to canonical lexicon entry_

## Surfaces

What this capability adds or changes, by surface:

- **Handlers** — `<actionId>` → `modules/<x>/src/handlers/<file>.ts`
- **Events emitted** — `<EventType>` with `cacheInvalidationTags: [Tenant:${tenantId}, ...]`
- **Projections** — name → `modules/<x>/src/projections/<file>.ts`
- **Queries** — name → `modules/<x>/src/queries/<file>.ts`
- **Ports** — new or extended `ports/src/<file>.ts`
- **Adapters** — `adapters/{node,idb}/src/<file>.ts`
- **Routes** — `apps/server/src/routes/<file>.ts`
- **UI surfaces** — `apps/<app>/src/features/<file>.ts`, `packages/design/src/atlas-<noun>.ts`
- **Migrations** — `adapters/node/src/migrations/{control-plane,tenant}/<file>.sql` (and matching IDB schema bump)

Omit lines that don't apply. If a surface needs a new port, hand off to `port-adapter-dev` early — it gates downstream work.

## End-to-End Flow

Numbered steps from actor → ingress → handler → events → projection → cache → query → UI. Reference `specs/lifecycle.md` for the canonical request shape; this section calls out only what's specific to this capability.

1. _Actor does X_
2. _Request lands at `apps/server/src/routes/...` with `<intent>` payload_
3. _Handler emits `<EventType>` carrying `cacheInvalidationTags`_
4. _Dispatcher chain rebuilds `<projection>` and purges `<tag>`_
5. _Subsequent query reads from projection_
6. _UI surface re-renders via signal/SSE_

## What's Stubbed Today

What scaffold already exists that the implementer should reuse, not duplicate. If the capability is brand-new, write "Nothing — this is greenfield." If the seam is partially landed (like `custom-domains`), enumerate it precisely.

- _`<port>` already exists at `ports/src/<file>.ts` — extend, don't replace_
- _Migration `<filename>` already lays down the table; this capability adds nullable columns_
- _...etc_

## What's NOT in Scope

Explicit non-goals. Anything in this list belongs in a follow-up capability spec, not this one.

- _<thing>_
- _<thing>_

## File-by-File Plan

Numbered, in execution order. Group additive steps before any worker/async step. Each entry is one to three lines: file path + one-line rationale. Reference real existing files when the work is "extend X."

1. **<file path>** — _add/extend X to do Y_
2. **<file path>** — _new test asserting `<behavior>` and `cacheInvalidationTags`_
3. ...

The implementer (`module-dev` / `port-adapter-dev` / `frontend-dev`) takes this list and ships it. If they discover a step is wrong, the spec is wrong — escalate to `spec-keeper`, don't silently improvise.

## Things That DON'T Change

Anything pre-existing whose behavior or shape the capability must not alter. This is the seam contract — if a future change *does* alter any of these, it's a sign the work is exceeding the capability's scope.

- _<file/function/contract>_
- ...

## Acceptance

Concrete, named tests that must exist before the capability is "done":

- **Handler test** — `modules/<x>/test/handlers.test.ts` ▸ `<test name>` — asserts handler emits expected event and `cacheInvalidationTags` includes `Tenant:${tenantId}`
- **Dispatch test (I12)** — `modules/<x>/test/dispatch.test.ts` ▸ `<test name>` — replays synthetic event stream and asserts projection rebuilds identically
- **Contract test** (when a port changed) — `packages/contract-tests/src/<port>.test.ts`
- **BDD scenario** — `tests/bdd/features/<domain>/<capability>.feature` ▸ `<scenario name>` — surface-state assertion via `window.__atlasTest.getSurface(...)`
- **Parity test** (if both `node` and `idb` adapters touched) — `tests/parity/...`

If a test category doesn't apply, say "N/A — _reason_." Don't omit silently.

## Cross-References

Absolute paths to related specs, ports, adapters, tests, and lexicon entries.

- Domain spec: `specs/domains/<domain>/README.md`
- Architecture: `specs/architecture.md` (relevant invariant sections)
- Lexicon: `specs/LEXICON.md` ▸ `<term>`
- Lifecycle: `specs/lifecycle.md`
- Related capabilities: `specs/domains/<other>/capabilities/<other>/README.md`
- Existing code: `<file paths>`
