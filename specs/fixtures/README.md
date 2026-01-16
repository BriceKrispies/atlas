# Golden Fixtures

This directory contains canonical JSON fixtures that encode the **semantic behavior** of the platform. These fixtures represent the source of truth for system behavior and can be used to validate any implementation for conformance.

## Purpose

Golden fixtures serve three purposes:

1. **Semantic Specification**: They demonstrate the exact shape, fields, and relationships expected by the system
2. **Validation Reference**: They can be used in automated tests to verify conformance
3. **Documentation by Example**: They show concrete instances of abstract schemas

## Filename Convention

Validatable fixtures follow a strict naming convention:

```
<kind>__<expect>__<name>.json
```

Where:
- `kind` is one of: `event_envelope`, `module_manifest`, `search_documents`, `analytics_events`
- `expect` is one of: `valid`, `invalid`
- `name` is a freeform identifier (no double underscores allowed)

Examples:
- `event_envelope__valid__canonical.json`
- `event_envelope__invalid__missing_idempotency.json`
- `module_manifest__valid__content_pages.json`

Files not matching this convention are ignored by the validator but may still serve as documentation (e.g., query/result fixtures).

## Validation Tool

The `spec_validate` tool validates fixtures against `atlas_core` domain types and semantic rules:

```bash
# Validate all fixtures
cargo run -p atlas-platform-spec-validate

# List discovered fixtures
cargo run -p atlas-platform-spec-validate -- --list

# Filter by kind
cargo run -p atlas-platform-spec-validate -- --kind event_envelope

# Filter by expectation
cargo run -p atlas-platform-spec-validate -- --expect invalid

# Show help
cargo run -p atlas-platform-spec-validate -- --help
```

## Fixture Categories

### Event Envelopes

- `event_envelope__valid__canonical.json` - Canonical well-formed event with all required fields
- `event_envelope__valid__page_create_intent.json` - UI intent envelope (user action request)
- `event_envelope__valid__page_created_event.json` - Domain event emitted after authorization
- `event_envelope__invalid__missing_idempotency.json` - Demonstrates violation: missing idempotencyKey

**Invariants Encoded:**
- All events MUST have idempotencyKey (I3)
- eventType MUST follow Module.EventName pattern
- schemaVersion MUST be >= 1
- correlationId MUST be preserved across event chains
- causationId MUST reference the causing event's eventId
- tenantId MUST be immutable once set

### Module Manifests

- `module_manifest__valid__content_pages.json` - Complete module manifest demonstrating all declaration types

**Invariants Encoded:**
- Modules MUST declare all actions, resources, events, projections
- Action resourceTypes MUST reference declared resources
- Event types MUST follow Module.EventName pattern
- Cache artifacts MUST have positive TTL
- Undeclared capabilities cannot be invoked

### Search Documents

- `search_documents__valid__sample.json` - Indexed documents with permission attributes

**Invariants Encoded:**
- Documents MUST have documentId, documentType, tenantId
- documentIds MUST be unique within a batch
- Search results MUST be filtered by permissionAttributes
- Documents with null permissionAttributes are public within tenant

### Analytics Events

- `analytics_events__valid__sample.json` - Analytics events derived from domain events

**Invariants Encoded:**
- Events MUST have eventId, eventType, tenantId, schemaId
- eventType MUST follow Module.event_name pattern
- eventIds MUST be unique within a batch

### Non-Validatable Fixtures

These fixtures document query/result semantics but are not domain types:

- `search_query.json` - Search query with execution context
- `expected_search_results_filtered.json` - Results after permission filtering
- `analytics_query.json` - Time-bucketed aggregation query
- `expected_analytics_buckets.json` - Time-aligned buckets with dimension grouping
- `sample_policy_bundle.json` - Cedar policy bundle demonstrating deny-overrides-allow

## Documentation Fields

Fixtures may include metadata fields prefixed with `$`:
- `$schema` - Reference to the JSON schema file
- `$comment` - Human-readable explanation
- `$invariants` - Platform invariants this fixture demonstrates
- `$explanation` - Reasoning for expected results

These fields are automatically stripped during validation.

## Usage

### In Tests

```typescript
import validEnvelope from './specs/fixtures/event_envelope__valid__canonical.json';
import invalidEnvelope from './specs/fixtures/event_envelope__invalid__missing_idempotency.json';

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

### For Documentation

Fixtures serve as living documentation. When semantics are unclear, refer to the fixtures for concrete examples.

## Maintenance

- **DO NOT** modify fixtures unless the system's semantic behavior changes
- **DO** add new fixtures when new domain concepts are introduced
- **DO** document invariants inline using `$comment` and `$invariants` fields
- **DO** ensure fixtures remain minimal and focused
- **DO** follow the naming convention for validatable fixtures

## Cross-References

Each fixture references its schema via `$schema` field. See:
- `../schemas/contracts/event_envelope.schema.json`
- `../schemas/contracts/module_manifest.schema.json`
- `../schemas/contracts/policy_ast.schema.json`
