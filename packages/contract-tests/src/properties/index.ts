/**
 * Cross-cutting invariant property suites (testing.md §2.2).
 *
 * @spec: specs/crosscut/testing.md#§2.2-invariant-layer
 *
 * One file per universally-quantified invariant. Each exports a
 * `runProperty(adapters)` fast-check evaluates; the `adapters` seam lets the
 * same property run against `adapter-node`, `adapter-idb`, and the broken
 * in-memory adapters in the self-tests. Port contract suites import the
 * overlapping properties:
 *
 *   - EventStore (event-store.ts) imports I3 + I6 + I12.
 *   - Cache (cache.ts) imports I9 + I10.
 *   - PolicyEngine imports none — Cedar evaluation isn't universally
 *     quantified the way these are.
 *
 * The naming differs from `runContract` deliberately: a property is a
 * universal claim evaluated over generated cases, not an example suite.
 */
export {
  runProperty as runI3IdempotencyProperty,
  type I3Adapters,
} from './i3-idempotency.ts';
export {
  runProperty as runI5CorrelationProperty,
  stampCorrelationVerbatim,
  type I5Adapters,
  type RequestEvent,
} from './i5-correlation.ts';
export {
  runProperty as runI6CausationProperty,
  linkCausationByParentId,
  type I6Adapters,
  type ChainNode,
} from './i6-causation.ts';
export {
  runProperty as runI9CacheTenantScopeProperty,
  tenantScopedKey,
  type I9Adapters,
  type CacheKeyParts,
} from './i9-cache-tenant-scope.ts';
export {
  runProperty as runI10CacheInvalidationProperty,
  invalidateByEventTags,
  type I10Adapters,
} from './i10-cache-invalidation.ts';
export {
  runProperty as runI12ProjectionRebuildProperty,
  type I12Adapters,
  type Projector,
} from './i12-projection-rebuild.ts';
export {
  runProperty as runI13QuotaBeforeDispatchProperty,
  quotaCheckedSubmit,
  type I13Adapters,
  type QuotaState,
  type Intent,
  type SubmitResult,
} from './i13-quota-before-dispatch.ts';
export {
  runProperty as runI16SchemaScopeProperty,
  scopedMutateSchema,
  ALLOWED_DDL,
  FORBIDDEN_DDL,
  tenantDbName,
  type I16Adapters,
  type World,
  type SchemaMutation,
  type MutationResult,
} from './i16-schema-scope.ts';

export {
  runConfig,
  extractCounterexampleFixture,
  counterexampleFixturePath,
  DEFAULT_RUNS,
  SOAK_RUNS,
  FIXTURE_DIR,
  type CounterexampleFixture,
} from './_harness.ts';
