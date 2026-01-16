# Controller Client: atlasctl

This spec defines the architectural constraints and invariants for `atlasctl`, the operator/controller client for the Atlas platform.

**(Planned)** — The `atlasctl` binary does not exist yet. This spec defines the contract that any implementation must satisfy.

## Purpose

`atlasctl` provides a consistent, scriptable interface for operators to interact with a running Atlas deployment. It enables:

- Health checks and service status queries
- Discovery of tenants, modules, actions, schemas, and policies
- Intent submission with correlation tracking
- Distributed tracing and debugging
- Authorization decision inspection

The client eliminates the need for ad-hoc scripts or direct database queries, ensuring all operator actions flow through the same enforcement points as user requests.

## Non-Goals

`atlasctl` is NOT:

- A replacement for the `atlas` CLI (`tools/cli`), which handles development scaffolding
- A database migration tool (use `make db-migrate` or control plane APIs)
- A log aggregation viewer (use Grafana, Loki, or other observability tooling)
- A configuration management system (configuration is managed via control plane APIs)
- A deployment orchestrator (deployments are handled by infrastructure tooling)

## Architectural Position

`atlasctl` occupies the **external client** position in the Atlas architecture:

```
                     ┌─────────────────────────────────────────┐
                     │           Atlas Platform                │
                     │                                         │
  ┌──────────┐       │  ┌─────────┐       ┌──────────────┐   │
  │ atlasctl │──HTTP─┼─►│ Ingress │──────►│ Tenant       │   │
  └──────────┘       │  └─────────┘       │ Runtime      │   │
                     │        │            └──────────────┘   │
                     │        │                               │
                     │  ┌─────▼─────┐     ┌──────────────┐   │
                     │  │ Control   │────►│ Control Plane│   │
                     │  │ Plane API │     │ Database     │   │
                     │  └───────────┘     └──────────────┘   │
                     └─────────────────────────────────────────┘
```

`atlasctl` is a pure HTTP client that communicates exclusively through:

1. **Ingress** — For tenant-scoped operations (intent submission, queries)
2. **Control Plane API** — For platform-level operations (tenant listing, module discovery, policy inspection)

## Invariants

### INV-CTL-01: HTTP Client Only

`atlasctl` MUST interact with Atlas exclusively via HTTP. It MUST NOT:

- Connect directly to databases (tenant or control plane)
- Invoke handlers or business logic directly
- Link server runtime crates (`crates/ingress`, `crates/workers`, `crates/runtime`)
- Access internal message bus or queue systems

**Rationale**: Ensures `atlasctl` cannot bypass ingress enforcement (I1) or authorization (I2).

### INV-CTL-02: Full AuthN/AuthZ Enforcement

All `atlasctl` requests MUST be authenticated and authorized through the same mechanisms as other clients:

- Authentication via configured provider (API key, OIDC token, etc.)
- Authorization evaluated by the policy engine
- No bypass mechanisms or "admin override" that circumvents policy evaluation

**Rationale**: Maintains invariant I2 (Authorization Precedes Execution).

### INV-CTL-03: Correlation Propagation

`atlasctl` MUST:

- Generate a `correlationId` for each command invocation if not provided
- Propagate `correlationId` in all HTTP requests via the appropriate header
- Display `correlationId` in command output for traceability

**Rationale**: Maintains invariant I5 (Correlation Propagation) and enables end-to-end tracing.

### INV-CTL-04: Schema Conformance

All payloads sent by `atlasctl` MUST conform to published schemas/contracts:

- Intent envelopes conform to `/specs/schemas/contracts/event_envelope.schema.json`
- Error responses parsed per `/specs/schemas/contracts/error_envelope.schema.json`
- Local validation MAY be performed before submission

**Rationale**: Ensures compatibility with ingress validation and provides early feedback.

### INV-CTL-05: No Internal State Mutation

`atlasctl` MUST NOT modify platform state except through published APIs:

- No direct writes to control plane database
- No direct modification of tenant databases
- No direct manipulation of event streams or queues

All mutations flow through ingress or control plane API.

## Allowed Shared Code

`atlasctl` MAY depend on the following shared crates/modules:

| Shared Code | Purpose |
|-------------|---------|
| Schema types | Event envelope structs, intent payload types |
| Manifest types | Module manifest definitions for validation |
| Envelope builders | Helpers for constructing valid event envelopes |
| Generated API clients | HTTP client code generated from OpenAPI specs |
| Validation helpers | JSON Schema validators, format checkers |
| Error types | Public error envelope types for parsing responses |

## Prohibited Coupling

`atlasctl` MUST NOT depend on:

| Prohibited | Reason |
|------------|--------|
| `crates/ingress` | Server runtime, would enable bypassing HTTP boundary |
| `crates/workers` | Server runtime, internal job processing |
| `crates/runtime` | Internal ports and adapters |
| `crates/adapters` | Direct database/storage access |
| `crates/control_plane_db` | Direct database access |
| Business logic modules | Internal domain logic |
| Policy evaluation code | Authorization is server-side only |

**Test**: A compliant `atlasctl` build MUST NOT transitively depend on any prohibited crate.

## Observability Requirements

### Structured Output

`atlasctl` MUST support structured output formats:

- Human-readable (default): For interactive use
- JSON (`--json` or `-o json`): For scripting and automation
- Quiet mode (`--quiet` or `-q`): Suppress non-essential output

### Correlation Display

Every command that makes requests MUST display or include in JSON output:

- `correlationId`: The trace identifier for the request
- Request status: Success/failure indication

### Error Reporting

Error output MUST include:

- HTTP status code (when applicable)
- Error code from error taxonomy (when returned by server)
- `correlationId` or `supportId` for support escalation
- Human-readable message

## Authentication and Authorization Requirements

### Credential Sources

`atlasctl` MUST support multiple credential sources (precedence order):

1. Command-line flags (`--api-key`, `--token`)
2. Environment variables (`ATLAS_API_KEY`, `ATLAS_TOKEN`)
3. Configuration file (`~/.atlasctl/config.yaml` or equivalent)

### Credential Types

| Type | Use Case |
|------|----------|
| API Key | Service-to-service, automation |
| OIDC Token | User-initiated operations |
| mTLS (future) | High-security environments |

### Authorization Scope

`atlasctl` operations are subject to the same authorization policies as other clients. Operators requiring elevated access must have appropriate roles/policies configured.

## API Surface Expectations

`atlasctl` is expected to support the following categories of operations. Specific endpoints/paths are defined by the ingress and control plane API specifications.

### Health and Status

- Query ingress health/readiness endpoints
- Query control plane health/readiness endpoints
- Display aggregate service status

### Discovery

| Operation | Description |
|-----------|-------------|
| List tenants | Enumerate tenants (control plane) |
| List modules | Enumerate registered modules and versions |
| List actions | Enumerate declared actions per module |
| List schemas | Enumerate schema registry entries |
| List policies | Enumerate policy bundles (if authorized) |

### Intent Operations

| Operation | Description |
|-----------|-------------|
| Submit intent | Submit an intent envelope to ingress |
| Validate intent | Validate intent payload locally before submission |

### Tracing and Debugging

| Operation | Description |
|-----------|-------------|
| Trace by correlationId | Query for events/logs by correlation ID |
| Authorization explain | Request authorization decision explanation |
| Authorization check | Dry-run authorization check without execution |

### Policy Inspection (if authorized)

| Operation | Description |
|-----------|-------------|
| Show policy | Display policy bundle details |
| Evaluate policy (dry-run) | Test policy evaluation without side effects |

## Compatibility and Versioning

### Version Handshake

`atlasctl` MUST verify compatibility with the server before performing operations:

1. Query server version/capabilities endpoint (TODO: endpoint to be defined)
2. Compare server version against client's known compatibility range
3. Warn if server version is outside known-compatible range
4. Optionally allow `--force` to proceed despite version mismatch

### Version Display

`atlasctl --version` MUST display:

- Client version
- Schema/contract version compatibility
- Build metadata (commit hash, build date)

### Deprecation Handling

When the server returns deprecation warnings:

- Display warning to stderr
- Include in JSON output under `warnings` key
- Continue operation unless `--strict` mode is enabled

## Cross-References

- [Architecture](../architecture.md) — Platform architecture and invariants
- [Authentication](authn.md) — AuthN model and providers
- [Authorization](authz.md) — AuthZ model and policy evaluation
- [Errors](errors.md) — Error taxonomy and response format
- [Events](events.md) — Event envelope schema
- [Tenancy](tenancy.md) — Tenant context and isolation

## Open Questions

- What is the specific control plane API endpoint structure for discovery operations?
- Should `atlasctl` support configuration profiles for multiple environments?
- What is the server version/capabilities endpoint format?
- Should authorization explain/check be a control plane or ingress operation?
