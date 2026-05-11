---
title: Extract sha256Hex to @atlas/platform-core per scenario-fuzzing §7
status: done
type: chore
owner: architect
phase: 5
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
- 2026-05-10: Phase 2 adversarial review by `sdet`. **Verdict: clean with caveats.** Per-site behaviour-equivalence verified by diffing the old inline impls against the new `sha256Hex`: (1) `seed-memory/in-memory-seed-corpus.ts` bytesToHex → sha256Hex: equivalent (both lowercase, both zero-padded); (2) `identity/secret-hash.ts` toHex+sha256 → sha256Hex: equivalent (identical loop, both call `.sha256(string)` so UTF-8 encoding is delegated to the Crypto port the same way); (3) `repository/handlers/repository-upload.ts` inline sha256Hex → import: equivalent (loop body identical, signature widened to accept `string|Uint8Array` but call site still passes bytes); (4) `repository/test/handlers.test.ts` `createHash('sha256').digest('hex')` → `sha256Hex(bytes, testCrypto)`: equivalent (node's `.digest('hex')` emits lowercase, matches the loop); (5) `seeder/idempotency.ts` toHex+sha256 → sha256Hex: equivalent. The `CryptoSha256Shape` type is a strict subset of `Crypto.sha256` — no callsite needed `hmacSha256` (which doesn't exist on the port anyway; hmac is `hmacSha1` for TOTP only) or any other method. RFC test vectors in the new unit test (`e3b0c4...` for empty, `ba7816bf...` for "abc") match FIPS 180-4 §B.1 and NIST CAVS published values. Grep beyond the 5 sites turned up only legitimate `node:crypto` usage: adapter `Crypto` implementations (`adapters/node/src/crypto.ts`), test-setup stubs (`test-setup/identity-crypto.ts`), an integration test (`tests/integration/upload-tarball.itest.ts`), and the CLI binary (`apps/atlasctl/src/commands/push.ts`). The CLI is a node-only binary outside the Crypto-port host (no boot wiring), so leaving its inline `createHash` is correct for this slice — but it's an ADR-0008-adjacent follow-up worth a separate ticket if the CLI ever needs to share crypto with module code. The `runner.test.ts` 100-line FIPS-180-4 implementation is a `Pick<Crypto, 'sha256'>` stub (not an inline `sha256Hex`) — agent's claim verified. **Coverage gaps filled (regression pins):** added `modules/identity/test/unit/secret-hash.test.ts` (5 tests pinning SHA-256 vectors for `hashSecret`/`lookupOf` — security-critical; the prior identity suite only tested `hashSecret` transitively via invite/session flows); added PINNED test inside `packages/seeder/test/runner.test.ts` `deriveIdempotencyKey` describe block (asserts exact 32-char hex for `('seed/scenario-1', 0)` and `('seed/scenario-1', 1)`); added PINNED test inside `adapters/seed-memory/test/contract.test.ts` (asserts exact 64-char contentHash for `minimalScenario` so any byte-level drift in `sha256Hex` OR `canonicalJsonStringify` fails loudly, not just the regex shape). `pnpm safe vitest run packages/seeder/test/runner.test.ts adapters/seed-memory/test/contract.test.ts modules/identity/test/unit/secret-hash.test.ts packages/platform-core/src/sha256-hex.test.ts` 61/61 green; `pnpm safe vitest run modules/repository modules/identity/test/unit packages/seeder adapters/seed-memory` 393/393 green (15 pre-existing todo). Ready for `architect` (Phase 3 invariant gate).
- 2026-05-10 (architect Phase 3): clean. ADR 0008 leak #1 audit: zero direct `node:crypto` imports in `modules/**/src`, `packages/seeder/src`, `adapters/seed-memory/src` (textual hits at `modules/identity/src/ids.ts:4`, `modules/identity/src/crypto/runtime.ts:11`, `packages/seeder/src/types.ts:55` are doc comments). All 5 replacement sites verified to thread the `Crypto` port via DI. `CryptoSha256Shape` structural type in `packages/platform-core/src/sha256-hex.ts:32-34` correctly dodges the `ports → platform-core` cycle, mirroring `CachePortShape`. I3 determinism pinned with exact byte vectors in `packages/platform-core/src/sha256-hex.test.ts` (FIPS-180-4), `packages/seeder/test/runner.test.ts` (idempotency-key), `adapters/seed-memory/test/contract.test.ts` (contentHash), `modules/identity/test/unit/secret-hash.test.ts` (security-critical secret-hash). Concern C2 (`apps/atlasctl/src/commands/push.ts` still uses inline `createHash`) is outside slice scope. Ready for merge.
- 2026-05-10: done. Merged via main lineage (eda4257 → 5985528 → 6270a36). Archived.
