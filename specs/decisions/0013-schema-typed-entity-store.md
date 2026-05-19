# 0013 — `EntityStore` is schema-typed, not generic-typed

**Status:** Proposed (2026-05-12)
**Depends on:** [`0005-custom-schema-storage-strategy.md`](0005-custom-schema-storage-strategy.md) (the schema-per-tenant decision that makes schemas load-bearing for tenant data); the `Upcaster` pipeline referenced in [`ports/src/entity-store.ts:17-20`](../../ports/src/entity-store.ts).
**Touches invariant:** I12 (projections rebuildable from events) — strengthens it by making the projected `attrs` shape verifiable on every read.

## Context

`EntityStore` and `RelationStore` are generic at the type level but type-erased at the storage level. The port signature ([`ports/src/entity-store.ts:69-102`](../../ports/src/entity-store.ts)) reads:

```ts
get<TAttrs = unknown>(tenantId, entityType, entityId): Promise<Entity<TAttrs> | null>;
list<TAttrs = unknown>(tenantId, entityType, opts?): Promise<Entity<TAttrs>[]>;
query<TAttrs = unknown>(tenantId, entityType, opts): Promise<Entity<TAttrs>[]>;
```

The caller supplies `TAttrs`. The storage layer holds `Entity<unknown>` — a JSONB column in Postgres, an opaque blob in IndexedDB. No code path verifies that the runtime shape of `attrs` matches what the caller declared. Every implementation bridges the gap with an unsafe cast:

| File | Cast count |
|---|---|
| `adapters/node/src/entity-store.ts:62` | 1 |
| `adapters/node/src/relation-store.ts:31` | 1 |
| `adapters/idb/src/entity-store.ts:46/62` | 2 |
| `adapters/idb/src/relation-store.ts:22` | 1 |
| `modules/identity/test/lib/fixtures.ts` | 5 |
| `apps/server/src/routes/identity-a7.test.ts` | 7 |
| `apps/server/src/middleware/dispatcher-chain.test.ts` | 5 |
| `modules/identity/test/a4/a5/a7-acceptance.test.ts` | ~25 |
| Other consumers | ~5 |

Each one is suppressed with an `eslint-disable` and a `boundary: in-memory EntityStore shim …` / `boundary: per-row JSONB attrs is opaque …` justification. The justifications are honest — they describe exactly what's happening. But the suppressions are a symptom: the port's type signature claims more than the storage can guarantee, and every implementer pays for the lie.

The repo's invariant bar treats every type-safety problem as an error ([`eslint.config.ts:32-37`](../../eslint.config.ts)); the convention of categorized suppressions is the escape hatch. The escape hatch should be reserved for genuine boundaries (third-party libraries, browser DOM, adversarial fixtures) — not for our own port contract.

The port docstring already hints at the intended design:

> The shape of `attrs` is governed by the entity type's registered schema (see `EntityTypeRegistry`).
> Reads pass through the `Upcaster` pipeline … so callers always observe the latest schema version.

That contract is currently advisory. This ADR makes it load-bearing.

## Decision

**`EntityStore` and `RelationStore` reads narrow `unknown` to `TAttrs` via a schema-derived type predicate at the storage boundary. No suppressed cast remains in any adapter or test shim.**

Three concrete changes:

### 1. `Decoder<T>` becomes a first-class primitive

A `Decoder<T>` is `(u: unknown) => u is T` — a TypeScript type predicate. Produced by AJV's typed `compile<T>(schema)`. Used at every storage boundary, it narrows naturally:

```ts
if (!decode(row.attrs)) throw new EntityShapeMismatchError(entityType, entityId);
return row; // row.attrs is now TAttrs, no cast
```

This is the only structurally sound way to discharge the cast: the type system has actual runtime proof that `attrs` matches `TAttrs`.

Lives in `packages/platform-core/src/decoder.ts`. Schema and type are derived from one source via `json-schema-to-ts` (or equivalent) so they cannot drift.

### 2. `EntityTypeRegistry` carries decoders

The registry today pairs `entityType` strings with schemas. Post-ADR it pairs them with `Decoder<TAttrs>` and surfaces the type-level mapping. Each domain module contributes its entity types via a strongly typed contribution map:

```ts
// modules/identity/src/index.ts
export const identityEntityTypes = {
  user: { schema: userSchema, decoder: userDecoder },
  membership: { schema: membershipSchema, decoder: membershipDecoder },
  // …15 types total
} as const satisfies EntityTypeContributions;
```

`apps/server/src/bootstrap.ts` composes module contributions into one registry — the same pattern as `composeRegistries` for handler registries.

### 3. Port methods take the entity type as a load-bearing key, not a label

`EntityStore.get('user', tenantId, id)` returns `Entity<UserAttrs>` — the return type is computed from the literal-string key via the composed registry's type map. No caller-supplied `<TAttrs>` generic, no cast. The same generic-by-key-lookup pattern works for `list`, `query`, and the `RelationStore` analogues.

For uses outside the registry's known types (adversarial tests, fixture authoring), there's an explicit `decodeAttrsAs<T>(schema)` escape hatch that takes a schema and returns a decoder — one suppression line inside that helper, justified by `validator just passed`. That single helper replaces ~50 suppressions across the codebase.

## What this requires us to build (the honest scope)

Six work items, sequenced:

1. **Finish or confirm the `Upcaster` pipeline.** Legacy rows must be normalized to the current schema *before* the decoder sees them, or strict validation breaks reads of pre-existing data. Status of the upcaster work referenced in `ports/src/entity-store.ts:17-20` is unclear and must be audited before this ADR can land.
2. **Author canonical JSON schemas for every persisted `attrs` type.** Identity has ~15 (User, Membership, InviteToken, AuthSession, ApiKey, ServicePrincipal, OAuthToken, IdentityProvider, ScimToken, AuditExportConfig, AuditExportRun, AuthFactor and its TOTP/WebAuthn/RecoveryCode/MfaBypass variants, SamlSpKey, ImpersonationSession, BreakGlassGrant). Catalog, content-pages, authz add more. All schemas use `additionalProperties: false` — otherwise the validated type is wider than declared, and the cast-elimination is a lie.
3. **Build the `Decoder<T>` primitive and AJV typed-compile wiring.** Single module, ~50 LOC. Test bench it on the hottest read path (session lookup in auth middleware) before committing the design.
4. **Change the port signatures.** `EntityStore` and `RelationStore` move from caller-supplied generic to registry-keyed return type. This is the breaking change — every call site updates.
5. **Rewrite three adapters × two stores.** Postgres, IDB, in-memory shim — each replaces its cast with `decode()` + narrowing. Consolidate the duplicated in-memory shims into one canonical `@atlas/test-fixtures` impl while we're here.
6. **Migrate ~50 call sites.** Mostly mechanical: drop the `as Entity<UserAttrs>` casts, drop the `<UserAttrs>` generic arguments, let TS infer from the registry key. The remaining suppressions go to zero in the affected files.

**Estimated effort:** 2–3 weeks for one developer, sequenced as a multi-stage slice (ADR-0008-style). Stage 1 builds the primitive and one schema (User) end-to-end as a thin vertical slice; Stage 2 expands to identity; Stage 3 covers remaining domains.

## Constraints this imposes

1. **Schemas are load-bearing, not advisory.** Adding a field to `UserAttrs` requires touching the JSON schema, or AJV rejects writes containing it. New fields need a paired upcaster if existing rows lack the field. This is the contract — internalize it.
2. **Cache reads re-validate.** The cache stores `unknown`. Either re-validate on cache hit (cheap, safe, recommended) or trust the cache (avoids ~µs/read, but a poisoned cache violates type safety). The default is re-validate; a `trustedReadAfterWrite` variant is available for the narrow case of reading-back-what-we-just-wrote in the same transaction.
3. **The `Upcaster` pipeline must exist and run before validation.** Without it, any schema evolution breaks reads of historical rows. Per [I12](../architecture.md), projections are rebuildable from events — upcasters are how schema-version drift gets normalized during rebuild.
4. **Per-domain entity contributions are typed.** Each module exports its `EntityTypeContributions` map; bootstrap composes them. The composed type flows through to the port instance — `store.get('user', …)` is type-safe end-to-end.
5. **The `decodeAttrsAs<T>(schema)` escape hatch is the only sanctioned cast site.** Adversarial fixtures (`packages/contract-tests/src/event-store.ts:270`, `packages/contract-tests/src/seed-corpus.ts:60`) use it. They keep one categorized suppression each. The 50 we set out to eliminate become zero.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Deduplicate in-memory shims; collapse to ~6 suppressions | The user asked to eliminate, not reduce. Suppressions remain, the type lie remains. |
| Per-domain typed wrappers (`unwrapUserEntity(row)`) hiding the cast | Still ~15 suppressions, one per wrapper. Lie is centralized, not discharged. |
| Drop the generic entirely; return `Entity<unknown>` | Pushes the cast onto every caller. No net improvement. |
| Mandatory decoder argument at every call site (`get(…, decoder)`) | Eliminates the cast but at maximum call-site bulk. The registry-keyed approach gets the same type-safety with terser call sites. |
| Branded `Validated<T>` returned only by decoders | Single cast lives in the brand-producing helper. Still a suppression — the user's bar excludes this. |

The registry-keyed approach wins because the type-level dispatch lives in one place (the composed registry type), the runtime validation lives in one place (the decoder primitive), call sites stay readable, and the cast count goes to zero — not "reduced," not "centralized," not "categorized," but **gone**.

## Consequences

**Positive:**

- **Zero cast suppressions in the storage layer.** The ~50 categorized suppressions we set out to eliminate are removed. The remaining suppressions in the codebase (linkedom, cedar-wasm, postgres.js `Sql`, simplewebauthn) are genuine third-party-library boundaries — the category the escape hatch was designed for.
- **Schema drift is caught at the storage boundary.** Today, a row written before a field was added reads as `Entity<NewUserAttrs>` with the new field silently `undefined` — a runtime bug masked as a type-system success. Post-ADR, the upcaster runs or the decoder rejects.
- **`EntityTypeRegistry` becomes load-bearing infrastructure.** Aligns with the agentic-first tenet — schemas as machine-readable source of truth, used everywhere they're declared to apply.
- **Honesty about what storage knows.** The port no longer claims `Entity<TAttrs>` without proof. This is the bar [`eslint.config.ts:32-37`](../../eslint.config.ts) sets and the bar `boundary:` justifications were a workaround for.

**Negative:**

- **2–3 weeks of focused work.** Not a side-quest; needs to be scheduled as a slice with its own ticket set.
- **Performance cost: ~µs per entity read for AJV validation.** Likely negligible on every observed path, but auth middleware (session lookup on every request) must be benchmarked before the design ships. AJV compiled with `code: { optimize: true }` is the baseline.
- **Schema authorship discipline must be enforced.** ~30 schemas need authoring across the active domains. Each one needs `additionalProperties: false` and a paired upcaster if migrating existing data. This is real work, not a refactor.
- **The `Upcaster` pipeline must be finished if it isn't.** Audit comes first; that may surface its own scope.
- **Breaking change for every `EntityStore` / `RelationStore` consumer.** ~50 call sites update. Mechanical but pervasive.

## Migration plan

Staged, matching the [ADR 0008](0008-atlas-on-atlas.md) pattern:

- **Stage 1 — Foundations (1 week):** `Decoder<T>` primitive, AJV typed-compile wiring, `Upcaster` audit, `User` entity end-to-end as a vertical slice. Benchmark on auth middleware. **Gate:** user reads validate; auth latency p99 unchanged within 1%.
- **Stage 2 — Identity full coverage (1 week):** Schemas + decoders for the remaining ~14 identity entity types, port signature change, adapter rewrites, identity test migration. **Gate:** zero `eslint-disable` for type-erased store casts in `modules/identity/**` or `apps/server/src/routes/identity*.ts`.
- **Stage 3 — Remaining domains + adversarial fixtures (3–5 days):** Catalog, content-pages, authz. The `decodeAttrsAs<T>` escape hatch lands; adversarial-fixture suppressions migrate to use it. **Gate:** zero `eslint-disable` for type-erased store casts platform-wide. `pnpm overseer:check` adds a rule asserting this.
- **Stage 4 — Lock in (1 day):** Overseer rule prohibits new `eslint-disable @typescript-eslint/no-unsafe-type-assertion` with `boundary: in-memory EntityStore shim` / `boundary: per-row JSONB attrs` justifications. The category is closed. Adversarial fixtures route through `decodeAttrsAs<T>`.

Each stage is its own ticket set under `tickets/schema-typed-entity-store/`. Failed gate sends the stage back to its dev; nothing partial merges.

## Open questions

1. **Upcaster pipeline status.** Cited in `ports/src/entity-store.ts:17-20` but not audited recently. Stage 1 starts with a status check; if upcasters are stubs, that scope joins this ADR or splits as a prerequisite ADR.
2. **Cache validation default.** Re-validate on every cache hit, or trust the cache? Default is re-validate; the `trustedReadAfterWrite` exception needs a concrete cache-key naming convention so misuse is hard.
3. **Browser-side validation.** `adapter-idb` consumes the same decoders. AJV bundle size in the browser needs measuring; if it's painful, the IDB adapter may use a lighter-weight validator generated from the same schema (e.g., `ajv/standalone` precompiled output).
4. **Does this ADR open or close the door on tenant-defined entity types?** [ADR 0005](0005-custom-schema-storage-strategy.md) puts tenant types in `atlas_t_<tenantId>` schemas with native DDL. Those types have schemas too — declared by tenants at runtime, not committed to the repo. The decoder primitive must work for both: built-in types compile decoders at boot, tenant types compile decoders at type-declaration time and cache them per-tenant. This is consistent with 0005 but adds runtime-compiled decoder caching as a Stage 3 sub-task.

## Backstop

If Stage 1 reveals the `Upcaster` work is much larger than expected, this ADR pauses and re-emerges as two: a prerequisite ADR on upcaster completion, then the schema-typed store ADR on top. The user's bar (eliminate, not reduce, no cheating) is not relaxed — the work just gets longer.
