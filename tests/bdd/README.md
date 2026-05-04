# BDD E2E Tests (playwright-bdd)

Hierarchical Gherkin-driven Playwright tests.

## Hierarchy

```
domain → capability → journey → feature → scenario → step
```

The first three levels are folders. The last three are inside `.feature` files
(Gherkin: `Feature:` → `Scenario:` → `Given/When/Then`).

```
tests/bdd/
  features/
    <domain>/
      <capability>/
        <journey>/
          <name>.feature
  steps/
    common/                    shared steps (use sparingly)
    <domain>/<capability>/<journey>/<name>.steps.ts
  support/
    fixtures.ts                exports test + Given/When/Then/hooks
    hooks.ts                   AfterStep screenshot hook
  screenshots/                 gitignored, cleared each run
  report/                      gitignored Playwright HTML report
  scripts/
    clear-artifacts.ts
    run.ts
```

Step files mirror the feature path so steps stay close to the journey they
serve. Promote a step to `steps/common/` only when it is genuinely generic.

## Commands

| Command | Screenshots | IDB snapshot | When to use |
|---|---|---|---|
| `pnpm bdd` | on-failure | on-failure | Default — cheapest, only failed scenarios attach artifacts |
| `pnpm bdd:debug` | on-failure | **always** | Inspect IndexedDB after every `@sim` scenario, even passing ones |
| `pnpm bdd:all` | **always** | **always** | Full diagnostics — screenshot per step + IDB dump per scenario |
| `pnpm bdd:clean` | — | — | Clears `tests/bdd/screenshots` and `tests/bdd/report` |
| `pnpm bdd:report` | — | — | Opens the last HTML report |

## Screenshots & report

- Default mode: Playwright's `screenshot: 'only-on-failure'` — failure shots are
  attached to the HTML report automatically.
- `BDD_SCREENSHOT_MODE=always` (set by `pnpm bdd:all`): the `AfterStep` hook in
  `support/hooks.ts` attaches a screenshot per step.
- All screenshots are attachments on the test, so the **single HTML report at
  `tests/bdd/report/index.html`** displays them inline.
- Both `screenshots/` and `report/` are gitignored and wiped before each run.

## IndexedDB snapshots

Scenarios tagged `@sim` boot the `apps/sim` harness against real `window.indexedDB`.
The `After('@sim', …)` hook in `support/hooks.ts` reads every IDB store
(`events`, `projections`, `cache`, `search_documents`, `page_render_trees`,
`catalog_state`) for every tenant the scenario touched and attaches each as
`idb-snapshot-<alias>.json` to the test. The HTML report renders the JSON inline
under each test's **Attachments** section — click to drill into the actual
events/projections/cache that landed in storage.

- `BDD_IDB_SNAPSHOT=on-failure` (default) — only attach when the scenario fails.
- `BDD_IDB_SNAPSHOT=always` (set by `pnpm bdd:debug` and `pnpm bdd:all`) — attach
  for every scenario.
- `BDD_IDB_SNAPSHOT=off` — skip entirely.

The hook is gated on the `@sim` tag so non-harness scenarios (e.g., the
placeholder smoke under `tests/bdd/features/example-domain/`) never force-init
the `simPage` fixture.

## Canonical domains

Atlas is structured as **26 business domains** grouped into **5 platforms** (see
root [`CLAUDE.md`](../../CLAUDE.md) for the full table). The `<domain>` folder
under `features/` and `steps/` MUST come from this list. Domain folders are
created **lazily** — only when the first scenario for that domain lands.

| Platform | Domain folders |
|----------|----------------|
| Spine | `identity/` `authorization/` `tenancy/` `organization/` `audit/` `observability/` `search/` |
| Content | `authoring/` `delivery/` `media/` `catalog/` `widgets/` `forms/` `localization/` |
| Workflow | `automation/` `rules/` `scheduling/` `approvals/` `import-export/` |
| Engagement | `communications/` `notifications/` `analytics/` `experimentation/` `gamification/` |
| Commerce | `billing/` |

Spec home for each is `specs/domains/<domain>/`. Each `.feature` scenario
should reference the spec section it executes — that's the contract that makes
BDD the executable witness for specs.

## Reading surface state from steps

For assertions that depend on surface state (selected row, loading flag,
validation errors, etc.), use `@atlas/test-state` rather than DOM scraping.
Surfaces register state readers at mount; the harness exposes them on
`window.__atlasTest`. See
[`packages/CLAUDE.md`](../../packages/CLAUDE.md#reading-surface-state-from-bdd-steps)
for the pattern.

The full request/read lifecycle (so you know what state to assert on after a
mutation) lives at [`specs/lifecycle.md`](../../specs/lifecycle.md).

## Asserting across surface states

When a scenario walks a surface through loading → empty → success (or
error), the **page heading and chrome stay visible across all states** —
that's the body-slot rule from [ADR-0001](../../specs/decisions/0001-atlas-surface-state-rendering.md).
Steps can assert `getByRole('heading', { name: 'X' })` once at the top of
the scenario and trust it to stay; only the body region (e.g. the empty
message, the rendered table) varies between states. Surfaces without
`[data-surface-body]` follow the legacy full-replacement behavior — assert
each state's content separately.

## Adding a new test

1. Pick the canonical `<domain>` from the table above.
2. Pick / create the `<capability>/<journey>/` path beneath it under `features/`.
3. Add `<name>.feature`.
4. Mirror the same `<domain>/<capability>/<journey>/` path under `steps/` and add `<name>.steps.ts`.
5. Run `pnpm bdd`.

> The `example-domain/` folder under `features/` and `steps/` is a wiring smoke
> test, not a real domain — leave it alone or remove once a real domain has
> scenarios.
