# Dev & Agent Experience — Roadmap Checklist

Living checklist for making Atlas progressively more dev-friendly and agent-friendly, anchored on the agentic-first tenets in [`specs/vision.md`](../specs/vision.md) ("One CLI, one API, one audit trail" — anything an agent can do, a tenant or operator can do too, and vice versa).

The thesis: **the API is the contract; everything else is generated from it.** CLI parity, agent SDKs, and machine-readable surfaces stop being a maintenance treadmill once OpenAPI is the source of truth. The cost is rigour: sloppy schemas leak directly into every downstream surface.

What we are explicitly *not* doing: building a second "agent SDK" that runs parallel to the CLI. If `atlasctl --output json` is good enough for agents, we don't need one. If it isn't, fix the CLI rather than fork.

---

## 1. CLI codegen from OpenAPI

Every endpoint gets an `atlasctl` subcommand for free, generated from the `@atlas/openapi` spec. Hand-tune only the verbs that need ergonomics (`push`, `logs -f`, `shell`). Stops the "did anyone wire this up?" drift.

- [ ] Audit current `@atlas/openapi` generator output for completeness — every route in `apps/server` represented, every intent action expanded
- [ ] Define the codegen target: per-endpoint subcommand shape, flag mapping (path → positional, query/body → flags), error formatting
- [ ] Build the generator (one of: TS template, `oapi-codegen`-style, Cobra-shaped)
- [ ] Wire generated commands into `atlasctl` alongside the hand-written verbs
- [ ] CI gate: regenerate on every PR, fail if checked-in CLI drifts from spec
- [ ] Document the override pattern: which commands are hand-tuned and why

## 2. One binary, subcommand groups

Resist forking CLIs. `gh`, `kubectl`, `stripe` all stayed monolithic. A second binary becomes a second install/auth/version surface — pure tax.

- [ ] Establish the subcommand grouping convention (e.g. `atlasctl deployments`, `atlasctl schema`, `atlasctl functions`, `atlasctl secrets`)
- [ ] Ensure groups map cleanly to domains/platforms in [`specs/CLAUDE.md`](../specs/CLAUDE.md) so agent prompts match operator intuition
- [ ] Document a "no second binary" rule in [`specs/crosscut/atlasctl.md`](../specs/crosscut/atlasctl.md)
- [ ] Add a `atlasctl --version` and version-check warning when client/server skew is large

## 3. `--output json` everywhere, structured by default for non-TTY

Agents pipe; humans read tables. Same code path, different renderer. Detect TTY and switch automatically; allow explicit override.

- [ ] Define the output renderer interface (`json`, `table`, `yaml`, optionally `ndjson` for streams)
- [ ] Auto-detect TTY: humans get tables, pipes get JSON
- [ ] `--output json` / `-o json` flag honoured everywhere
- [ ] Stable JSON schema per command (versioned, documented in OpenAPI as response shape)
- [ ] Error output also structured under `--output json` (machine-parseable error codes per [`specs/crosscut/errors.md`](../specs/crosscut/errors.md))

## 4. Streaming primitives — what makes a CLI feel alive

`--watch` on long ops, `logs -f` tailing the audit + observability streams correlated by `correlationId`, `events --since` for tailing the event store. The invariants already make this cheap.

- [ ] `atlasctl deploy --watch` — block until deployment converges, stream phase transitions
- [ ] `atlasctl logs -f` — follow logs from a deployment / function / workflow run
- [ ] `atlasctl audit tail` — follow audit events scoped to current tenant
- [ ] `atlasctl events --since <ts>` — tail event store from a cursor (agents need this for catch-up)
- [ ] All streaming uses NDJSON under `--output json`
- [ ] All streams correlate by `correlationId` so cross-stream join works (audit + logs + events for one intent)

## 5. Surface introspection as a CLI command

`atlasctl surface get <id>` returns the same JSON the UI consumes. Makes the agentic-first promise tangible — the agent and the human see literally the same thing.

- [ ] Land [`specs/frontend/surface-introspection.md`](../specs/frontend/surface-introspection.md) (already in flight per git status)
- [ ] `atlasctl surface list` — enumerate surfaces visible to the current principal
- [ ] `atlasctl surface get <id>` — fetch the surface JSON contract + current state
- [ ] `atlasctl surface describe <id>` — human-readable rendering of the same data
- [ ] Document the surface contract format alongside [`specs/frontend/surface-contract.md`](../specs/frontend/surface-contract.md)
- [ ] BDD coverage: a surface accessed via UI and via CLI returns equivalent state

## 6. Tenant context as session, not per-call flag

`atlasctl use <tenant>` writes a context file (kubeconfig-style); subsequent commands inherit it. Agents can pass `--tenant` per call, humans don't have to.

- [ ] Define the context file format and location (e.g. `~/.config/atlasctl/context.yaml`)
- [ ] `atlasctl use <tenant>` — set active tenant
- [ ] `atlasctl whoami` — show current principal, tenant, server URL, auth status
- [ ] `atlasctl context list` / `context use` / `context delete` — multi-tenant operator workflow
- [ ] `--tenant` flag overrides session for one call (agent-friendly)
- [ ] Server-side check: token must authorize the targeted tenant (no client-side trust)

## 7. Self-documenting via `atlasctl explain <command>`

Pulls from the same OpenAPI source. Agents can introspect the CLI without scraping `--help`.

- [ ] `atlasctl explain <command>` — emit the OpenAPI fragment for a command (request shape, response shape, errors, examples)
- [ ] `atlasctl explain --output json` — machine-readable form for agents
- [ ] `atlasctl schema` — dump the full OpenAPI spec from the connected server (so agents bootstrap from any Atlas instance)
- [ ] Inline examples per command, sourced from OpenAPI examples (single source of truth)
- [ ] `atlasctl --help` and Scalar `/docs` UI render from the same source

---

## Cross-cutting concerns

- [ ] **Auth & secrets** — token storage on disk must be safe (OS keychain where available, file perms otherwise). Document the model.
- [ ] **Rate limiting & retries** — generated commands need consistent retry policy with backoff; `Retry-After` honoured. Agents will hammer.
- [ ] **Idempotency keys** — every mutating command auto-generates or accepts `--idempotency-key`, surfaces in audit. Maps to invariant I3.
- [ ] **CorrelationId propagation** — CLI generates a `correlationId` per invocation, prints it on error, threads it through to the server. Maps to invariant I5.
- [ ] **Version skew handling** — client warns when server is newer/older than its generated spec; degrades gracefully.
- [ ] **Offline / dry-run** — `--dry-run` for any mutating command, returns the intent without executing. Critical for agents that plan before acting.

---

## Tracking

Update this doc as items land. When a section is fully checked, fold it into the relevant spec (`specs/crosscut/atlasctl.md` or a domain spec) and link from here. This file is the staging ground, not the permanent home.
