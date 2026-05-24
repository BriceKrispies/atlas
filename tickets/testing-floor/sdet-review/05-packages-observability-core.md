# SDET review — packages/logging + packages/metrics + packages/platform-core

## Summary

- Total files reviewed: 26
- Files clean: 21
- Files with findings: 5
- Critical: 1 (i9-guard-bypassed, partial — invariant marker not asserted)
- Moderate: 4
- Style: 3

Headline calls: **i9-guard-bypassed (partial)** on `cache-key.test.ts` — the suite asserts the `kind` field but never asserts the `invariant: 'I9'` marker that `CacheError` carries for the runtime-I9 guard. **Redaction firing is verified** end-to-end in `redaction.test.ts` (sensitive-field-keyed log call → collector assertion on `[REDACTED]`); no `redaction-not-tested` finding. **CorrelationId threading** is asserted through child contexts in `inheritance.test.ts` and `fatal.test.ts`; one inheritance test that emits via parent+child logger never reads back the per-event correlationId, but the parent-correlationId-equals-child property is asserted on the context surface. Metrics counters/histograms uniformly assert labels via `descriptor.labelNames` plus `.get({labels})` readback — no `label-not-asserted` findings.

## Files reviewed

### packages/logging (10)

1. `packages/logging/test/bench.test.ts`
2. `packages/logging/test/context.test.ts`
3. `packages/logging/test/fatal.test.ts`
4. `packages/logging/test/inheritance.test.ts`
5. `packages/logging/test/level-precedence.test.ts`
6. `packages/logging/test/log-event.test.ts`
7. `packages/logging/test/nonblocking.test.ts`
8. `packages/logging/test/overflow.test.ts`
9. `packages/logging/test/redaction.test.ts`
10. `packages/logging/test/sinks.test.ts`

### packages/metrics (6)

11. `packages/metrics/test/atlas-metrics.test.ts`
12. `packages/metrics/test/counter.test.ts`
13. `packages/metrics/test/guardrail.test.ts`
14. `packages/metrics/test/histogram.test.ts`
15. `packages/metrics/test/missing-counters.test.ts`
16. `packages/metrics/test/registry.test.ts`

### packages/platform-core (10)

17. `packages/platform-core/src/cache-key.test.ts`
18. `packages/platform-core/src/cached-read.test.ts`
19. `packages/platform-core/src/canonical-json.test.ts`
20. `packages/platform-core/src/entity-indexer.test.ts`
21. `packages/platform-core/src/platform-tenant.test.ts`
22. `packages/platform-core/src/principal-cache.test.ts`
23. `packages/platform-core/src/sha256-hex.test.ts`
24. `packages/platform-core/src/singleflight.test.ts`
25. `packages/platform-core/src/upcaster.test.ts`
26. `packages/platform-core/src/validation.test.ts`

## Findings by file

### packages/platform-core/src/cache-key.test.ts

- **L92–107 [CRITICAL] i9-guard-bypassed (partial)** — `validate_cache_artifact_tenant_privacy_requires_tenant_tag` constructs a `TENANT`-privacy artifact missing the `tenant:{tenantId}` tag, expects throw, and asserts `e.kind === 'InvalidPrivacyConfiguration'`. The runtime guard at `packages/platform-core/src/cache-key.ts:224` throws `new CacheError('InvalidPrivacyConfiguration', { ... }, 'I9')` — i.e. the I9 invariant code is the **third constructor arg** stored on `CacheError.invariant`, not the `kind`. The test never asserts `e.invariant === 'I9'`. A refactor that drops the `'I9'` tag (without changing the kind) would not be caught here, even though I9 is the named invariant in the file header (L6 "Invariants I9 + I10"). Add `expect(e.invariant).toBe('I9')` here.
- **L49–65 [MODERATE] i9-guard-bypassed (partial, MissingRequiredKeyPart)** — `build_cache_key_missing_key_part` asserts `e.kind === 'MissingRequiredKeyPart'` but again never reads back `e.invariant === 'I9'`. The implementation at `cache-key.ts:260` carries the marker; the test does not enforce it. Same pattern as above.
- **L108–117 [MODERATE] weak-assertion** — `validate_cache_artifact_user_privacy_requires_principal` asserts only `.toThrow(CacheError)` — it never reads back which `kind` or which `invariant`. A regression that throws `InvalidPrivacyConfiguration` for an unrelated reason (e.g. missing tenant tag for an irrelevant cause) would still satisfy this test. Promote to `e.kind` + `e.invariant` assertion.
- **L118–127 [STYLE] dead-setup** — `validate_cache_artifact_public_privacy_ok_without_tenant` mutates `tags: ['global:config']` but the artifact's `privacy: 'PUBLIC'` is what actually gates the negative; the tag value is incidental. Comment is fine; no action needed.

### packages/logging/test/inheritance.test.ts

- **L65–80 [MODERATE] correlationId-not-threaded (partial)** — `inherited contexts get a fresh logger that stamps the new fields` emits `parent.logger.info('parent log')` and `child.logger.info('child log')` then asserts `first.moduleId` / `second.moduleId` / `actionId` on the events — but never asserts that **both emitted events share the same correlationId** (i.e. that the child logger inherited the parent's correlationId on the event payload, not just on the context object). The property is asserted on the **context surface** at L22–23 (`child.correlationId === parent.correlationId`), but emit-through-child-logger could in principle stamp something different and this test would not notice. Add `expect(second.correlationId).toBe(first.correlationId)` and `expect(second.traceId).toBe(first.traceId)`.

### packages/logging/test/log-event.test.ts

- **L33–46 [STYLE] coverage-shape (mild)** — `emitted event uses ONLY reserved top-level keys` iterates `Object.keys(e)` and checks each is in the RESERVED list, but does not also assert the **inverse** — that mandatory keys (`timestamp`, `level`, `message`, `tenantId`, `principalId`, `correlationId`, `traceId`, `spanId`) are all present on every event. The `absent optional fields` test (L60–74) verifies optionals are gone; mandatory presence is implicit but not directly tested in this file. Other files (`context.test.ts`) cover it — leaving as Style.

### packages/metrics/test/atlas-metrics.test.ts

- **L17–20 [STYLE] coverage-shape (mild)** — `intentsSubmittedTotal labels` increments two distinct `(action, decision)` combinations but only reads back the `permit` slot via `.get(...)`. The `deny` slot value is never asserted — if `inc` no-op'd on the second call, the test would still pass. Cheap fix: assert both `.get(...) === 1`.

### packages/platform-core/src/platform-tenant.test.ts

- **L37–44 [STYLE] tautology (mild, defensible)** — `PlatformRobotPrincipal has no human-user fields` asserts `Object.keys(p).sort()` equals exactly `['kind', 'principalId', 'tenantId']`. This is a contract assertion (the comment makes the intent explicit: audit invariant that this is a process identity). It mechanically verifies "no email/displayName leakage" through key-set exact-match. Defensible — flag for Style review only.

## Clean files (21)

- `packages/logging/test/bench.test.ts` — perf bench with hard ns/op floors; not a behavioural test by design, but every benchmark also asserts on functional side-effects (filtered call → `collector.events.length === 0`). Clean.
- `packages/logging/test/context.test.ts` — every mandatory `LogEvent` field is read back from a real emission; reserved-field-override-protection is tested (caller `properties.tenantId === 'fake'` does NOT overwrite top-level `tenantId === 'real'`). Strong.
- `packages/logging/test/fatal.test.ts` — sync flush ordering, level-bypass, and correlationId stamping on the emitted fatal record all asserted from the wire. Strong.
- `packages/logging/test/level-precedence.test.ts` — default < global < module < tenant < correlation precedence each verified independently AND through `ctx.logger` at runtime. Strong.
- `packages/logging/test/nonblocking.test.ts` — burst + setInterval-liveness combination is a real liveness test, not just a throughput floor. Clean.
- `packages/logging/test/overflow.test.ts` — eviction policy by severity (debug-first, then info; warn/error/fatal never dropped), overflow meta-log emission, and fatal sync-flush all asserted. Strong.
- `packages/logging/test/redaction.test.ts` — sensitive-field-keyed log call routed through `ctx.logger` is asserted to land at collector with `[REDACTED]` on every default-redacted key, including nested and pipeline-level `redactionExtraKeys`. No `redaction-not-tested` finding.
- `packages/logging/test/sinks.test.ts` — `CollectorSink` / `MemoryRingBufferSink` / `ConsoleJsonSink` all behaviourally tested (ring overwrite order, correlationId filtering, JSON-per-line batching). Clean.
- `packages/metrics/test/counter.test.ts` — labels asserted via `.get({labels})`, render output validated, missing/extra/unknown-label rejection all covered. Clean.
- `packages/metrics/test/guardrail.test.ts` — counter increment + structured logger payload + omit-optional-fields all read back; counter accumulation per `(kind, id, component)` tuple verified across distinct ids and components. Strong.
- `packages/metrics/test/histogram.test.ts` — cumulative bucket placement, `+Inf` bucket, count, and sum all verified. Bucket monotonicity rejected. Clean.
- `packages/metrics/test/missing-counters.test.ts` — name + label-set + `.get({labels})` readback + serialize output for all three new singletons. Clean.
- `packages/metrics/test/registry.test.ts` — round-trip, double-register rejection, serialize composition, singleton survival, reset. Clean.
- `packages/platform-core/src/cached-read.test.ts` — concurrent-callers-singleflight, error-propagation-no-write, TTL+tags assertion on `cache.set`, and per-key parallelism all verified against a real in-memory cache double. Strong.
- `packages/platform-core/src/canonical-json.test.ts` — lex-ordered key emission, cycle rejection, bigint rejection, Date-via-toJSON all asserted with exact-string comparison. Clean.
- `packages/platform-core/src/entity-indexer.test.ts` — SQL string assertions are tight (single-column / unique / composite / partial / baseline-protected). Clean.
- `packages/platform-core/src/principal-cache.test.ts` — tenant-isolation explicitly named (`isolates by tenant (I9)`), LRU touch behaviour, positive/negative TTL with injected `now()`, capacity eviction, `invalidate(t,u)` and `invalidateTenant`. Strong.
- `packages/platform-core/src/sha256-hex.test.ts` — RFC test vectors (empty, "abc"), UTF-8 encoding check, Uint8Array path, determinism. Clean.
- `packages/platform-core/src/singleflight.test.ts` — concurrent same-key single-execution, per-key parallelism, error propagation to all waiters, eviction-after-settle (both success and error). Strong.
- `packages/platform-core/src/upcaster.test.ts` — chain walk, missing-step throw, downgrade rejection, collision rejection, idempotent same-fn-ref. Clean.
- `packages/platform-core/src/validation.test.ts` — every taxon constructor verified, fixture-parity dispatcher run, `KNOWN_BROKEN_FIXTURES` made explicit with a count assertion that fails fast if the upstream fixture is fixed. Strong.

## Recommended next actions

1. **Tighten cache-key I9 assertions** (Critical + 1 Moderate): add `expect(e.invariant).toBe('I9')` to the three throws in `cache-key.test.ts` that carry the marker (`InvalidPrivacyConfiguration` for missing tenant tag, `MissingRequiredKeyPart`, and the unasserted-kind `validate_cache_artifact_user_privacy_requires_principal` case). Without this, the runtime guard's invariant-code field is dead-data from the test suite's perspective.
2. **Thread correlationId through emit-time, not just context-time** in `inheritance.test.ts` L65–80 — the property holds today but the suite would not catch a regression that broke logger inheritance.
3. **No metrics or redaction findings.** Both subsystems are well-covered.
