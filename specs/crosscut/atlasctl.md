# Controller Client: atlasctl

This spec defines the architectural constraints and invariants for `atlasctl`, the operator/controller client for the Atlas platform.

**Status:** Planned, phased implementation. The TypeScript `atlasctl`
binary does not exist yet. The legacy Rust prototype at
`crates/atlasctl/` was deleted on 2026-05-04 alongside the rest of the
Rust prototype; the development scaffolding tool at `tools/cli/`
(`atlas` command) was deleted in the same sweep. Implementation scope
is broken into phases — see [Phased Implementation](#phased-implementation)
below. The Phase A target is `apps/atlasctl/` (TypeScript, Node,
commander).

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

- A replacement for the (deleted) `atlas` CLI that previously lived in `tools/cli`
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

## Phased Implementation

Implementation lands in three phases. Each phase scopes only commands whose server-side support exists or ships with the phase. Half-implemented commands that depend on fictional endpoints are not allowed.

### Phase A — Foundation (current scope)

Commands that target endpoints that exist in `apps/server` today.

| Command | Server endpoint(s) | Notes |
|---------|--------------------|-------|
| `atlasctl --version` | none (client-only) | Displays client version + schema-contract version + build metadata. No server handshake in Phase A. |
| `atlasctl health` | `GET /healthz`, `GET /readyz` | Liveness + readiness. `/readyz` includes control-plane DB + action-registry checks. atlasctl reports both. |
| `atlasctl intents validate <file>` | none (local AJV) | Validates locally against `event_envelope.schema.json` + the action-specific intent schema in `specs/schemas/contracts/`. |
| `atlasctl intents submit <file\|stdin>` | `POST /api/v1/intents` | Returns 202 with correlationId. Full ingress pipeline (authn, tenant resolution, schema, idempotency, authz, dispatch). |

Phase A also wires:

- Global flags: `--json`, `--quiet`, `--api-key`, `--token`, `--debug-principal`, `--correlation-id`, `--strict`, `--force`
- Auth precedence: command-line flags → environment (`ATLAS_DEBUG_PRINCIPAL`, `ATLAS_API_KEY`, `ATLAS_TOKEN`) → config file (`~/.atlasctl/config.yaml`)
- `--debug-principal <value>` — test-auth bypass. Sends `X-Debug-Principal: <value>` header. Server format (per `apps/server/src/middleware/principal.ts`): `type:id[:tenantId]` where type ∈ {`user`, `service`, `anonymous`}; example: `user:tester:dev-tenant`. Only honored when the server has `TEST_AUTH_ENABLED=true`; production servers reject. This is the canonical local-dev auth path on this codebase and atlasctl supports it as a first-class flag.
- mTLS *client-side scaffolding* — credential type discriminator, config block, custom `https.Agent` construction. Server-side mTLS support is out of scope; the seam is wired so Phase B/C can exercise it without rework.
- Single default configuration profile. Multi-profile support is Phase B.

### Phase B — Discovery (deferred)

Adds commands that need control-plane discovery endpoints not present today. Each command in Phase B requires its server endpoint to land first.

- `atlasctl tenants list`
- `atlasctl modules list`, `actions list`, `schemas list`, `policies list`
- `atlasctl policies show <id>`
- Configuration profiles for multiple environments (`--profile <name>` / `ATLAS_PROFILE`)
- Server version/capabilities endpoint + handshake (the server-side counterpart to Phase A's client-only `--version`)
- Single-file compiled binary distribution (esbuild bundle with shebang)

### Phase C — Tracing & Authz Inspection (deferred)

Adds commands that need new ingress / control-plane surfaces.

- `atlasctl trace <correlationId>` — needs a correlation-filtered events query
- `atlasctl authz explain <intent>` — needs an explain endpoint
- `atlasctl authz check <intent>` — needs a dry-run endpoint
- `atlasctl policies evaluate <id>` — needs policy dry-run

The decision of whether `authz explain/check` is an ingress operation or a control-plane operation is part of Phase C's design work.

## Invariants

### INV-CTL-01: HTTP Client Only

`atlasctl` MUST interact with Atlas exclusively via HTTP. It MUST NOT:

- Connect directly to databases (tenant or control plane)
- Invoke handlers or business logic directly
- Import server-side packages (`apps/server`, `modules/*`, `adapters/*`, `ports`)
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

`atlasctl` MAY depend on the following shared packages:

| Shared Code | Purpose | Likely TS package |
|-------------|---------|-------------------|
| Schema types | Event envelope structs, intent payload types | `@atlas/schemas` |
| Manifest types | Module manifest definitions for validation | `@atlas/platform-core` (public types only) |
| Envelope builders | Helpers for constructing valid event envelopes | `@atlas/schemas` |
| Generated API clients | HTTP client code generated from OpenAPI specs | `@atlas/api-client` |
| Validation helpers | JSON Schema validators, format checkers | `@atlas/schemas` |
| Error types | Public error envelope types for parsing responses | `@atlas/schemas` |

## Prohibited Coupling

`atlasctl` MUST NOT depend on:

| Prohibited | Reason |
|------------|--------|
| `apps/server` | Server runtime, would enable bypassing HTTP boundary |
| `apps/projection-worker` | Server runtime, internal job processing |
| `ports/` (`@atlas/ports`) | Internal port interfaces |
| `adapters/node`, `adapters/idb` | Direct database/storage access |
| `adapters/policy-cedar`, `adapters/policy-stub` | Authorization is server-side only |
| `modules/*` | Internal domain logic |

**Test**: A compliant `atlasctl` build MUST NOT transitively depend on any prohibited package or crate.

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

| Type | Use Case | Phase |
|------|----------|-------|
| API Key | Service-to-service, automation | A |
| OIDC Token | User-initiated operations | A |
| mTLS | High-security environments | A (client-side scaffolding only); server-side support is deferred |

Phase A wires the mTLS credential type (config block accepting `cert`, `key`, optional `ca` paths) and constructs a custom `https.Agent` when selected. The seam is real but cannot be exercised end-to-end until server-side mTLS support lands. This is intentional — wiring the seam now avoids reshaping `auth.ts` and `client.ts` later.

### Authorization Scope

`atlasctl` operations are subject to the same authorization policies as other clients. Operators requiring elevated access must have appropriate roles/policies configured.

## API Surface Expectations

`atlasctl` is expected to support the following categories of operations. Endpoint paths for Phase A are concrete; Phase B/C paths are defined when those phases ship.

### Health and Status — Phase A

- Query ingress liveness (`GET /healthz`) and readiness (`GET /readyz`) endpoints
- Display both. `/readyz` returns 200 with `{ status, checks }` when the control-plane DB is reachable and the action registry has actions loaded; 503 otherwise

Aggregate control-plane API health (a separate process from ingress) is part of Phase B.

### Doctor — Phase A

`atlasctl doctor` diagnoses the operator's **local development environment** (NOT the running Atlas deployment — that's `health`). Runs a registry of checks; each check can `ok` / `fixed` / `failed` / `skipped`. Auto-recovery is attempted by default; checks that cannot self-heal report `failed` with a diagnostic the operator can act on.

| Check | What it verifies | Recovery behavior |
|-------|------------------|-------------------|
| `podman-machine` | (Windows only) podman binary on PATH; default podman machine running; named pipe (`//./pipe/podman-machine-default`) reachable for `make db-up` | If machine stopped: `podman machine start`. If pipe unreachable: `podman machine stop && podman machine start`. Returns `skipped` on non-Windows hosts. |

Exit code 0 if every check is `ok` or `fixed`; non-zero if any unfixed `failed` remains. Output respects `--json` / `--quiet` per [Structured Output](#structured-output). Adding a new check is a single registration in `apps/atlasctl/src/commands/doctor.ts`'s registry — no main.ts edit.

The doctor framework is operator-only and read/repair on the local host; it does NOT touch the running Atlas deployment, does NOT issue intents, and does NOT require credentials.

### Discovery — Phase B

| Operation | Description |
|-----------|-------------|
| List tenants | Enumerate tenants (control plane) |
| List modules | Enumerate registered modules and versions |
| List actions | Enumerate declared actions per module |
| List schemas | Enumerate schema registry entries |
| List policies | Enumerate policy bundles (if authorized) |

Each operation requires a corresponding server-side discovery endpoint that does not exist today. Phase B is gated on those endpoints landing first.

### Intent Operations — Phase A

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| Submit intent | `POST /api/v1/intents` | Submit an intent envelope to ingress. Returns 202 + correlationId. |
| Validate intent | none (local) | AJV validation against `specs/schemas/contracts/event_envelope.schema.json` plus the action-specific intent schema before submission. |

### Tracing and Debugging — Phase C

| Operation | Description |
|-----------|-------------|
| Trace by correlationId | Query for events/logs by correlation ID |
| Authorization explain | Request authorization decision explanation |
| Authorization check | Dry-run authorization check without execution |

These commands need new ingress / control-plane surfaces. Phase C must define those endpoints first.

### Policy Inspection (if authorized) — Phase B/C

| Operation | Phase | Description |
|-----------|-------|-------------|
| Show policy | B | Display policy bundle details (read endpoint exists for listing; show is a small extension) |
| Evaluate policy (dry-run) | C | Test policy evaluation without side effects (needs new endpoint) |

## Compatibility and Versioning

### Version Handshake — Phase B

`atlasctl` MUST verify compatibility with the server before performing operations:

1. Query server version/capabilities endpoint (Phase B; endpoint contract is part of Phase B's design)
2. Compare server version against client's known compatibility range
3. Warn if server version is outside known-compatible range
4. Optionally allow `--force` to proceed despite version mismatch

In Phase A, no server handshake is performed; `--version` is client-only.

### Version Display — Phase A

`atlasctl --version` MUST display:

- Client version
- Schema/contract version compatibility (the version of `@atlas/schemas` it was built against)
- Build metadata (commit hash, build date)

### Deprecation Handling — Phase B

When the server returns deprecation warnings:

- Display warning to stderr
- Include in JSON output under `warnings` key
- Continue operation unless `--strict` mode is enabled

Server-side deprecation header conventions are part of Phase B's design (no deprecation surface exists today).

## Cross-References

- [Architecture](../architecture.md) — Platform architecture and invariants
- [Authentication](../domains/identity/authn.md) — AuthN model and providers
- [Authorization](../domains/authorization/authz.md) — AuthZ model and policy evaluation
- [Errors](errors.md) — Error taxonomy and response format
- [Events](events.md) — Event envelope schema
- [Tenancy](../domains/tenancy/tenancy.md) — Tenant context and isolation

## Open Questions

Each remaining question is tagged with the phase that will resolve it.

- **Phase B:** Specific control plane API endpoint structure for discovery operations.
- **Phase B:** Server version/capabilities endpoint format.
- **Phase B:** Configuration profile schema for multiple environments. Phase A ships single-profile support; profile selection (`--profile <name>` or `ATLAS_PROFILE`) is added in Phase B.
- **Phase C:** Whether `authz explain/check` is an ingress or control-plane operation. Drives whether the dry-run lives next to the intent submission path or as a separate authz-only endpoint.
