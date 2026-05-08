# Atlas Logging Contract

Every log line emitted from Atlas production code (apps, modules, adapters, packages — anything that runs at request-time, in workers, or in operator scripts) MUST conform to this contract. Test code, Vite dev tooling, and one-shot diagnostic scripts are exempt.

The contract exists so logs are **machine-grepable, low-cardinality, and useful in incident response**. Sloppy logs (free-form strings, missing correlationId, swallowed errors) cost more during an outage than they save during development. They are not allowed.

This contract will be audited periodically by the [`observability-architect`](../../.claude/agents/observability-architect.md) agent (when it lands) reviewing the last week of commits. Findings link back to specific clauses below.

## Format

- **Structured JSON** to **stdout**. One JSON object per line. UTF-8.
- No multi-line values that break the one-line invariant. If a value is multi-line (e.g., a stack trace), encode newlines (`\n`) inside the JSON string.
- Atlas does not write logs to files. Process supervisors (systemd, k8s, docker) capture stdout; that's the boundary.

## Mandatory fields

Every log line MUST carry these fields:

| Field | Type | Notes |
|-------|------|-------|
| `ts` | string | ISO 8601 UTC with milliseconds, e.g. `"2026-05-08T12:34:56.789Z"` |
| `level` | string | One of `debug` / `info` / `warn` / `error`. Lowercase. No others. |
| `msg` | string | Short human-readable summary. NOT a structured event name (see `event` below). |
| `service` | string | The emitter, e.g. `"@atlas/server"`, `"@atlas/projection-worker"`, `"@atlas/atlasctl"` |

## Strongly recommended fields (use whenever applicable)

| Field | When | Notes |
|-------|------|-------|
| `correlationId` | Any request-scoped log | Required by Invariant **I5**. Propagated from the inbound request through every downstream call. |
| `tenantId` | Any tenant-scoped operation | Required by Invariants **I7 / I9**. Identifies the tenant whose data / workload / policy is in scope. |
| `principalId` | Any authenticated operation | The principal who initiated the action. Audit consumers depend on this. |
| `event` | Any business action | Structured event name in `Domain.Verb.Outcome` form (see "Event taxonomy" below). Machine-grepable; pairs with the human-readable `msg`. |
| `cause` | At `warn` and `error` | Short reason. Example: `"postgres unreachable"`, `"schema validation failed: missing tenantId"`. |
| `error` | At `error` | An object with `code` (from the error taxonomy in [`errors.md`](errors.md)) and, for unhandled exceptions, `stack` (newline-encoded). |
| `supportId` | At `error` when surfaced to the user | Mirrors the supportId in the user-facing error envelope so support escalation can join the two. |

## Forbidden

- **Raw `console.log` / `console.error` in production code paths.** Use the project logger (see "Tooling" below). Test code, dev scripts, and migration runners may use `console.*`; nothing else.
- **Logging credentials.** Passwords, OIDC tokens, API keys, database passwords, kubeconfig contents, certificate / private-key bytes, OAuth refresh tokens, sealed-secret cleartext. **Never.** Not at any level. Not even at debug.
- **Logging full request / response bodies** at `info` or above. Headers, status, and metadata only. Bodies are logged at `debug` only, only for known-safe shapes (no PII, no secrets), and ideally truncated or sampled.
- **Inflated levels.** No `FATAL` (use `error` then crash). No `TRACE` (use `debug`). No custom levels (`AUDIT`, `SECURITY`, `IMPORTANT`).
- **Multi-line values that break line-delimited JSON.** Stack traces and other multi-line strings MUST have newlines encoded as `\n`.
- **Vague error logs.** A line like `{"level":"error","msg":"failed"}` is a contract violation. Always include `cause` and (where applicable) `error.code`.
- **Silent error swallowing.** Every `catch` block either logs at `error` level OR re-throws. There is no third option.

## Levels — when to use which

- **`debug`** — diagnostic detail useful only during development or incident triage. Cardinality may be high. Disabled in prod by default. Examples: "validated request body", "cache hit for key X", "starting connection pool".
- **`info`** — normal operations the operator should see. Low-to-moderate cardinality. Examples: "request received", "deploy started", "deploy completed", "tenant signup", "module dispatched event". One per business action; not one per code branch.
- **`warn`** — degraded but recoverable state. Action may be needed soon but the system is still functioning. Examples: "cache miss falling back to DB", "retry triggered", "deprecated API used", "config field missing, using default". Always with a `cause`.
- **`error`** — handler failure, unhandled exception, dependency unreachable, contract violation. The user-facing operation has failed or is at risk of failing. Always with `cause` AND `error.code`. Stack trace included when the source is an unhandled exception.

A log line's level is a **promise to the operator** about how alarmed to be. Inflating warns into errors trains the operator to ignore errors; inflating errors into warns hides real failures.

## Event taxonomy

The `event` field, when set, follows `Domain.Verb.Outcome`:

- **Domain** — the domain of the action (`Identity`, `Compute`, `Tenancy`, `Workflow`, etc.). Matches the event-envelope `Domain.Event` pattern in [`events.md`](events.md).
- **Verb** — what was attempted (`Login`, `Deploy`, `SecretRotation`, `Signup`).
- **Outcome** — `Started` / `Success` / `Failed` / `Skipped` / `Denied`.

Examples:

- `Identity.Login.Success`
- `Identity.Login.Failed`
- `Compute.Deploy.Started`
- `Compute.Deploy.Failed`
- `Tenancy.Signup.Submitted`
- `Storage.SecretRotation.Started`
- `Authorization.Decision.Denied`

One canonical event name per (Domain, Verb, Outcome) tuple. Don't introduce variants for the same action (`Login.Ok` vs `Login.Success`); pick one and stick to it.

## PII and secret redaction

| Data | Rule |
|------|------|
| Passwords, OIDC tokens, API keys, kubeconfig contents, certs, private keys, OAuth refresh tokens, sealed-secret cleartext | **Never log, at any level.** |
| Email addresses | Redact (`u***@example.com`) unless the operation is identity-scoped (signup, invite-accept, login) where the email is the subject of the action. |
| Request / response bodies | Headers and status at `info`; bodies only at `debug`, only when known-safe, ideally truncated. |
| User-supplied free-text fields (e.g., page titles, repo descriptions) | Truncate to a reasonable length (~200 chars) before logging at any level. Avoid at `info`+ unless they're the subject of the action. |
| Stack traces | At `error` only. Contain file paths and source snippets — fine for our codebase, but watch for tenant code paths in workflows / functions, which need to be sandboxed and may carry PII in error messages. |

## Error-path discipline

- **Every `catch` block has a destination.** Either log-and-continue (with `level: 'error'`, `cause`, and `error.code`), log-and-rethrow, or rethrow without logging if a higher layer will handle it. There is no "swallow silently."
- **Errors carry their cause.** When wrapping an error (e.g., `throw new Error(...)`), preserve the original via `Error.cause` (`new Error('...', { cause: original })`) so the chain survives.
- **Don't lose context with generic wrappers.** `"Internal storage failure"` told the user what they need to know; the log line should still record what specifically failed (e.g., `"postgres tenant pool: password authentication failed for user atlas_platform"`).
- **Pair logs with the user-facing error envelope.** When a user sees `correlationId: X / supportId: Y`, the corresponding error log line MUST carry both, so support escalation can join the two without scraping.

## Tooling

Atlas does not yet have a canonical logger; this is a known gap. The implementation PR for this contract should land:

- A `@atlas/logging` package (new, lightweight) exporting a structured logger with one method per level. Output: line-delimited JSON to stdout.
- An ESLint rule (or grep guard wired into CI) that fails on `console.log` / `console.error` in production paths (`apps/server/src/`, `modules/`, `adapters/`, `packages/` excluding test files).
- A migration plan for the existing pretty-printed `console.log`s in `apps/server/src/main.ts` and elsewhere — they're contract violations today and need to be replaced.

Until the logger lands, **new code MUST be written as if the logger exists** — i.e., emit structured objects via a TODO-marked stand-in, not free-form `console.log`. The observability-architect agent will flag any new free-form logs added after this contract lands.

## Happy / sad path examples

### Happy path — info

```json
{"ts":"2026-05-08T12:34:56.789Z","level":"info","service":"@atlas/server","correlationId":"corr-9b3","tenantId":"acme","principalId":"u-42","event":"ContentPages.Page.Create.Success","msg":"page created"}
```

### Degradation — warn

```json
{"ts":"2026-05-08T12:34:57.012Z","level":"warn","service":"@atlas/server","correlationId":"corr-9b3","tenantId":"acme","cause":"redis cache miss; serving from postgres","msg":"cache miss"}
```

### Failure — error

```json
{"ts":"2026-05-08T12:34:57.345Z","level":"error","service":"@atlas/server","correlationId":"corr-9b3","supportId":"sup-1c2","tenantId":"acme","principalId":"u-42","event":"Compute.Deploy.Failed","cause":"image build returned exit code 1: missing Dockerfile","error":{"code":"BUILD_FAILED","stack":"Error: missing Dockerfile\\n    at builder.ts:42:9\\n    at ..."},"msg":"deploy failed"}
```

### Counter-examples (contract violations)

| Bad | Why |
|-----|-----|
| `console.log("[server] starting...")` | Free-form string, no JSON, no level, no fields. |
| `{"level":"error","msg":"failed"}` | No `ts`, `service`, `correlationId`, `cause`, or `error.code`. |
| `{"level":"info","msg":"signup","email":"alice@acme.com","password":"hunter2"}` | Logs a password. **Never.** |
| `{"level":"FATAL","msg":"oh no"}` | Inflated level. |
| `{"level":"info","msg":"failed: " + err.message}` (no error caught structurally) | Free-form interpolation; no `cause`, no `error.code`. |
| `try { ... } catch (e) { /* ignore */ }` | Silent swallow. |

## Out of scope for this contract

- **Log shipping.** Where logs go after stdout (Loki, ELK, vector.dev, journald) is an operational concern. Separate spec when ops design lands.
- **Log retention / sampling.** Same — operational concern.
- **Distributed tracing (OpenTelemetry).** Adjacent: `correlationId` is tracing-flavored but Atlas does not currently emit OTLP spans. Tracing gets its own contract when it lands.
- **Audit events.** The structured business events that go to `audit_events` are a separate stream (see [`events.md`](events.md) and [`specs/domains/audit/`](../domains/audit/)). They share the event-name taxonomy with logs but their channel is the event store, not stdout.
- **Metrics.** `@atlas/metrics` and Prometheus emissions are governed separately. The observability-architect's audit notes metric gaps where they obviously parallel logged events, but the metrics contract is its own document (forthcoming).

## Cross-references

- Architecture invariants — [`../architecture.md`](../architecture.md) (especially I5 correlationId, I7 tenant isolation in search, I9 cache keys)
- Error taxonomy — [`errors.md`](errors.md) (the `error.code` values come from here)
- Event vocabulary — [`events.md`](events.md) (the `event` field follows the Domain.Event pattern)
- Observability domain — [`../domains/observability/`](../domains/observability/) (will land later under Spine)
- Observability-architect agent — [`../../.claude/agents/observability-architect.md`](../../.claude/agents/observability-architect.md) *(to be created)*
