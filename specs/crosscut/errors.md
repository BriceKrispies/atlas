# Failure Semantics

This spec defines the **error contract** for Atlas: how failures are represented, propagated, and exposed across system boundaries.

## Purpose

Failure semantics is a distinct spec plane from feature behavior. While feature specs define *what* the system does when things succeed, this spec defines *what* the system guarantees when things fail.

Goals:
- Predictable, machine-readable error responses for clients
- Correlation and traceability for support and debugging
- Security-conscious redaction at public boundaries
- Consistent logging for observability

## Vocabulary

**Internal Error**
A structured error that flows within the system, containing full diagnostic context (cause chain, stack traces, internal identifiers).

**Public Error Response**
A sanitized error representation returned to external clients. Contains correlation IDs for support but excludes internal details.

**Error Code**
A stable, machine-readable identifier for a failure category (e.g., `UNAUTHORIZED`, `RESOURCE_NOT_FOUND`). Defined in `/specs/error_taxonomy.json`.

**Correlation ID**
A request-scoped identifier that links errors to their originating request. Propagated from ingress through all downstream calls.

**Support ID**
An opaque identifier included in public error responses that maps to internal diagnostic records.

## Non-Negotiable Invariants

### INV-ERR-01: Correlation Preservation
Every externally observable error response MUST include a `correlationId` (or `supportId`) that enables support to locate internal logs.

### INV-ERR-02: Boundary Normalization
Errors MUST be normalized at the ingress boundary before being returned to clients. Internal error representations MUST NOT leak through public APIs.

### INV-ERR-03: Redaction
Public error responses MUST NOT include:
- Stack traces
- Internal service names or paths
- Raw database errors or query fragments
- Internal identifiers beyond correlation/support IDs

### INV-ERR-04: Structured Response
All error responses MUST conform to the error envelope schema (when defined). Ad-hoc error formats are prohibited.

### INV-ERR-05: Exactly-Once Boundary Logging
Each error MUST be logged exactly once at the boundary where it becomes externally observable. Internal propagation SHOULD NOT duplicate error logs.

## Error Categories

Error codes are organized into categories. See `/specs/error_taxonomy.json` for the canonical list.

| Category     | Description                                      |
|--------------|--------------------------------------------------|
| VALIDATION   | Input validation failures                        |
| AUTHN        | Authentication failures                          |
| AUTHZ        | Authorization/permission failures                |
| RESOURCE     | Resource existence or state errors               |
| TENANT       | Tenant-scoped access or state errors             |
| PERSISTENCE  | Storage/database failures                        |
| QUOTA        | Rate limiting and quota violations               |
| REGISTRY     | Module/action registry errors                    |
| CACHE        | Cache policy violations                          |

## Seeder Errors

Seed-corpus and scenario-fuzzing operations surface dedicated error codes. The codes below are referenced by [`seed-corpus.md`](seed-corpus.md) §9 and [`scenario-fuzzing.md`](scenario-fuzzing.md) §9.

| Code | Category | Description |
|------|----------|-------------|
| `SEED_SCENARIO_NOT_FOUND` | RESOURCE | `SeedCorpus.loadScenario` called with a `scenarioId` not present in the corpus. |
| `SEED_FIXTURE_NOT_FOUND` | RESOURCE | `SeedCorpus.loadFixture` called with a `fixtureId` not present in the corpus. Distinct from `SEED_SCENARIO_NOT_FOUND` so callers can branch on the missing kind. |
| `SEED_VALIDATION_FAILED` | VALIDATION | A scenario or fixture body failed AJV validation against its `seed.*.v1` schema on load. |
| `SEED_VALIDATOR_NOT_REGISTERED` | REGISTRY | The AJV schema referenced by a `loadScenario` / `loadFixture` call (e.g. `seed.scenario.v1`) is not present in the schema registry. Distinct from `SEED_VALIDATION_FAILED` so callers can branch on tenant-data faults vs. platform-config faults. |
| `SEED_FIXTURE_DEPTH_EXCEEDED` | VALIDATION | `apply:` resolution exceeded the depth limit of 8 — likely a cycle or pathologically deep composition. |
| `SEED_AXIS_RANGE_INVALID` | VALIDATION | A `range`-kind axis violates `step > 0` or `(to - from) % step === 0`. |
| `SEED_AXIS_GENERATOR_UNKNOWN` | VALIDATION | A `generator`-kind axis references an unknown `generatorRef` variant. |
| `SEED_AXIS_ID_PARSE_FAILED` | VALIDATION | `parseAxisId` could not round-trip a materialised `scenarioId`. |

## Artifacts

### Current
- `/specs/error_taxonomy.json` - Canonical error codes and categories
- `/specs/schemas/contracts/error_envelope.schema.json` - JSON Schema for public error responses

### Planned
- `/specs/fixtures/error_*.json` - Golden fixtures for common error scenarios
- Conformance checklist items for error handling

## Open Questions

- Should internal errors include structured cause chains, or just string messages?
- Is there a standard HTTP status code mapping per error category?
- How do async/background job failures surface to users?
- Should retryable vs terminal errors be distinguished in the schema?

## Cross-References

- [Events](events.md) - Error events may flow through the event system
- [Security](security.md) - Redaction requirements align with security posture
- [Tenancy](tenancy.md) - Tenant context in error responses
