---
title: Extract sha256Hex to @atlas/platform-core per scenario-fuzzing §7
status: review
type: chore
owner: sdet
phase: 2
capability:
adr:
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - packages/platform-core/src/**
  - packages/seeder/src/**
  - packages/seeder/test/**
  - adapters/seed-memory/test/**
acceptance:
  - sha256Hex is exported from @atlas/platform-core
  - all inline sha256Hex definitions (in src or test files) replaced with imports
  - pnpm safe --filter @atlas/platform-core typecheck + test green
  - pnpm safe vitest run packages/seeder green
  - pnpm safe vitest run adapters/seed-memory green
  - pnpm safe deps:check 0 errors
created: 2026-05-10
updated: 2026-05-10
---

## Why

`specs/crosscut/scenario-fuzzing.md` §7 lists `sha256Hex` alongside `canonicalJsonStringify` and `prngFromSeed` as a `@atlas/platform-core` re-export. The Phase 1.4 fix-pass extracted `canonicalJsonStringify`; sha256Hex was deferred (sdet + architect both flagged). This ticket closes that gap.

Matches the pattern just established by canonical-json: single canonical home in `@atlas/platform-core`, used via the Crypto port at runtime, tested via the platform-core test suite, imported by seeder + adapter-seed-memory + any future fs/sqlite adapters.

## Scope

1. Add `packages/platform-core/src/sha256-hex.ts` (or co-locate in `canonical-json.ts` if small).
2. Implement `sha256Hex(input: string | Uint8Array, crypto: Crypto): string` — takes the Crypto port (no `node:crypto` direct) and returns hex-encoded sha256.
3. Re-export from `packages/platform-core/src/index.ts`.
4. Find all inline `sha256Hex` (or equivalent inline `crypto.sha256(...).toString('hex')` patterns) in `packages/seeder/`, `adapters/seed-memory/`, and any other workspace package. Replace with imports.
5. Co-located test (`packages/platform-core/src/sha256-hex.test.ts`) covering: empty string, ASCII string, Uint8Array input, deterministic across calls.

Out of scope: `prngFromSeed` extraction (separate ticket if/when needed); refactoring callers beyond import-swap.

## Resume prompt

```
Extract sha256Hex to @atlas/platform-core, matching the canonical-json
pattern from the Phase 1.4 fix-pass.

Read first:
- specs/crosscut/scenario-fuzzing.md §7 (the contract — sha256Hex,
  canonicalJsonStringify, prngFromSeed live in platform-core)
- packages/platform-core/src/canonical-json.ts (the pattern to mirror —
  same shape: pure utility + co-located test)
- packages/platform-core/src/index.ts (re-export pattern)
- ports/src/crypto.ts (the Crypto port — sha256Hex calls crypto.sha256)
- grep for inline sha256Hex definitions or `crypto.sha256(...).toString('hex')`
  patterns across packages/ and adapters/

Create:
- packages/platform-core/src/sha256-hex.ts:
    export function sha256Hex(input: string | Uint8Array, crypto: Crypto): string
    Body: convert input to Uint8Array if needed, call crypto.sha256(...),
    return hex-encoded result.
- packages/platform-core/src/sha256-hex.test.ts:
    4-5 tests minimum — empty string, ASCII string, UTF-8 with non-ASCII,
    Uint8Array input, determinism across two calls with the same input.
    Use a small Crypto stub or import the test-setup if there is one.

Edit packages/platform-core/src/index.ts to re-export sha256Hex.

Find + replace inline copies (run grep first; the architect note said
sha256Hex was "only inline in tests today"). Likely targets:
- packages/seeder/test/runner.test.ts (inline helper)
- adapters/seed-memory/test/contract.test.ts (inline helper)

Replace each with an import from @atlas/platform-core.

Constraints:
- Single canonical impl. Don't leave inline copies behind.
- No node:crypto direct import in the new module — go through Crypto port.
- Keep the existing canonical-json.ts layout/style; match it.

Done bar:
- pnpm safe --filter @atlas/platform-core typecheck + test green
  (canonical-json's existing tests still pass; sha256-hex's new tests
  pass)
- pnpm safe vitest run packages/seeder green
- pnpm safe vitest run adapters/seed-memory green
- pnpm safe deps:check 0 errors
- grep for inline sha256Hex definitions returns 0 hits outside
  packages/platform-core/

Update tickets/chore/sha256hex-extract-to-platform-core.md log on
completion. Set status: review and hand to sdet.
```

## Notes / log

- 2026-05-10: created from sdet + architect concerns on seeder Phase 1.4 fix-pass.
- 2026-05-10: implemented by `port-adapter-dev`. Added `packages/platform-core/src/sha256-hex.ts` (signature: `sha256Hex(input: string | Uint8Array, crypto: CryptoSha256Shape): string` — structurally typed `{ sha256(input): Uint8Array }` to dodge the `@atlas/ports → @atlas/platform-core` cycle, mirroring the existing `CachePortShape` pattern in `cached-read.ts`). Re-exported from `packages/platform-core/src/index.ts`. Added `packages/platform-core/src/sha256-hex.test.ts` (5 tests: empty string, ASCII "abc", UTF-8 non-ASCII, Uint8Array input, determinism + hex shape regex). Replaced inline `sha256Hex`/`bytesToHex`/`toHex` definitions in: `modules/repository/src/handlers/repository-upload.ts`, `modules/repository/test/handlers.test.ts` (the `node:crypto` direct one — now goes through `testCrypto`), `packages/seeder/src/idempotency.ts`, `adapters/seed-memory/src/in-memory-seed-corpus.ts`, `modules/identity/src/crypto/secret-hash.ts`. Done bar: `pnpm safe --filter @atlas/platform-core typecheck` clean; `pnpm safe vitest run packages/platform-core/src/sha256-hex.test.ts packages/platform-core/src/canonical-json.test.ts` 11/11 green; `pnpm safe vitest run packages/seeder adapters/seed-memory modules/repository` 54/54 green; identity handlers + unit + a4-acceptance + session 374/374 green; `pnpm safe deps:check` 0 errors (1 pre-existing orphan warning unrelated). Out-of-scope observation: `modules/identity/test/security/` (17 failing tests, untracked) is pre-existing drift unrelated to this extraction.
