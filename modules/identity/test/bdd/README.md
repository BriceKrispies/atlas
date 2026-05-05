# `modules/identity/test/bdd` — Tier 1 BDD bindings

Vitest-driven Gherkin tests against in-memory adapters. Drives the
canonical feature files under `specs/domains/identity/features/<x>/`.

## Layout

```
runner.ts          Gherkin → vitest harness (StepRegistry + runFeature).
                   Parses .feature files via @cucumber/gherkin (full
                   Gherkin grammar — Feature/Background/Scenario,
                   Scenario Outline + Examples, tables, doc strings,
                   Rule blocks, i18n keywords, tags).
world.ts           per-scenario in-memory adapters + state
<feature>.steps.ts step bindings for that feature
<feature>.bdd.test.ts entry-point that calls runFeature with the bindings
```

## Tag tiers

- **Tier 1 (this folder)** — runs `@phase-a1` scenarios by default. Override:
  `BDD_TAGS=@phase-a1,@phase-a2 pnpm vitest run modules/identity/test/bdd`
- **Tier 2** (deferred) — Playwright over `apps/sim`, `@integration` scenarios
- **Tier 3** (deferred) — Playwright over real `apps/server` + Postgres, `@e2e`

## Adding a feature

1. Create `<feature>.steps.ts` exporting a `StepRegistry`.
2. Create `<feature>.bdd.test.ts` calling `runFeature({ featurePath, steps, ... })`.
3. Register `Given/When/Then` patterns. Cucumber-expression placeholders supported:
   `{string}` (`"..."`), `{int}` (number), `{word}` (non-space token).
4. Untagged or wrong-tag scenarios appear as `it.skip` so missing tier coverage is visible.

## Spec/impl drifts

Bindings flag drifts inline rather than failing silently. Current known
drifts:

- `password.feature` says InviteToken status flips to `consumed`; impl
  uses `accepted`.
- `password.feature` says Argon2id; impl uses scrypt (deliberate dep
  swap — see `modules/identity/TODO.md`).

Reconcile spec or impl in a follow-up.
