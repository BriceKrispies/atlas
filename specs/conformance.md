# Conformance Checklist

This document provides a **semantic checklist** for validating any implementation of the platform against the core invariants. Each invariant references the artifacts that define it and states what must be proven for conformance.

## Purpose

This checklist ensures that:
1. **Meaning is preserved** across reimplementations
2. **Invariants are testable** and verifiable
3. **Breaking changes are detected** via fixture validation

## How to Use This Document

For each invariant:
- **Defined by**: Lists schemas and fixtures that encode the rule
- **Proven by**: Lists tests or expected behaviors that validate enforcement
- **Conformance Test**: Describes what any implementation must demonstrate

---

## I1: Single Ingress Enforcement

**Statement**: All external requests MUST enter through a single ingress chokepoint that performs validation, authorization, and routing.

**Defined by**:
- Architecture: `docs/architecture.md` (Hexagonal Architecture section)
- Fixture: `specs/fixtures/sample_page_create_intent.json` (shows intent structure before authorization)
- Schema: `specs/event_envelope.schema.json` (defines envelope structure)

**Proven by**:
- Test: `packages/ingress/src/handlers/__tests__/validation.test.ts` - validates envelope structure
- Test: `packages/ingress/src/handlers/__tests__/authorization.test.ts` - proves auth happens at ingress
- Expected behavior: Malformed requests are rejected before reaching domain handlers

**Conformance Test**:
Any implementation must demonstrate that:
1. Direct invocation of domain handlers is not possible from external callers
2. All requests pass through validation pipeline before execution
3. Invalid envelopes (missing required fields) are rejected with error code

---

## I2: Authorization Precedes Execution

**Statement**: Authorization MUST occur before any domain state mutation or side effect.

**Defined by**:
- Architecture: `docs/architecture.md` (Core Invariants I2)
- Fixture: `specs/fixtures/sample_page_create_intent.json` → `specs/fixtures/expected_page_created_event.json` (shows intent → event flow after authz)
- Fixture: `specs/fixtures/sample_policy_bundle.json` (defines ABAC policies)

**Proven by**:
- Test: `packages/core/src/authz/__tests__/policy-engine.test.ts` - proves policy evaluation
- Test: `packages/ingress/src/handlers/__tests__/authorization.test.ts` - proves authz-before-execute
- Expected behavior: Unauthorized actions never emit domain events

**Conformance Test**:
Any implementation must demonstrate that:
1. Unauthorized intents do not produce domain events
2. Authorization failures return 403 with policy violation reason
3. No side effects (DB writes, event emissions, cache updates) occur before authz check passes

---

## I3: Idempotency Before Execution

**Statement**: Duplicate idempotencyKey MUST NOT reapply state mutations. Second invocation returns cached result.

**Defined by**:
- Architecture: `docs/architecture.md` (Core Invariants I3)
- Fixture: `specs/fixtures/valid_event_envelope.json` (shows required idempotencyKey)
- Fixture: `specs/fixtures/invalid_event_envelope_missing_idempotency.json` (shows violation)
- Schema: `specs/event_envelope.schema.json` (requires idempotencyKey field)

**Proven by**:
- Test: `packages/core/src/__tests__/idempotency.test.ts` - proves duplicate key detection
- Expected behavior: Second invocation with same idempotencyKey returns cached response without re-executing

**Conformance Test**:
Any implementation must demonstrate that:
1. Envelopes without idempotencyKey are rejected
2. Second invocation with same idempotencyKey returns cached result
3. No duplicate domain events are emitted for duplicate idempotencyKey
4. Response includes metadata indicating cache hit

---

## I4: Deny-Overrides-Allow Authorization

**Statement**: Any DENY rule overrides all ALLOW rules. Default decision is DENY if no ALLOW matches.

**Defined by**:
- Architecture: `docs/architecture.md` (Core Invariants I4)
- Fixture: `specs/fixtures/sample_policy_bundle.json` (demonstrates deny-overrides-allow with sample policies)
- Schema: `specs/policy_ast.schema.json` (defines policy structure)

**Proven by**:
- Test: `packages/core/src/authz/__tests__/policy-engine.test.ts` - proves deny-overrides-allow semantics
- Expected behavior: User with both allow and deny rules is denied

**Conformance Test**:
Any implementation must demonstrate that:
1. If any DENY rule matches, authorization fails regardless of ALLOW rules
2. If no ALLOW rule matches, authorization fails (default deny)
3. Only when ALLOW matches and no DENY matches does authorization succeed
4. Policy evaluation is deterministic (same input → same output)

---

## I5: Correlation Propagation

**Statement**: correlationId MUST propagate unchanged through entire event chain.

**Defined by**:
- Architecture: `docs/architecture.md` (Core Invariants I5)
- Fixture: `specs/fixtures/sample_page_create_intent.json` → `specs/fixtures/expected_page_created_event.json` (shows correlationId propagation)
- Fixture: `specs/fixtures/analytics_query.json` (shows correlationId in execution context)
- Schema: `specs/event_envelope.schema.json` (defines correlationId field)

**Proven by**:
- Test: `packages/core/src/__tests__/event-chain.test.ts` - validates correlation propagation
- Expected behavior: All events in a chain share the same correlationId

**Conformance Test**:
Any implementation must demonstrate that:
1. Domain events inherit correlationId from triggering intent
2. Derived events (analytics, projections) preserve correlationId
3. Cross-service calls propagate correlationId in headers/metadata
4. Query results for a correlationId return all related events

---

## I6: Causation Linkage

**Statement**: causationId MUST reference the eventId of the immediate causing event.

**Defined by**:
- Architecture: `docs/architecture.md` (Core Invariants I6)
- Fixture: `specs/fixtures/sample_page_create_intent.json` → `specs/fixtures/expected_page_created_event.json` (shows causationId = intent.eventId)
- Schema: `specs/event_envelope.schema.json` (defines causationId field)

**Proven by**:
- Test: `packages/core/src/__tests__/event-chain.test.ts` - validates causation linkage
- Expected behavior: Event graph is traversable via causationId → eventId links

**Conformance Test**:
Any implementation must demonstrate that:
1. Domain events set causationId to triggering intent's eventId
2. Derived events set causationId to source domain event's eventId
3. Causation chain is acyclic and forms a valid DAG
4. Event replay can reconstruct causation graph

---

## I7: Tenant Isolation in Search

**Statement**: Search results MUST NEVER include documents from other tenants.

**Defined by**:
- Architecture: `docs/architecture.md` (Core Invariants I7)
- Fixture: `specs/fixtures/search_documents.json` → `specs/fixtures/expected_search_results_filtered.json` (shows cross-tenant documents excluded)
- Fixture: `specs/fixtures/search_query.json` (shows executionContext.tenantId)
- Schema: `specs/search_document.schema.json` (defines tenantId field)

**Proven by**:
- Test: `packages/search/src/__tests__/tenant-isolation.test.ts` - proves cross-tenant isolation
- Expected behavior: Documents with different tenantId never appear in results

**Conformance Test**:
Any implementation must demonstrate that:
1. Search index partitions by tenantId
2. Query execution filters by executionContext.tenantId
3. Even with intentionally crafted queries, cross-tenant documents are unreachable
4. Admin queries with special privileges still respect tenant boundaries

---

## I8: Permission-Filtered Search

**Statement**: Search results MUST be filtered by permissionAttributes. Documents are returned only if requester has access.

**Defined by**:
- Architecture: `docs/architecture.md` (Core Invariants I8)
- Fixture: `specs/fixtures/search_documents.json` → `specs/fixtures/expected_search_results_filtered.json` (shows permission filtering in action)
- Fixture: `specs/fixtures/search_query.json` (shows principalId in executionContext)
- Schema: `specs/search_document.schema.json` (defines permissionAttributes structure)

**Proven by**:
- Test: `packages/search/src/__tests__/permission-filtering.test.ts` - proves permission-based filtering
- Expected behavior: Documents with allowedPrincipals list exclude non-listed users

**Conformance Test**:
Any implementation must demonstrate that:
1. Documents with null permissionAttributes are public within tenant
2. Documents with allowedPrincipals list are visible only to listed principals
3. Permission filtering is enforced at query execution (not post-fetch)
4. Permission changes reflect in search results without manual reindexing

---

## I9: Cache Keys Include TenantId

**Statement**: All cache keys MUST include tenantId unless explicitly marked PUBLIC to prevent cross-tenant cache pollution.

**Defined by**:
- Architecture: `docs/architecture.md` (Core Invariants I9)
- Fixture: `specs/fixtures/sample_module_manifest.json` (shows cacheArtifacts with tenantId in tags)
- Schema: `specs/module_manifest.schema.json` (defines cacheArtifacts structure)
- Schema: `specs/cache_policy.schema.json` (defines varyBy and tags)

**Proven by**:
- Test: `packages/core/src/cache/__tests__/key-generation.test.ts` - validates cache key includes tenantId
- Expected behavior: Cache artifacts for different tenants have different keys

**Conformance Test**:
Any implementation must demonstrate that:
1. Cache keys automatically include tenantId dimension
2. PUBLIC cache artifacts explicitly document why they're safe to share
3. Cache get/set operations partition by tenantId
4. Cache invalidation cannot affect other tenants' cached data

---

## I10: Event-Driven Cache Invalidation

**Statement**: Cache invalidation MUST be triggered by domain events via tags. Manual invalidation is prohibited.

**Defined by**:
- Architecture: `docs/architecture.md` (Core Invariants I10)
- Fixture: `specs/fixtures/sample_module_manifest.json` (shows cacheArtifacts with invalidateOnEvent)
- Schema: `specs/cache_policy.schema.json` (defines invalidateOnEvent rules)

**Proven by**:
- Test: `packages/core/src/cache/__tests__/invalidation.test.ts` - proves event-driven invalidation
- Expected behavior: Domain event triggers cache invalidation for matching tags

**Conformance Test**:
Any implementation must demonstrate that:
1. Domain events trigger invalidation for all cache artifacts with matching tags
2. Tag matching is exact (no partial matches unless explicitly designed)
3. Invalidation is idempotent (multiple events with same tag safe)
4. Cache artifact manifests declare all invalidation triggers upfront

---

## I11: Deterministic Time Bucketing (Analytics)

**Statement**: Analytics buckets MUST be aligned to epoch + bucketSize deterministically. Same events + query → same buckets.

**Defined by**:
- Architecture: `docs/architecture.md` (Core Invariants I11)
- Fixture: `specs/fixtures/analytics_events.json` → `specs/fixtures/expected_analytics_buckets.json` (shows deterministic bucketing)
- Fixture: `specs/fixtures/analytics_query.json` (defines bucketSize: "5m")
- Schema: `specs/analytics_query.schema.json` (defines aggregation parameters)

**Proven by**:
- Test: `packages/analytics/src/__tests__/time-bucketing.test.ts` - proves deterministic bucketing
- Expected behavior: Events at 12:03 and 12:04 both land in 12:00-12:05 bucket

**Conformance Test**:
Any implementation must demonstrate that:
1. Bucket boundaries are aligned to epoch (not query time or first event)
2. Same events produce same buckets on repeated queries
3. Dimension values create separate buckets within same time window
4. Bucketing algorithm is documented and verifiable

---

## I12: Projections Are Rebuildable

**Statement**: Projections MUST be rebuildable from event stream. No essential state exists only in projections.

**Defined by**:
- Architecture: `docs/architecture.md` (Core Invariants I12, Event-Driven CQRS section)
- Fixture: `specs/fixtures/expected_page_created_event.json` (shows domain event as source of truth)
- Schema: `specs/projection_manifest.schema.json` (defines projection structure)

**Proven by**:
- Test: `packages/projections/src/__tests__/rebuild.test.ts` - proves projection rebuild from events
- Expected behavior: Dropping projection and replaying events produces identical state

**Conformance Test**:
Any implementation must demonstrate that:
1. Projection can be dropped and rebuilt from event stream
2. Rebuilt projection matches original (deterministic application)
3. No writes to projection tables outside of event handlers
4. Projection rebuild is a supported operational procedure

---

## Validation Procedure

To validate conformance:

1. **Schema Validation**: All fixtures must validate against their referenced schemas
   ```bash
   pnpm test:schemas  # Validates fixtures against JSON schemas
   ```

2. **Test Execution**: All referenced tests must pass
   ```bash
   pnpm test  # Runs full test suite
   ```

3. **Fixture Compatibility**: Implementation must accept all valid fixtures and reject invalid ones
   ```bash
   pnpm test:fixtures  # Tests runtime behavior against golden fixtures
   ```

4. **Invariant Proofs**: Each conformance test must be demonstrable via automated test or manual procedure

---

## Artifact Cross-Reference

| Artifact Type | Location | Purpose |
|--------------|----------|---------|
| Schemas | `specs/*.schema.json` | Define structure and validation rules |
| Golden Fixtures | `specs/fixtures/*.json` | Encode semantic behavior examples |
| Architecture | `docs/architecture.md` | Document invariants and design decisions |
| Tests | `packages/*/src/__tests__/` | Prove invariant enforcement |
| Conformance | `docs/conformance.md` | Checklist for validation |

---

## Maintenance

- **DO NOT** modify this checklist unless system semantics change
- **DO** add new invariants when new domain rules are introduced
- **DO** update artifact references if files are moved
- **DO** ensure bidirectional traceability (invariant ↔ fixture ↔ test)

---

## Future Implementations

Any reimplementation (in Rust, Go, Java, etc.) MUST:
1. Pass all conformance tests listed above
2. Accept all golden fixtures in `specs/fixtures/` as valid inputs
3. Reject all invalid fixtures with appropriate error codes
4. Preserve all 12 core invariants

The quality bar is: **Another team could reimplement the system from these artifacts alone without loss of meaning.**
