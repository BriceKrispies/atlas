# Tickets — Status Board

Hand-maintained. Organized by **set** (one section per active set folder). See [`CLAUDE.md`](CLAUDE.md) for the contract.

## seeder/

- [spec-add-worked-example](seeder/spec-add-worked-example.md) — spec — review — → sdet (post-realism fix-pass)
- [spec-streaming-vs-snapshot-clarify](seeder/spec-streaming-vs-snapshot-clarify.md) — spec — review — → sdet
- [validate-or-throw-split-codes](seeder/validate-or-throw-split-codes.md) — refactor — review — → sdet
- [intent-driver-lift-to-test-fabric](seeder/intent-driver-lift-to-test-fabric.md) — refactor — open — → port-adapter-dev (blocked on @atlas/test-fabric existing)
- [phase-1.5-contract-tests](seeder/phase-1.5-contract-tests.md) — test — scoped — → port-adapter-dev — blocked_by: seeder/spec-add-worked-example, seeder/spec-streaming-vs-snapshot-clarify

## chore/

- [event-envelope-schema-id-rename](chore/event-envelope-schema-id-rename.md) — chore — review — → sdet
- [sha256hex-extract-to-platform-core](chore/sha256hex-extract-to-platform-core.md) — chore — review — → sdet

## atlas-on-atlas/

- [stage-2-platform-row](atlas-on-atlas/stage-2-platform-row.md) — refactor — scoped — → module-dev

## identity/

- [auth-itest-preflight](identity/auth-itest-preflight.md) — test — scoped — → sdet
- [security-fixes](identity/security-fixes.md) — refactor — open — → spine-owner — blocked_by: identity/auth-itest-preflight

---

Done and dropped tickets live in [`archive/`](archive/), preserving the same set structure. They are not listed here.
