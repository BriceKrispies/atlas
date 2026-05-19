---
title: Atlas-on-Atlas Stage 8 — eventContract.cacheInvalidationTags + per-module manifests + handler/manifest drift probe
status: scoped
type: refactor
owner: module-dev
phase: 0
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, machine-readable-surfaces]
invariants: [I10, I19]
blocks:
  - atlas-on-atlas/stage-9-operator-surface
blocked_by:
  - atlas-on-atlas/stage-6-kernel-package
files_in_scope:
  - specs/schemas/contracts/module_manifest.schema.json
  - packages/schemas/src/generated/manifests/authz.manifest.json
  - packages/schemas/src/generated/manifests/content-pages.manifest.json
  - packages/schemas/src/generated/manifests/catalog.manifest.json
  - packages/schemas/src/generated/manifests/identity.manifest.json
  - packages/schemas/src/generated/manifests/repository.manifest.json
  - packages/schemas/src/generated/manifests/tenancy.manifest.json
  - packages/schemas/src/loader.ts
  - packages/kernel/src/module-registry.ts
  - apps/server/test/always-on/f1-manifest-cache-tags.test.ts
acceptance:
  - "specs/schemas/contracts/module_manifest.schema.json: $defs.eventContract grows cacheInvalidationTags as required, type array, items {type: string, minLength: 1}, minItems 1. The schema-shape mismatch on the manifests' events field (currently shipped as []) is reconciled — either schema accepts both shapes (deprecated path), or all six manifests use the object form (preferred). Pin: object form, manifest files updated."
  - "All six modules under modules/ have a manifest at packages/schemas/src/generated/manifests/<moduleId>.manifest.json: authz, content-pages, catalog, identity, repository, tenancy. (Today: authz, content-pages, structured-catalog exist. Rename structured-catalog → catalog if the module dir is `catalog/`; otherwise add catalog.manifest.json alongside.)"
  - "Each manifest's events.publishes is non-empty and covers EVERY event type the module's handlers emit at runtime. Reference emit-sites (modules/CLAUDE.md cache-tag conventions): content-pages handlers, authz activate/archive/create, identity user/membership/session/etc, repository upload/create, catalog seed-package/family/variant, tenancy signup/approve. Each publishes[] entry carries cacheInvalidationTags matching what the handler emits (placeholder syntax for tenant id: 'Tenant:${tenantId}' allowed)."
  - "packages/schemas/src/loader.ts loads all six manifests. `pnpm sync-schemas` (or whatever the generator step is — check packages/schemas/package.json scripts) regenerates without errors. Generated schema mirror tests pass."
  - "packages/kernel/src/module-registry.ts: InMemoryModuleRegistry.register() uses AJV (loaded via @atlas/schemas getSchemaValidator) to validate the manifest against module_manifest.schema.json. Invalid manifests throw KernelError(code='MANIFEST_INVALID', detail: ajv.errorsText())."
  - "apps/server/test/always-on/f1-manifest-cache-tags.test.ts REWRITTEN: removes source-text manifest iteration. Uses buildTestKernel() to register each of the six manifests via kernel.modules.register(); asserts kernel.modules.list() returns six entries. The drift probe (currently test.todo) is implemented: for each (module, action) declared in the manifest, dispatch a synthetic intent via submitIntent, capture appended events from kernel.eventStore.appended, compare emitted cacheInvalidationTags to the manifest declaration union (with ${tenantId} placeholder resolved). Mismatch in either direction fails."
  - "grep -l 'moduleId' packages/schemas/src/generated/manifests/*.manifest.json | wc -l returns 6."
  - "pnpm safe typecheck clean."
  - "pnpm safe test passes — F1 has no test.todo entries remaining."
  - "pnpm safe deps:check 0 errors."
created: 2026-05-10
updated: 2026-05-10
---

## Why

SDET round 3 found that F1's "positive sweep" over manifests swept an empty set for four of the six modules — `identity`, `repository`, `catalog`, and `tenancy` have no manifest files at all. The test passed vacuously for the modules that emit the most cache-tagged events.

Stage 8 closes that gap at three levels:

1. **Schema** — `eventContract` gains a required `cacheInvalidationTags` field with shape constraints (array, non-empty, string items). The schema-level requirement is now mechanical.
2. **Data** — every module under `modules/` ships a manifest declaring its events and their tags. The four missing manifests are authored; the two existing manifests (`authz`, `content-pages`) populate their currently-empty `events: []` arrays.
3. **Enforcement** — `kernel.modules.register()` AJV-validates the manifest at registration time. Invalid manifests fail loudly at boot, not at runtime.
4. **Behavioral drift probe** — F1's `test.todo` becomes a real test. For each (module, action) pair, the test dispatches a synthetic intent and compares emitted tags to declared tags. Both directions checked: manifest over-declares fails; handler under-declares fails. This is the I10-across-reload guarantee in mechanically-checked form.

Stage 8 runs in parallel with stage 7 (disjoint file scopes; both blocked only on stage 6).

## Scope

**In:**

1. **Schema amendment.** `specs/schemas/contracts/module_manifest.schema.json` `$defs.eventContract` grows `cacheInvalidationTags`. The current schema shape for `events` (`{ publishes, consumes }`) is preserved; the manifest files that currently ship `events: []` get rewritten to `events: { publishes: [...], consumes: [] }`.

2. **Manifest authoring.** Six manifests, with `events.publishes` populated:
   - `authz.manifest.json` — populate Policy.Created/Activated/Archived emit-events with `cacheInvalidationTags: ['Tenant:${tenantId}', 'Policy:${policyId}']` (or whatever the handler at `modules/authz/src/handlers/activate-policy.ts:45` actually emits — verify).
   - `content-pages.manifest.json` — populate Page.Created/Updated/Deleted with tags per `modules/content-pages/src/handlers/page-create.ts:71`.
   - `catalog.manifest.json` — populate the seed/family/variant events. May involve renaming `structured-catalog.manifest.json` if the module dir is `catalog/` (verify).
   - `identity.manifest.json` (NEW) — user/membership/session/MFA/SAML/OIDC events. Many emit-sites; this is the heaviest manifest to author.
   - `repository.manifest.json` (NEW) — Repository.Created, Repository.Uploaded.
   - `tenancy.manifest.json` (NEW) — Tenancy.SignupRequested, Tenancy.SignupApproved, Tenancy.TenantProvisioned, etc.

3. **Loader update.** `packages/schemas/src/loader.ts` lists all six in the bundled `MODULE_MANIFESTS` array.

4. **Kernel AJV wiring.** `packages/kernel/src/module-registry.ts` validates on register. The validator is loaded once at constructor time.

5. **F1 test rewrite.** Replace source-text manifest iteration with kernel-mediated probing. Implement the drift probe — synthetic dispatch per (module, action), tag-set comparison.

**Out:**

- Operator HTTP surface for listing modules / inspecting manifests (stage 9).
- Filesystem manifest discovery (manifests stay statically bundled via `loader.ts` for v1).
- Migrating away from the static `moduleManifests()` array entirely (would be a stage-9+ follow-up if needed).

## Resume prompt

```
Atlas-on-Atlas Stage 8 — schema + manifests + AJV enforcement + drift
probe. Driving ADR: specs/decisions/0008-atlas-on-atlas.md. Blocked on
stage 6 (kernel package exists with InMemoryModuleRegistry).

Step 1 — Schema amendment.
  Edit specs/schemas/contracts/module_manifest.schema.json. In
  $defs.eventContract, ADD:
    "cacheInvalidationTags": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "minItems": 1,
      "description": "Cache tags this event will produce at runtime. Used by the kernel module-registry on register for I10 conformance."
    }
  Add 'cacheInvalidationTags' to $defs.eventContract.required.
  Run pnpm sync-schemas (check packages/schemas/package.json for the
  script name). Confirm the generated mirror updates.

Step 2 — Authoring six manifests.
  For each module in modules/ (authz, content-pages, catalog, identity,
  repository, tenancy):
    a. Grep modules/<module>/src for cacheInvalidationTags: literals
       in handlers. List every (eventType, tags[]) pair.
    b. Write packages/schemas/src/generated/manifests/<moduleId>.manifest.json
       with the appropriate manifest shape (moduleId, displayName,
       version, moduleType, capabilities, actions, resources,
       events.publishes[], events.consumes[]).
    c. events.publishes entries: one per distinct eventType the module
       emits. Each carries the cacheInvalidationTags ARRAY matching
       what the handler emits. Template placeholders ('Tenant:${tenantId}',
       'Page:${pageId}') are literal strings in the manifest;
       resolution happens at runtime.
  Catalog rename decision: today there's structured-catalog.manifest.json.
  Check modules/catalog vs modules/structured-catalog — whichever dir
  exists is the source of truth; align the manifest's moduleId to it.
  If the dir is modules/catalog/, rename the manifest file accordingly.

Step 3 — loader.ts update.
  Edit packages/schemas/src/loader.ts. The MODULE_MANIFESTS array
  imports authz, contentPages, structuredCatalog today. Replace with
  authz, contentPages, catalog, identity, repository, tenancy.
  Update the static import lines at the top.

Step 4 — Kernel module-registry validation.
  Edit packages/kernel/src/module-registry.ts InMemoryModuleRegistry:
    constructor: load the validator via
      this.validator = getSchemaValidator('module-manifest.v2', 2);
      (or whatever the schema $id is — read the schema file's $id field)
    register(manifest, instance):
      const ok = this.validator(manifest);
      if (!ok) {
        throw new KernelError('MANIFEST_INVALID',
          ajv.errorsText(this.validator.errors));
      }
      // existing insert logic
  Add tests in packages/kernel/test/module-registry.contract.test.ts:
    - invalid manifest throws MANIFEST_INVALID
    - valid manifest registers cleanly

Step 5 — Rewrite apps/server/test/always-on/f1-manifest-cache-tags.test.ts.
  Remove all source-text manifest iteration. New shape:

  describe('F1', () => {
    let kernel: Kernel;
    beforeAll(async () => {
      kernel = buildTestKernel();
      for (const m of moduleManifests()) {
        await kernel.modules.register(m as ModuleManifest, /* instance */ null);
      }
    });

    test('all six modules registered', () => {
      expect(kernel.modules.list().length).toBe(6);
      for (const id of ['authz', 'content-pages', 'catalog',
                        'identity', 'repository', 'tenancy']) {
        expect(kernel.modules.get(id)).toBeDefined();
      }
    });

    test('every event carries cacheInvalidationTags (AJV gate)', () => {
      // Just registering already passed AJV. This test is the contract
      // — re-validate to be explicit.
      for (const m of kernel.modules.list()) {
        for (const ev of m.events?.publishes ?? []) {
          expect(ev.cacheInvalidationTags).toBeDefined();
          expect(Array.isArray(ev.cacheInvalidationTags)).toBe(true);
          expect(ev.cacheInvalidationTags!.length).toBeGreaterThan(0);
        }
      }
    });

    // The drift probe — replaces the prior test.todo.
    test('handler-emitted tags match manifest-declared tags for every (module, action)', async () => {
      const mismatches: string[] = [];
      for (const m of kernel.modules.list()) {
        for (const action of m.actions ?? []) {
          const intent = buildSyntheticIntent(action, /* synthetic principal */);
          const declared = expectedTagsFor(m, action);
          const emitted = await dispatchAndCaptureTags(kernel, intent);
          if (!equalAsSets(declared, emitted)) {
            mismatches.push(
              `${m.moduleId}/${action.actionId}: declared=${declared} emitted=${emitted}`
            );
          }
        }
      }
      expect(mismatches).toEqual([]);
    });
  });

  buildSyntheticIntent, expectedTagsFor, dispatchAndCaptureTags are
  helper functions defined at the top of the test file. They depend on
  kernel.eventStore.appended being inspectable — buildTestKernel from
  stage 6 already exposes that via the in-memory event store.

Step 6 — Run full suite.
  pnpm safe typecheck
  pnpm safe test
  pnpm safe deps:check
  Fix any AJV-validation failures by editing manifests, NOT by relaxing
  the schema. If a handler emits a tag the manifest didn't declare, the
  test catches it and the manifest is updated to match runtime — that's
  the drift probe doing its job.

Done bar:
- pnpm safe typecheck clean
- pnpm safe test passes (F1 has zero test.todo entries; drift probe is
  green)
- pnpm safe deps:check 0 errors
- grep -l 'moduleId' packages/schemas/src/generated/manifests/*.manifest.json
  | wc -l → 6
- All six modules' handlers' emitted tags equal manifest declarations
  (probe green)

Update tickets/atlas-on-atlas/stage-8-manifests-and-drift-probe.md log
on completion. Set status: review and hand to sdet.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-10: created. Heaviest manifest-authoring is identity (many emit-sites). The drift probe is the load-bearing F1 test; everything before it is plumbing for it. Runs in parallel with stage 7.
