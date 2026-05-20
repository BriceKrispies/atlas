# 0008 — Atlas-on-Atlas: the platform is a tenant of itself

**Status:** Accepted (2026-05-09)
**Amends:** [`0003-tenant-defined-data-model-pivot.md`](0003-tenant-defined-data-model-pivot.md). 0003 said "the chassis is what tenants get for free"; this ADR says "the chassis runs on the same chassis." The directional commitments of 0003 (tenant-defined data model, agentic-first, open public signup, software-anyone-can-self-host) all stand. This ADR records the recursive-kernel principle that follows from them.

## Context

ADR 0003 framed Atlas as a fabric where "every tenant gets identity / authz / audit / observability / search for free, by virtue of being a tenant." A directional question 0003 left open: **does that uniformity apply to Atlas's own platform-level operations, or is the control plane a categorically different layer?** Today's code answers "different layer" by accident — through magic strings, sentinel principals, and bootstrap code that creates platform state outside the same machinery any tenant would use.

A read-only audit (2026-05-09, three Explore agents) surfaced the gap concretely:

- **`_platform` is a magic string.** It appears as a literal `tenantId` across `modules/identity/src/index.ts:4`, `apps/server/src/middleware/role-check.ts:45`, `apps/server/src/routes/identity-a7.test.ts` (28+ literals), and a quotas capability spec. **No row in `control_plane.tenants` named `_platform` is ever created** — every code path that mentions it agrees on the slug, but nothing makes it real.
- **System-initiated events use `principalId: null` as a sentinel.** Signup, OAuth callback, JIT provisioning, password-login (`apps/server/src/routes/{signup,oauth,identity}.ts`, `modules/identity/src/handlers/{jit-provision,password-login}.ts`) all emit events with no actor. There is no first-class "platform robot" identity.
- **Four hexagon leaks** put domain code outside the ports it should be reaching through:
  1. `modules/identity` reaches `node:crypto`, `node:zlib`, and `process.env['IDENTITY_ENCRYPTION_KEY']` directly.
  2. `modules/identity/src/policies/role-packs.ts:26` imports `ManifestAction` from `@atlas/adapter-policy-cedar` — a direct module → adapter arrow.
  3. `modules/repository` and `modules/tenancy` use `node:crypto`/`node:buffer` and `console.log` directly.
  4. No ports exist for audit-emit, metrics, secrets, or runtime config — these are hand-stitched in `apps/server/src/middleware/state.ts:393–404` or scattered across packages.
- **The test seam audit was reassuring.** ~120 of ~145 `.test.ts` files are already port-seam clean (`packages/contract-tests/`, `modules/identity/test/lib/fixtures.ts`); ~16 brittle tests encode the current `_platform` literal and will fail loudly at exactly the seams that have to change.

The user's working hypothesis — *"keep all unit tests; model everything through ports and adapters; tests still pass after the restructure"* — is broadly correct. The restructure is staged, not rewrite-the-world.

## Decision

### 1. The recursive-kernel principle

Atlas's own admin / identity / authz / audit operations run through the same primitives any tenant uses. The platform is a row in `control_plane.tenants`, not a categorically different layer.

The platform-tenant slug stays `_platform` for back-compat — renaming to `atlas` is plausible but adds migration cost without semantic gain. Reconsider only if rename clarity outweighs the churn.

### 2. What stays code, what becomes data

The **kernel** is the irreducible runtime — `packages/ingress` (request lifecycle: authn → tenant → schema → idempotency → authz → handler dispatch → event append → dispatch chain), event-log append, projection-rebuild loop, policy-evaluation entry. These stay code.

Everything else is a data candidate, evaluated case-by-case: schemas (per [ADR 0005](0005-custom-schema-storage-strategy.md)), policies (already data via Cedar), intents-routing, surface manifests, event-type registry. New behavior asks first **"could this have been data?"** before reaching for a code change.

### 3. The four hexagon leaks (must-plug-first)

Each is a slice owned by `port-adapter-dev` under the relevant platform-owner; they unblock the rest of the restructure:

| Leak | Target port(s) | Owner |
|------|----------------|-------|
| `node:crypto` / `process.env` in `modules/identity` | `ports/src/crypto.ts`, `ports/src/secret-store.ts` | `spine-owner` |
| `ManifestAction` imported from `@atlas/adapter-policy-cedar` | `ports/src/policy-manifest.ts` (lift the type) | `spine-owner` |
| `console.log` in tenancy / repository / content-pages | `ports/src/logger.ts` | `observability-architect` + `spine-owner` |
| No ports for audit-emit / metrics | `ports/src/audit-emitter.ts`, `ports/src/metrics-sink.ts` | `spine-owner` |

### 4. Test reuse contract

Port-seam tests are the regression net. `packages/contract-tests/` (run against both `adapter-node` and `adapter-idb`) and the `modules/identity/test/lib/fixtures.ts` in-memory triple are load-bearing — every new port added during the restructure gets a contract suite, and both adapters must pass it.

~16 brittle tests are scheduled for refactor as their own slice once `_platform` becomes a real tenant row. They are already enumerated in the audit (`apps/server/src/routes/identity-a7.test.ts` is the largest offender). They fail at exactly the seams that have to change — which is what a regression net is for.

### 5. Adapter parity decision

`adapter-idb` is **scoped to tenant-app data, not full Atlas-in-browser** for v1. Today's IDB gaps (no `Mailer`, `PolicyEngine`, `CustomDomainStore`, `EntityTypeRegistry`, `SignupRequestStore`, `TenantStore`, `PolicyStore`) are intentional, not technical debt. Documented here so future capability scoping does not apologize for them.

Full Atlas-in-browser (every port has a working IDB impl, the entire control plane runs locally) remains an aspirational stretch — pursue when a concrete user need lands, not before.

## What this ADR does *not* change from 0003

The following 0003 calls stand:

- **Open public signup, agentic-first, single ingress (I1), tiny core** all stand. This ADR doesn't relax any of them.
- **The Extensibility platform's `custom-schema` + `functions` work** proceeds independently per [ADR 0004](0004-platform-invariants-for-multi-tenant-fabric.md) (I13–I18 + REQ rules), [ADR 0005](0005-custom-schema-storage-strategy.md) (db-per-tenant; revised 2026-05-20 — the `_platform` tenant gets its own database, `atlas_t__platform`, just like every other tenant, which strengthens this ADR's recursive-kernel shape), [ADR 0006](0006-function-runtime-substrate.md) (gVisor), and [ADR 0007](0007-dsl-substrate-and-authoring-contract.md) (DSL substrate). None of those decisions are reopened.
- **The 7-platform domain map** stays as 0002/0003 set it.

## Consequences

**Positive:**

- **Enforceable platform-tenant equivalence** — fewer special cases for "the platform" because there is no special platform layer. Every tenant operation, including Atlas's own admin, walks the same middleware chain and emits the same audit shape.
- **Eliminates `principalId: null` sentinels** — system-initiated events get a real `PlatformRobotPrincipal`. Audit and authz become uniform.
- **Discharges ADR 0003 deferred items** — line 93 ("platform-owner agent for Extensibility") and line 104 ("Add a platform-owner agent for Extensibility once the first capability is scoped") are addressed by the new `extensibility-owner` agent shipped with this ADR.
- **The hexagon gets actually clean** — closing the four leaks makes `modules/*` runnable in any environment that satisfies the ports, which is a precondition for the simulator and for any future runtime swap.

**Negative:**

- **~16 brittle test refactors** — every test that hardcodes `'_platform'` (largest offender: `apps/server/src/routes/identity-a7.test.ts` with 28+ literals) needs a `getPlatformTenantId()` indirection.
- **Multi-stage rollout window** — between Stage 1 (leaks plugged) and Stage 2 (`_platform` row exists), the codebase has both the magic string and the real row. Care needed not to ship a partial.
- **Discoverability cost** — "the platform is just another tenant" is initially less obvious to newcomers than "the platform is the platform." Mitigated by `vision.md` and CLAUDE.md updates.

**Out of scope for this ADR:**

- **Implementing any of the staged work** — this ADR records the principle and the order; the slices land separately under the slice workflow.
- **Full Atlas-in-browser** — Decision §5 documents the v1 scope; the stretch goal is not committed.
- **Reorganizing modules into platform folders** — orthogonal to Atlas-on-Atlas; defer.
- **Hot-reload of arbitrary code paths** — Stage 6 (`crosscut/always-on.md`) will set the "what counts as restart-required" bar; this ADR does not pre-decide it.
- **Multi-replica / leader-election rework of `AppState` singletons** — `bootstrap.ts:159` self-acknowledged this debt; tracked separately.

## Migration

This ADR is spec-only. Concretely:

1. **This PR:** ADR 0008 + new [`extensibility-owner`](../../.claude/agents/extensibility-owner.md) agent + amendments to [`vision.md`](../vision.md), root [`CLAUDE.md`](../../CLAUDE.md), and [`specs/CLAUDE.md`](../CLAUDE.md).
2. **Stage 1 (next):** Plug the four hexagon leaks — six new ports under `ports/src/` (`crypto`, `secret-store`, `logger`, `audit-emitter`, `metrics-sink`, `policy-manifest`), with `adapter-node` + `adapter-idb` impls and contract tests. One slice per port, owned by `port-adapter-dev`.
3. **Stage 2:** Make `_platform` a real `control_plane.tenants` row. Bootstrap seed; replace string literal with `PLATFORM_TENANT_ID` constant; introduce `PlatformRobotPrincipal` and eliminate `principalId: null` sentinels.
4. **Stage 3:** Refactor the ~16 brittle tests. Replace hardcoded `'_platform'` with `getPlatformTenantId()` from a shared test helper.
5. **Stage 5 / 6:** Extract `packages/dispatch-chain` (consolidate the `state.ts:318–340` ↔ `tenant-loop.ts` duplication). Write `crosscut/always-on.md` capturing the "what counts as restart-required" bar — **Stage 6 spec drafted at [`crosscut/always-on.md`](../crosscut/always-on.md) (2026-05-10)**; the staged implementation phases land per its §6.

Stage 4 (adapter parity decision) is recorded in §5 of this ADR — no further migration step.

No code changes in this PR.
