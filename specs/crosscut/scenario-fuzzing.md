# Scenario Fuzzing

**Status:** Designed (Phase 3 of the seeder slice). Phased rollout per [`seed-corpus.md`](seed-corpus.md) §8.
**Owners:** `sdet` (primary), `architect` (determinism gate), `spec-keeper` (this spec).
**Source:** [`decisions/0008-atlas-on-atlas.md`](../decisions/0008-atlas-on-atlas.md). Atlas dogfoods itself; combinatorial coverage of tenant-shaped configurations cannot be hand-curated.

## 1. Purpose

The configuration surface of a multi-tenant fabric is enormous: any tenant-defined data model × any combination of personas × any seed-data volume × any quota dimension. Curated scenarios cover a sliver. Fuzzing covers the surface.

This spec layers an **axis system** over [`seed-corpus.md`](seed-corpus.md). A `Template` is a parameterised scenario: a step-template body plus an array of `AxisDefinition`s. Materialising a template means taking the cartesian product of its axes and emitting one `Scenario` per binding tuple, with a stable `scenarioId` encoding the bindings.

Fuzz reproducibility is the contract. A CI failure on `blog-stress/posts_per_tenant=8/tenant_count=10/user_role=admin` MUST be reconstructible from that string alone — no manifest lookup, no random-seed retrieval, no cross-process drift. The id IS the reproduction recipe.

## 2. Non-Goals

- **Property-based testing of pure functions.** `fast-check` (or equivalent) handles that, in unit suites. The seeder's fuzz produces scenarios that traverse the whole stack via the ingress.
- **Random exploration without a seed.** Every materialisation is seedable and deterministic. There is no "random fuzz" mode — randomness is always derived from the scenarioId.
- **Mutation-based fuzzing of payloads.** Out of scope; this spec is structured fuzzing over declared axes. Adversarial payload mutation may land in a sibling `crosscut/sandbox-corpus.md` if the open §11 question in [`test-fabric.md`](test-fabric.md) resolves that way.
- **Cross-template composition.** A scenario is materialised from exactly one template; templates do not embed templates. Compose at the fixture level (`apply:`).
- **Schema evolution of materialised scenarios.** A template version bump produces a new template; the prior template's materialisations remain reproducible. There is no automatic migration of materialised scenarioIds across template versions.

## 3. Architectural Position

This spec is a strict superset of [`seed-corpus.md`](seed-corpus.md). It adds:

- A new artifact kind: the `Template` (matched by `seed.template.v1.schema.json`).
- A new artifact kind: the `AxisDefinition` (`seed.axis_definition.v1.schema.json`).
- A grammar for stable `scenarioId`s on materialised scenarios.
- A determinism contract for generator-axis evaluation.

Templates live alongside scenarios in the corpus. `SeedCorpus.listScenarios()` may return materialised refs alongside fixed refs — the consumer cannot tell them apart by the port surface alone, only by `ScenarioRef.origin`. `loadScenario(ref)` re-materialises a templated ref on demand and MUST return byte-identical content (post-canonicalisation) across processes given the same template version.

## 4. Axis Definition Format

An `AxisDefinition` is one of three kinds: `enum`, `range`, or `generator`.

### 4.1 `enum`

```yaml
- name: user_role
  kind: enum
  values: ['admin', 'editor', 'viewer']
```

Cartesian product expands to one binding per value. Values are strings (or numbers/booleans coerced to their JSON-canonical string form during id encoding — see §5).

### 4.2 `range`

```yaml
- name: posts_per_tenant
  kind: range
  range: { from: 0, to: 16, step: 4 }   # → 0, 4, 8, 12, 16
```

Inclusive endpoints. `step` MUST be positive. `(to - from)` MUST be a non-negative multiple of `step`. Implementations enforce both (`SEED_AXIS_RANGE_INVALID` on violation).

### 4.3 `generator`

```yaml
- name: tenant_slug
  kind: generator
  generatorRef: 'string:slug'
```

The runner's `prng` produces values from a named generator. Phase 3 ships `string` and `int` generators; composite generators are deferred. Determinism rule: see §6.

`generatorRef` is namespaced — the prefix before `:` is the generator family (`string`, `int`), the suffix is the variant. Unknown variants raise `SEED_AXIS_GENERATOR_UNKNOWN`.

## 5. Scenario-ID Grammar

The `scenarioId` of a materialised scenario is a contract. Format:

```
<templateId>/<axisName1>=<value1>/<axisName2>=<value2>/...
```

### 5.1 Lexical rules

1. **Axes are sorted lexically by `name`** (ASCII byte order) before encoding. `posts_per_tenant=8/tenant_count=10/user_role=admin` is canonical; the same bindings in any other order is invalid for round-trip.
2. **Values are stringified using JSON canonical form** before encoding. Numbers without trailing zeros (`8`, not `8.0`); booleans `true`/`false`; strings without surrounding quotes.
3. **Values are percent-encoded** outside `[A-Za-z0-9._-]`. The reserved set is `/`, `=`, `%`, plus all non-printable, non-ASCII, and whitespace characters. Lowercase hex (`%2f`, not `%2F`). The percent character itself is encoded as `%25`.
4. **Axis names** match the regex `^[a-zA-Z][a-zA-Z0-9_]{0,62}$`. They are NOT percent-encoded; collisions are forbidden by the grammar.
5. **Template ids** match the regex `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$`. They are NOT percent-encoded.

### 5.2 Examples

```
blog-stress/posts_per_tenant=8/tenant_count=10/user_role=admin
multi-tenant/region=us-east-1/tier=pro
oddvalues/label=hello%20world/path=a%2fb
flag-axis/enabled=true/threshold=0.05
```

### 5.3 Round-trip contract

`parseAxisId(formatAxisId({ template, bindings })) === { template, bindings }` MUST hold for every valid binding tuple. The pure functions `formatAxisId` and `parseAxisId` live at `packages/seeder/src/axis-id.ts`.

## 6. Reproducibility Contract

For any materialised `ScenarioRef`, three properties are test-asserted:

### 6.1 ID round-trips to the same bindings

`parseAxisId(ref.scenarioId)` yields `{ template, bindings }` byte-identical to `ref.axisBindings`.

### 6.2 `loadScenario` produces stable contentHash on re-materialisation

`await corpus.loadScenario(ref)` re-materialises into a `Scenario` with the SAME `contentHash` as the first materialisation, including all generator-axis values.

### 6.3 Cross-process determinism via PRNG seeding rule

For every generator axis, the rule is:

```
prng_for_axis = prngFromSeed(scenarioId).split('axis:' + axisName)
```

Both materialisations of the same scenarioId in any two processes (any node version) MUST produce equal `contentHash`s. The `split` operation produces an independent, deterministic substream so axes don't interfere.

The PRNG primitive lives at `packages/platform-core/src/prng.ts`. It is **splitmix64**, hand-rolled (~25 LOC), with no `pure-rand` dependency — Atlas's dep hygiene rules out adding `pure-rand` for this purpose. The `split(label)` method takes the current state, mixes in the label, and returns a fresh independent generator without mutating the parent.

## 7. Determinism

| Concern | Locked decision |
|---|---|
| PRNG primitive | splitmix64, hand-rolled, `packages/platform-core/src/prng.ts`. Re-export `prngFromSeed`, `sha256Hex`, `canonicalJsonStringify` from `@atlas/platform-core`. |
| Seed source | `prngFromSeed(scenarioId)` — the full id is the seed. Per-axis substreams via `.split('axis:' + axisName)`. |
| Generator scope | Phase 3 ships `string` and `int`. Composite (object/array) generators deferred to Phase 4 or property-test follow-up. |
| ContentHash | `sha256Hex(canonicalJsonStringify(resolvedScenario))` after `apply:` flattening + axis substitution. |
| Canonical JSON | Stable key ordering (lexical), no whitespace, integers not floats, no NaN/Infinity (rejected). |
| Cartesian product enumeration order | Axes in the lexical order of §5.1, then the value list in declaration order (enum), low-to-high (range), or PRNG draw order (generator). |
| Time / wallclock | Forbidden in axis evaluation. Templates that need a stable timestamp axis declare it as an `enum` over the desired values; never `Date.now()`. |

Cross-process determinism is the high bar: two materialisations from different node versions and different OSes MUST produce byte-identical `contentHash`s. The splitmix64 implementation MUST be 64-bit-pure JavaScript (no `BigInt` in the hot path; the rotation/mix uses 32-bit split-state to dodge BigInt cost while preserving the algorithm's bit pattern).

## 8. CLI

```
atlasctl seed fuzz <templateId> [--limit N] [--concurrency C] [--retry N] [--corpus DIR]
```

Behavior:
- Streams materialised `ScenarioRef`s from the corpus (lazy enumeration; no full-cartesian buffering).
- Submits each scenario via `runScenario(deps, ref)` through HTTP (per `crosscut/atlasctl.md` INV-CTL-01).
- Aggregates results into a structured report (every step's `idempotencyKey` + `ok` + `errorCode`).
- Re-running with the same args produces byte-identical reports modulo wallclock fields (`startedAt`, `durationMs`).

`--limit` is an early-termination cap on the cartesian product, applied AFTER lexical axis ordering — so `--limit 100` against a template with `[axisA, axisB]` always picks the same first 100 bindings regardless of when the run happens. `--concurrency` parallelises submission but does not change enumeration order; results are reordered by step on output.

`--retry` is opt-in (default 0). Idempotency keys make retries safe — replays return prior dispatch results.

The CLI follows `crosscut/atlasctl.md` conventions for structured output, `correlationId` display, and error reporting.

## 9. Cross-References

- [`specs/crosscut/seed-corpus.md`](seed-corpus.md) — the foundation this spec layers on; primitives, runner, adapters, idempotency-key derivation
- [`specs/crosscut/test-fabric.md`](test-fabric.md) — sibling crosscut; Mode B (pump-and-watch) may use a fuzz template as continuous workload (Phase 5 of the seeder)
- [`specs/decisions/0008-atlas-on-atlas.md`](../decisions/0008-atlas-on-atlas.md) — Atlas-on-Atlas tenet that motivates combinatorial coverage
- [`specs/architecture.md`](../architecture.md) — Invariant I1 (single ingress), I3 (idempotency), I5 (correlationId propagation)
- [`specs/normative_requirements.md`](../normative_requirements.md) — determinism rules referenced from this spec
- [`specs/schemas/contracts/seed.template.v1.schema.json`](../schemas/contracts/seed.template.v1.schema.json) — Template payload contract
- [`specs/schemas/contracts/seed.axis_definition.v1.schema.json`](../schemas/contracts/seed.axis_definition.v1.schema.json) — Axis definition contract
- [`specs/crosscut/atlasctl.md`](atlasctl.md) — CLI conventions
- [`specs/crosscut/errors.md`](errors.md) — `SEED_AXIS_RANGE_INVALID`, `SEED_AXIS_GENERATOR_UNKNOWN`, `SEED_AXIS_ID_PARSE_FAILED`
- `packages/platform-core/src/prng.ts` *(Phase 3)* — splitmix64 implementation; `prngFromSeed`, `Prng.split(label)`
- `packages/seeder/src/axis-id.ts` *(Phase 3)* — `formatAxisId`, `parseAxisId` pure functions
- `packages/seeder/src/expand.ts` *(Phase 3)* — cartesian product over axes → `AsyncIterable<Scenario>`
