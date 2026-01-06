# Golden Fixtures

This directory contains canonical JSON fixtures that encode the **semantic behavior** of the platform. These fixtures represent the source of truth for system behavior and can be used to validate any implementation for conformance.

## Purpose

Golden fixtures serve three purposes:

1. **Semantic Specification**: They demonstrate the exact shape, fields, and relationships expected by the system
2. **Validation Reference**: They can be used in automated tests to verify conformance
3. **Documentation by Example**: They show concrete instances of abstract schemas

## Fixture Categories

### Event Envelopes

- `valid_event_envelope.json` - Canonical well-formed event with all required fields
- `invalid_event_envelope_missing_idempotency.json` - Demonstrates violation: missing idempotencyKey

**Invariants Encoded:**
- All events MUST have idempotencyKey
- correlationId MUST be preserved across event chains
- causationId MUST reference the causing event's eventId
- tenantId MUST be immutable once set

### Module Manifests

- `sample_module_manifest.json` - Complete module manifest demonstrating all declaration types

**Invariants Encoded:**
- Modules MUST declare all actions, resources, events, projections
- Undeclared capabilities cannot be invoked
- Cache artifacts MUST include tenantId in tags unless explicitly PUBLIC

### Policies

- `sample_policy_bundle.json` - ABAC policy bundle demonstrating deny-overrides-allow

**Invariants Encoded:**
- Deny rules override allow rules (any deny causes denial)
- Default decision is deny if no allow matches
- Policy evaluation is deterministic

### Action → Event Flow

- `sample_page_create_intent.json` - UI intent envelope (user action request)
- `expected_page_created_event.json` - Domain event emitted after authorization

**Invariants Encoded:**
- correlationId propagates from intent to domain event
- causationId in domain event references intent eventId
- idempotencyKey is preserved
- Authorization MUST occur before domain event emission

### Search

- `search_documents.json` - Indexed documents with permission attributes
- `search_query.json` - Search query with execution context
- `expected_search_results_filtered.json` - Results after permission filtering

**Invariants Encoded:**
- Search results MUST be filtered by permissionAttributes
- Documents with null permissionAttributes are public within tenant
- allowedPrincipals is a whitelist (only listed principals can view)
- Cross-tenant documents MUST NOT appear in results

### Analytics

- `analytics_events.json` - Analytics events derived from domain events
- `analytics_query.json` - Time-bucketed aggregation query
- `expected_analytics_buckets.json` - Time-aligned buckets with dimension grouping

**Invariants Encoded:**
- Time buckets are deterministically aligned to epoch + bucketSize
- Dimension values create separate buckets within same time window
- Aggregations are tenant-scoped
- Bucketing is deterministic (same events → same buckets)

## Usage

### In Tests

```typescript
import validEnvelope from './specs/fixtures/valid_event_envelope.json';
import invalidEnvelope from './specs/fixtures/invalid_event_envelope_missing_idempotency.json';

it('accepts valid event envelope', () => {
  const result = validateEnvelope(validEnvelope);
  expect(result.ok).toBe(true);
});

it('rejects envelope without idempotencyKey', () => {
  const result = validateEnvelope(invalidEnvelope);
  expect(result.ok).toBe(false);
  expect(result.error.code).toBe('MISSING_REQUIRED_FIELDS');
});
```

### For Schema Validation

```bash
# Validate fixture against schema
ajv validate -s specs/event_envelope.schema.json -d specs/fixtures/valid_event_envelope.json
```

### For Documentation

Fixtures serve as living documentation. When semantics are unclear, refer to the fixtures for concrete examples.

## Maintenance

- **DO NOT** modify fixtures unless the system's semantic behavior changes
- **DO** add new fixtures when new domain concepts are introduced
- **DO** document invariants inline using `$comment` and `$invariants` fields
- **DO** ensure fixtures remain minimal and focused

## Cross-References

Each fixture references its schema via `$schema` field. See:
- `../event_envelope.schema.json`
- `../module_manifest.schema.json`
- `../policy_ast.schema.json`
- `../cache_policy.schema.json`

For conformance testing, see: `../../docs/conformance.md`
