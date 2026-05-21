/**
 * Typed host-operation registry. The only side-effect escape from a DSL
 * (ADR 0007 §6).
 *
 * Two categories:
 *   - **Pure** host ops execute in-process with no I/O. `escape`, `format`,
 *     arithmetic primitives, `len`, `upper`. No port required.
 *   - **Effectful** host ops route through an existing platform port:
 *     `lookup` → `EntityStore`; `function(name, args)` → `FunctionRuntime`.
 *     The compiler refuses an effectful op without a `port`.
 *
 * The set is *closed* per DSL kind (ADR 0007 §6). Adding a host op is a
 * spec change; removing one is a breaking change handled by the versioning
 * rules in §7. There is no way for a DSL author to spell HTTP egress —
 * the port doesn't exist (intentional, I15).
 *
 * Liskov note: `HostOpDef` is generic over its arg-tuple and output type,
 * but the *registry* is a uniform map of named ops. Cross-DSL consumers
 * (atlasctl listing the host ops for a kind, the audit emitter logging
 * which ops a particular evaluation called) work at `HostOpRegistry<HostOpSet>`
 * — they don't need the per-op types.
 */

import type { Result } from './result.ts';
import type { HostOpError } from './errors.ts';

/**
 * Closed string-literal union over the platform ports an effectful host
 * op may route through. Extending this requires a new port plus updating
 * this union; both land via spec + ADR review. There is intentionally
 * no `'Http'` entry — see I15.
 */
export type PortName = 'EntityStore' | 'SchemaDefinitionStore' | 'FunctionRuntime';

/**
 * Host-op category. Substrates and audit emitters key on this to decide
 * whether an evaluation can hit the in-process fast path or needs to go
 * through the port boundary.
 */
export type HostOpCategory = 'pure' | 'effectful';

/**
 * Per-evaluation context the substrate threads into every host-op call.
 * Fields are deliberately minimal — anything else a host op needs lives
 * in `scope` (the evaluator's per-call scope, see `./evaluator.ts`) or
 * is closed over at registration time when the platform composes a
 * tenant-scoped registry.
 */
export interface HostOpContext {
  readonly tenantId: string;
  readonly correlationId: string;
  /**
   * Frozen evaluation timestamp (ISO-8601). Host ops like `now()` MUST
   * read from this rather than ambient `Date.now()` so the determinism
   * property holds across re-evaluations of the same artifact.
   */
  readonly frozenNow: string;
}

/**
 * One host-op definition. `TArgs` is the tuple of typed arguments the DSL
 * grammar passes in; `TOut` is the returned value. `invoke` returns a
 * `Result<TOut, HostOpError>` — no throws.
 */
export interface HostOpDef<TArgs extends ReadonlyArray<unknown>, TOut> {
  readonly name: string;
  readonly category: HostOpCategory;
  /**
   * Required when `category === 'effectful'`. `null` only when `category
   * === 'pure'`. The substrate's contract-test checker enforces this at
   * registration time (see `./contract-tests.ts`).
   */
  readonly port: PortName | null;
  invoke(args: TArgs, ctx: HostOpContext): Promise<Result<TOut, HostOpError>>;
}

/**
 * The shape every DSL's typed registry conforms to. Concrete DSLs narrow
 * this with their actual op set — see the expression DSL's `ExprOps` in
 * slice #3 for the worked example.
 *
 * The `Record` value type uses `unknown` rather than `any` so consumers
 * that don't know the specific shape can still walk the registry (e.g.
 * for `list()` introspection) without disabling type-checking.
 */
export type HostOpSet = Readonly<Record<string, HostOpDef<ReadonlyArray<unknown>, unknown>>>;

/**
 * Registry around a typed host-op set. Carries the DSL `kind` for
 * introspection, exposes the typed `ops` for the evaluator, and ships a
 * `list()` for atlasctl-side display of "what can this DSL kind do."
 */
export interface HostOpRegistry<TOps extends HostOpSet> {
  readonly kind: string;
  readonly ops: TOps;
  /**
   * Substrate-friendly view of the closed set. Returns a snapshot —
   * mutation isn't possible because the registry is closed at construction
   * time (per ADR 0007 §6 "closed-set property").
   */
  list(): ReadonlyArray<{
    readonly name: string;
    readonly category: HostOpCategory;
    readonly port: PortName | null;
  }>;
}
