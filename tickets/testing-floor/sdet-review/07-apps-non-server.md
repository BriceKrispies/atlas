# SDET review — `apps/{admin,atlasctl,authoring,projection-worker,sandbox}` tests

Scope: 31 `*.test.ts` files. Rubric per scaffold brief.

Summary: the bulk of these tests are real behavioural assertions against live
controllers, real subprocesses, or live Playwright surfaces. They commit, then
read state. They drive the dispatcher, then assert ack/retry/dead-letter on a
real subscription queue. There are however notable problem clusters:

- A pocket of `skipped/todo` tests in the page-editor inspector / preview /
  outline suites that effectively delete coverage for inspector toggles, preset
  application, multi-select edits, copy/paste, the whole standalone preview
  surface, and the shell-level `moveWidget` integration — all behind comments
  blaming upstream bugs that have not been ticketed-as-blockers in this
  suite. The skipped tests *are* the coverage for those features.
- Admin SPA tests intercept the HTTP layer entirely. That is the right
  pattern for SPA-only logic but the policies-list suite never asserts on a
  loading or error state — only empty and success — and never asserts the
  surface `data-state` attribute used by the pages-list suite, leaving an
  asymmetry where one surface is contract-tested and the other isn't.
- `apps/atlasctl/test/cli.test.ts` is the *only* CLI-via-subprocess test;
  `validate`, `doctor`, `auth`, `output` are all in-process. There is no
  http-fully-mocked anti-pattern here because there's no HTTP test at all —
  intent submit / health / version-against-server happy paths are simply
  untested. `intents validate/submit` only exercises envelope validation, not
  the actual submit HTTP call path described in `specs/crosscut/atlasctl.md`.
- The projection-worker tenant-loop test is a model worker-loop test
  (drives FakeSubscription end-to-end through retry / dead-letter / discovery
  failure with real loop semantics) — no `worker-loop-bypassed` here.
- The diff.test.ts assertions for `invalidateByKey` are weak — they assert
  length and op name but not the diverged value, despite the type exposing
  it. Minor.

## CRITICAL

### `apps/authoring/tests/page-editor-inspector.test.ts` — `skipped/todo` cluster

Multiple central inspector behaviours are tested only via `test.skip`:

- L245 `test.skip('toggling a section commits toggleSection on the inspector', ...)` — the *only* test that asserts the toggleSection commit lands.
- L329 `test.skip('applying a preset commits applyPreset and updateWidgetConfig', ...)` — the *only* preset-apply test in the suite. The whole presets feature is uncovered.
- L361 `test.skip('copy then paste round-trips a heading config to a sibling heading', ...)` — copy/paste contract entirely uncovered.
- L428 `test.skip('multi-select banner appears for ≥2 widgets and edits apply to all selected', ...)` — multi-select is feature-loaded (banner, shared-field intersection, multiSelectEdit commit, per-instance updateWidgetConfig commits) and *all* of it is skipped.

The describe-block file header sells this as the "full inspector contract", but four of the eight test bodies in describe-blocks for sections / control overrides / presets / copy-paste / multi-select are inert. The skip rationales (presets timing, multi-select propagation, etc.) are not in code comments — they're behind silent `.skip`. Re-enable or delete; "skip and ship" is exactly the rot the rubric calls out.

### `apps/authoring/tests/page-editor-preview.test.ts` — entire suite skipped

Every test in the `authoring.page-editor.preview` describe (L275, L284, L304, L314) is `test.skip`. Zero assertions execute. The file effectively contributes nothing to coverage despite ~350 lines of scaffolding for a `mountStandalonePreview` harness. Either the harness is broken (delete) or the preview surface contract isn't pinned (re-enable). Right now this file is `skipped/todo` end-to-end and is misleading because it implies the preview surface is tested.

### `apps/authoring/tests/page-editor-outline.test.ts` — `skipped/todo` masking known bug

L257 `test.skip('shell-level moveWidget commit lands when state.ts move-binding bug is fixed', ...)` — the comment explicitly says it is blocked on a `this`-binding bug in `PageEditorController.moveWidget`. That bug needs a ticket. As written, the test is silent rot — a future reader has no way to discover the bug without grepping `test.skip` and reading 30 lines of context. **Either delete (file ticket against state.ts) or wire as `test.fail` so it becomes loud on fix.** Currently classifies as `skipped/todo` + masks a real product defect.

### `apps/atlasctl/test/cli.test.ts` — coverage hole, not a bogus test per se

The only test that runs the actual CLI subprocess. It asserts `--help` lists commands and `version --json` shape. There is **no** test that exercises `health` against a fake server, no test that runs `intents submit` against a fake server. Per the SDET brief: a CLI test that doesn't drive the actual command flow including HTTP call doesn't catch real CLI bugs. `validate.test.ts` and `doctor.test.ts` do drive the in-process command functions, but the network-bound commands (`health`, `intents submit`) have no end-to-end coverage at all. Not bogus — but the suite as a whole has an `http-fully-mocked`-shaped gap (everything HTTP is just absent). File a coverage ticket.

## MODERATE

### `apps/projection-worker/test/diff.test.ts` L160-165 — `weak-assertion`

```ts
expect(report.cacheDivergences).toHaveLength(1);
expect(report.cacheDivergences[0]?.op).toBe('invalidateByKey');
expect(report.cacheDivergences[0]?.key).toBe('ck');
```

The other cache-divergence assertion (L147-153) uses `toEqual` with full `{op, key, details}` shape including expected/actual. This one only asserts op + key, ignoring `details` that carries the expected/actual. Tighten to symmetric shape so a regression in the `details` payload is caught.

### `apps/admin/src/features/authz/policies-list/policies-list.test.ts` — `coverage-shape`

Only `empty` and `success` states tested. Pages-list (the sibling surface) tests `loading`, `empty`, `success`, `error` via `data-state` attribute plus retry flow and a11y. Policies-list never asserts the surface's `data-state`, never tests an API error path, no telemetry, no a11y. Surface-state contract per `packages/test-state` is half-honoured. Either the policies-list surface doesn't *have* loading/error states (then assert that fact) or it does and they're untested. Push back to frontend-dev for parity with pages-list.

### `apps/authoring/tests/authoring-shell.test.ts` — `shape-only`

The shell tests assert the route surface is visible at `data-testid="authoring.X"` but never read any state via `window.__atlasTest` — they're DOM-presence only. For an *authoring shell* hash-router these are fine smoke tests, but they don't catch a case where the shell mounts the wrong route element while still passing visibility checks because both routes happen to use the same testid prefix. Add a one-line `__atlasTest.getSurface(...)` snapshot read to pin the active route id.

### `apps/sandbox/tests/edit-drag-drop.test.ts` L112-114 — `weak-assertion`

```ts
await page.mouse.up();
// Move was rejected (required main would be empty). Nothing moved.
await page.waitForTimeout(300);
expect(await widgetInstanceIdsInRegion(page, 'main')).toEqual([mainId]);
```

`waitForTimeout(300)` after the action then assertion is racy — the rejection is silent (no commit, no marker). A passing test could be `did-not-yet-process` rather than `processed-and-rejected`. Either assert the rejection telemetry (if any) or poll for *something positive* (e.g., source marker cleared, drop slot un-highlighted), then assert state didn't change.

### `apps/sandbox/tests/edit-delete.test.ts` L45-52 — `passes-with-empty-impl`

```ts
await cell.focus();
await page.keyboard.press('Backspace');
await expect.poll(...).not.toContain(id);
```

`.not.toContain(id)` passes if the array is `[]`, `[differentId]`, or anything else not containing `id`. If the Backspace removed the *wrong* widget it would still pass. Use `.toEqual([])` since the seed state has a single sidebar widget — same as the Delete-key test on L41 which gets it right.

### `apps/sandbox/tests/mobile-viewport.test.ts` L45-49 — `weak-assertion`

```ts
const box = await el.boundingBox();
if (!box) continue; // hidden variant — skip
```

The early-`continue` means hidden variants pass silently. A regression that hid the *only* rendered variant would still pass the touch-target test (count check on L42 is `> 0` but doesn't ensure any *visible* element). Track count-of-visible separately and assert at least one visible element exists.

### `apps/sandbox/tests/specimens-smoke.test.ts` — `coverage-shape` (by design)

Every test is `await expect(page.locator(tag).first()).toBeVisible();` — i.e. did-the-tag-mount. For a smoke test that's the contract, but the file is named `specimens-smoke` and the assertions live up to it. Note this is the largest single test file in scope by test count (~50+ tests) and contributes almost nothing per-test beyond "the custom element registered." This is fine *if* the per-component tests (`chart-card`, `data-table`, `edit-*`) cover behavior, which they do. Flagging it as a `coverage-shape` pattern not because the suite is bogus but because reviewers should not be lulled into thinking these tests catch regressions beyond a missing customElements.define.

### `apps/atlasctl/test/deps-check.test.ts` — `mirror-implementation`

The test walks source files with a regex looking for forbidden imports — useful as a structural lint, but the FORBIDDEN_DEPS list duplicates verbatim what `specs/crosscut/atlasctl.md` lists. Note this fails to fire if a developer renames the workspace package (e.g. `@atlas/authz` → `@atlas/spine/authz`). It's a hand-maintained allow-list, and there's no test that asserts the allow-list is in sync with the spec. Acceptable as-is given the spec is the contract, but flag if the project moves to a stable lexicon.

## STYLE

### `apps/atlasctl/test/validate.test.ts` L52-58 — `todo-in-body`

Long comment block describing a pre-existing spec inconsistency between envelope `schemaId` pattern and bundled action $ids, ending with "When the spec inconsistency is fixed (envelope pattern widened or action $ids re-keyed), add a separate test that asserts payload validation against a real bundled schema." That's a TODO that should be filed as a ticket — and a `test.todo('...')` line below it would surface the gap in test output.

### `apps/projection-worker/test/leader.test.ts` L84-89 — `dead-setup`

```ts
describe('acquireLeadership (skipped)', function () {
    it.skip('TEST_TENANT_DB_URL not set — skipping advisory-lock leader tests', function () {
        // intentionally empty
    });
});
```

Pattern is intentional (surface the skip in CI output when DB isn't available) but the `it.skip` with empty body is dead weight. Consider `it.todo(...)` so it's clearly a "this would run with DB" marker, not a skipped real test.

### `apps/authoring/tests/page-editor.test.ts` L820-828 — `commented-assertions`-adjacent

```ts
// Trigger a save explicitly by simulating the resize-end phase via
// the storage helper directly — the controller's resizePanel commit
// path is what tests assert; the persistence handler runs only on
// pointer-end events. Bypass via localStorage to keep the test tight.
await page.evaluate(function () {
    try { localStorage.setItem('atlas:authoring.page-editor.shell.panels', JSON.stringify({ right: 400 })); }
    catch { /* no-op */ }
});
```

This bypass means the test doesn't verify the controller's *own* persistence write path. The "resizePanel commit lands" half is real; the "survives a remount" half tests `localStorage.setItem` + controller load. The actual write-on-pointer-end behavior is uncovered. Flag for an additional test that drives the resize via a pointer interaction so we know the persistence handler fires.

## Notes / non-issues

- `apps/atlasctl/test/auth.test.ts` — clean. Precedence table covered exhaustively, mTLS error path asserted.
- `apps/atlasctl/test/output.test.ts` — clean. JSON / human / quiet / error routing all asserted.
- `apps/atlasctl/test/doctor.test.ts` — clean. StubExec gives full sequence coverage of the state machine, exit codes and output shape are pinned.
- `apps/admin/src/features/content/pages-list/pages-list.test.ts` — exemplary. All four states via `data-state`, retry flow, intent envelope capture, telemetry, a11y. Use as the template for `policies-list`.
- `apps/projection-worker/test/tenant-loop.test.ts` — exemplary. Drives the loop through real retry/dead-letter and discovery failure. The dispatcher chain *is* exercised end-to-end (cache.invalidateByTags injection makes it throw on every retry). No `worker-loop-bypassed`.
- `apps/authoring/tests/block-editor.test.ts`, `page-editor.test.ts` (the non-skipped parts), `page-editor-palette.test.ts`, `page-editor-outline.test.ts` (the non-skipped parts), `page-gallery.test.ts`, `layout-editor.test.ts` — committed-state contract honoured; `assertCommitted` + state-snapshot reads form the full per-action assertion. No `state-machine-shallow` pattern.
- `apps/sandbox/tests/chart-card.test.ts` — gold standard. Each interaction asserts commit envelope + resulting snapshot + DOM.
- `apps/sandbox/tests/{chart,data-table,edit-dnd-subsystem,content-page-drop,sparkline-kpi}.test.ts` — all clean, real behavioural assertions.

## File-by-file disposition

| File | Status |
|------|--------|
| `apps/admin/src/features/authz/policies-list/policies-list.test.ts` | MODERATE — coverage-shape |
| `apps/admin/src/features/content/pages-list/pages-list.test.ts` | clean |
| `apps/admin/src/shell/admin-shell.test.ts` | clean |
| `apps/atlasctl/test/auth.test.ts` | clean |
| `apps/atlasctl/test/cli.test.ts` | CRITICAL — coverage hole (no HTTP path) |
| `apps/atlasctl/test/deps-check.test.ts` | MODERATE — mirror-implementation |
| `apps/atlasctl/test/doctor.test.ts` | clean |
| `apps/atlasctl/test/output.test.ts` | clean |
| `apps/atlasctl/test/validate.test.ts` | STYLE — todo-in-body |
| `apps/authoring/tests/authoring-shell.test.ts` | MODERATE — shape-only |
| `apps/authoring/tests/block-editor.test.ts` | clean |
| `apps/authoring/tests/layout-editor.test.ts` | clean |
| `apps/authoring/tests/page-editor-inspector.test.ts` | CRITICAL — 4× skipped |
| `apps/authoring/tests/page-editor-outline.test.ts` | CRITICAL — skipped masks bug |
| `apps/authoring/tests/page-editor-palette.test.ts` | clean |
| `apps/authoring/tests/page-editor-preview.test.ts` | CRITICAL — every test skipped |
| `apps/authoring/tests/page-editor.test.ts` | STYLE — persistence bypass |
| `apps/authoring/tests/page-gallery.test.ts` | clean |
| `apps/projection-worker/test/diff.test.ts` | MODERATE — weak-assertion |
| `apps/projection-worker/test/leader.test.ts` | STYLE — dead-setup |
| `apps/projection-worker/test/tenant-loop.test.ts` | clean (exemplary) |
| `apps/sandbox/tests/chart-card.test.ts` | clean (exemplary) |
| `apps/sandbox/tests/chart.test.ts` | clean |
| `apps/sandbox/tests/content-page-drop.test.ts` | clean |
| `apps/sandbox/tests/data-table.test.ts` | clean |
| `apps/sandbox/tests/edit-delete.test.ts` | MODERATE — passes-with-empty-impl |
| `apps/sandbox/tests/edit-dnd-subsystem.test.ts` | clean |
| `apps/sandbox/tests/edit-drag-drop.test.ts` | MODERATE — weak-assertion / sleep race |
| `apps/sandbox/tests/mobile-viewport.test.ts` | MODERATE — weak-assertion |
| `apps/sandbox/tests/sparkline-kpi.test.ts` | clean |
| `apps/sandbox/tests/specimens-smoke.test.ts` | MODERATE — coverage-shape (by design but flag) |
