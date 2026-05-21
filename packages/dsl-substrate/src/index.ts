/**
 * @atlas/dsl-substrate — shared substrate for every DSL Atlas hosts.
 *
 * Read first: specs/decisions/0007-dsl-substrate-and-authoring-contract.md.
 * This package ships the *Liskov base envelope* (`DslArtifact`), the
 * *purity-by-signature* evaluator interface (`DslEvaluator`), the closed
 * host-op registry contract (`HostOpRegistry`), the substrate-enforced
 * `BudgetTicket`, the `DslError` taxonomy with source ranges, the storage
 * conventions for `_atlas_dsl_<kind>` tables, the `Dsl.<Kind>.Update` intent
 * shape, and the contract-test checker that mechanises ADR 0007 §2's six
 * properties.
 *
 * Concrete DSLs (expression, template, query, formula, …) live in
 * sibling packages (`@atlas/dsl-expression`, …) and depend on this one.
 * The first concrete DSL lands in slice #3 per the plan; the actual
 * evaluator-loop implementation, the `BudgetTicket` factory, and the real
 * `DslConformanceChecker` ship there.
 *
 * Everything in this slice is types and small pure helpers — no runtime
 * evaluator, no HTTP, no I/O.
 */

export type {
  DslArtifact,
  SourceRange,
  SourceMap,
  ArtifactRef,
} from './artifact.ts';
export { isKind } from './artifact.ts';

export type { Result } from './result.ts';
export type {
  DslEvaluator,
  StaticCheckHints,
} from './evaluator.ts';

export type {
  DslError,
  DslErrorCode,
  HostOpError,
} from './errors.ts';

export type {
  BudgetTicket,
  BudgetFactory,
} from './budget.ts';
export { openBudget } from './budget.ts';

export type {
  HostOpDef,
  HostOpSet,
  HostOpRegistry,
  HostOpCategory,
  HostOpContext,
  PortName,
} from './host-ops.ts';

export type { DslUpdatePayload } from './intent.ts';
export { dslUpdateAction } from './intent.ts';

export {
  DSL_TABLE_PREFIX,
  DSL_VERSIONS_TABLE_SUFFIX,
  DSL_KIND_PATTERN,
  DSL_ARTIFACT_COLUMNS,
  dslTableName,
  dslVersionsTableName,
} from './storage.ts';
export type { DslArtifactColumn } from './storage.ts';

export type {
  DslConformanceSample,
  DslConformanceArgs,
  DslConformanceChecker,
  DslConformanceCheckerFactory,
} from './contract-tests.ts';
export {
  stubConformanceChecker,
  makeConformanceChecker,
  ok,
  err,
} from './contract-tests.ts';
