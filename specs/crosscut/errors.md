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
