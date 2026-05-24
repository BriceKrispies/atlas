---
title: Dependency-removal audit — aggressive prune plan
status: rollup
type: review
generated_at: 2026-05-23
git_head: ea08453
---

# Dependency audit rollup

6 parallel agents reviewed all **47 unique external deps** across Atlas. Goal: reduce npm supply-chain exposure by pruning, vendoring, or swapping deps. The bar was honest — when rolling our own crypto is the only "alternative", **keep the dep**; when stdlib + ~100 LOC does the job, drop it.

## Headline

| Tier | Deps | Action |
|------|------|--------|
| **Removable now (low risk)** | 7 | Drop or vendor with ~600 LOC total |
| **Removable with effort** | 4 | Drop with ~500–700 LOC + careful testing |
| **Sideways swap (smaller dep, same role)** | 3 | Net deps unchanged; bundle/risk reduction |
| **Keep (load-bearing or crypto)** | 33 | Pin, monitor, audit on upgrade |

If we take all tier 1 + tier 2: **11 deps removed**, **47 → 36**, ~1100 LOC of vendored or stdlib-replaced code added. Effort: 3–5 days. Supply-chain surface dropped meaningfully without compromising security-critical code.

## Tier 1 — Remove now (low risk, low effort)

| Dep | Replacement | LOC | Notes |
|-----|------------|-----|-------|
| `@xmldom/xmldom` | `linkedom` (already in tree) | 0 — swap import | 1:1 DOMParser swap, used only in `modules/identity/src/saml/verify.ts` |
| `nodemailer` | vendor minimal SMTP client | ~200 | 1 callsite (`adapters/node/src/mailer-smtp.ts`); SMTP protocol is well-specified; mailer is feature-gated |
| `ajv-formats` | vendor format validators | ~100 | 2 callsites; only email/date-time/uuid formats are actually used |
| `@stryker-mutator/core` | drop mutation testing | 0 — delete configs | `stryker.native.config.mjs`, `stryker.oracle.config.mjs`, `packages/stryker-runner-node-test/` all go; mutation testing is rarely run |
| `@stryker-mutator/api` | (delete with core) | 0 | Coupled to `@stryker-mutator/core`; no standalone value |
| `@cucumber/messages` | inline type alias | 2 | Type-only import in `modules/identity/test/bdd/runner.ts` — just `interface Tag { name: string }` |
| `tar` | vendor `tar-stream` (zero-dep) or use system `tar` binary | ~200 | 1 callsite (`apps/atlasctl/src/commands/push.ts`); `tar` package has had symlink-traversal CVEs |

**Tier 1 total:** 7 deps removed, ~500 LOC vendored, ~1 day of work.

## Tier 2 — Removable with effort

| Dep | Replacement | LOC | Notes |
|-----|------------|-----|-------|
| `knip` | `tsc --noUnusedLocals --noUnusedParameters` + enable `oxlint`'s no-unused-vars | ~20 (config) | Accept some false negatives on cross-package unused exports |
| `markdownlint-cli2` | drop entirely | 0 | Bikeshed style; biome formatter already handles whitespace |
| `@stoplight/spectral-cli` | vendor AJV-based schema validator | ~100 | 32 schemas in `specs/schemas/contracts/`; spectral's advanced rules aren't used |
| `dependency-cruiser` | extend `packages/arch-tests/test/_dependency-scan.ts` | ~200 | High-value; covers I12 + hexagonal layering; circular-dep detection is the tricky part to roll |
| `playwright-bdd` | generalize `modules/identity/test/bdd/runner.ts` (already exists, 223 LOC) | ~300 | Atlas already has a working custom Gherkin→test runner — promote it to a shared package and retire playwright-bdd's CLI |
| `ajv` (partial) | vendor minimal JSON Schema subset | ~400 | 7 callsites; Atlas uses ~80% of a basic draft-07 validator; rest of ajv is unused |

**Tier 2 total:** 6 deps removed, ~1020 LOC, ~3–4 days of work, medium testing burden.

## Tier 3 — Sideways swaps (smaller, not fewer)

These don't reduce dep count but reduce attack surface or bundle size:

| Current | Alternative | Win |
|---------|------------|-----|
| `linkedom` (~150KB, 8 packages depend on it) | `happy-dom` | Smaller, more active maintainer, drop-in `parseHTML` swap |
| `monaco-editor` (5MB lazy chunk in admin) | `CodeMirror 6` (~400KB modular) | ~4.5MB client bundle win, ~200 LOC rewrite of `atlas-code-editor-impl.ts` |
| `@cedar-policy/cedar-wasm` in `apps/admin` (1.5MB lazy) | move policy simulator to server endpoint | Removes one client-side npm vector; trades for one round-trip on "preview policy" |

`@cedar-policy/cedar-wasm` in `adapters/policy-cedar` (server) **stays** — it's the authz engine, irreplaceable without rearchitecting authz.

## Tier 4 — Keep (and why)

These are not removable without taking on disproportionate risk. The right move on these is **pin version, watch `osv-scanner` for advisories, manual review on upgrade**.

### Crypto / security (rolling-your-own = shipping auth-bypass)
- `@simplewebauthn/server` — WebAuthn / passkey verification
- `xml-crypto` — XMLDSig canonicalization (footgun supreme)
- `node-forge` — X.509 cert generation for SAML SP keys
- `jose` — JWT/JWS verification with JWKS rotation

### Runtime infrastructure (irreplaceable without rewriting half of Atlas)
- `hono` + `@hono/node-server` — HTTP ingress (Invariant I1), 45+ files depend on it
- `postgres` (postgres.js) — DB driver, 50+ files
- `@cedar-policy/cedar-wasm` (server-side) — authz engine
- `vite` — frontend bundler for 4 apps
- `idb` — IndexedDB Promise wrapper, 5KB, 1 callsite

### Test runner / fixtures (load-bearing, no good alternative)
- `@playwright/test` — browser automation, 61 files
- `@cucumber/gherkin` — Gherkin AST parser, canonical
- `expect` — 400+ matcher calls; node:assert can't easily replace `.objectContaining` / `.toThrow` / `.rejects` fluent chains
- `fake-indexeddb` — keeps adapter contract tests fast in Node

### Build / lint tooling (cheap deps that catch real bugs)
- `typescript` + `@typescript/native-preview` (tsgo) — type checking, perf win
- `oxlint` + `oxlint-tsgolint` — type-aware linting catches unsafe casts + module-boundary violations
- `@biomejs/biome` — formatter (linter intentionally disabled — oxlint covers it)
- `syncpack` — workspace version drift
- `lefthook` — git hooks (alternative: native `core.hooksPath` + shell scripts; small win)
- `ts-morph` — AST safety for one-time codemods (`scripts/codemod-*`)
- `commander` — CLI parser in atlasctl (worth revisiting once command surface stabilizes)
- `js-yaml` — atlasctl config; could migrate to JSON later (defer)

### Maybe-removable (judgment call)
- `@axe-core/playwright` — a11y test coverage. Drop if a11y isn't a priority. Trade: silent a11y regressions until manual review catches them.
- `fast-xml-parser` — non-crypto SAML attribute reader. Could replace with linkedom DOM walk. Saves no real surface area; defer.

## Phased execution plan

**Phase 1 — quick wins (1 day)**
1. Delete `@xmldom/xmldom`, swap import to `linkedom` in `modules/identity/src/saml/verify.ts`
2. Inline `@cucumber/messages` `Tag` type into `modules/identity/test/bdd/runner.ts`
3. Delete `@stryker-mutator/{core,api}` + the 3 stryker config files + `packages/stryker-runner-node-test/`
4. Delete `markdownlint-cli2` + the `lint:markdown` script + lefthook entry
5. Vendor `ajv-formats` (~100 LOC) into `packages/schemas`

**Phase 2 — moderate effort (2–3 days)**
6. Vendor a minimal SMTP client (~200 LOC) into `adapters/node`; delete `nodemailer`
7. Swap `tar` to vendored `tar-stream` (~200 LOC) in `apps/atlasctl`
8. Replace `@stoplight/spectral-cli` with `~100 LOC scripts/validate-schemas.ts` using AJV
9. Remove `knip`; enable `tsc --noUnusedLocals` + `oxlint` no-unused-vars rule

**Phase 3 — bigger lifts (2–3 days each, do separately)**
10. Promote `modules/identity/test/bdd/runner.ts` to a shared `packages/bdd-runner`; retire `playwright-bdd`
11. Extend `packages/arch-tests/test/_dependency-scan.ts` to cover all 5 dep-cruiser rules; retire `dependency-cruiser`
12. (Optional) Vendor `ajv` minimal subset (~400 LOC); replace in 7 callsites

**Phase 4 — sideways swaps (separate from prune, schedule independently)**
13. Swap `linkedom` → `happy-dom` (2 imports + verify all 8 packages still test green)
14. Swap `monaco-editor` → `CodeMirror 6` (200 LOC rewrite, large bundle win)
15. Move Cedar simulator to server-side endpoint; remove `@cedar-policy/cedar-wasm` from `apps/admin`

**End state:** 47 → ~33 external deps (after phases 1–3). Crypto + runtime + test infra all preserved. Supply-chain blast radius shrunk meaningfully.

## Honest reality check

This audit will not make Atlas npm-supply-chain-free. The remaining 33 deps include high-stakes crypto (`jose`, `xml-crypto`, `@simplewebauthn/server`, `node-forge`) where rolling your own is the path to shipping an auth bypass. A compromised `jose` release is far worse than a compromised `markdownlint-cli2` release — but `jose` is also the dep we should NOT remove. The win from this audit is:

1. **Vendor or remove the easy ones** so the dep tree gets smaller and audit surface shrinks
2. **Pin and monitor the load-bearing crypto deps** — accept that vendoring battle-tested crypto is also a footgun (frozen vendor = unpatched CVEs)
3. **Use `pnpm.onlyBuiltDependencies` to keep blocking postinstall scripts** — Atlas already does this with `esbuild` allowlisted
4. **Run `osv-scanner` on every PR** — Atlas already does this

The deeper move (Deno 2's permission model) addresses the *runtime* blast radius: even a compromised `jose` can't reach the filesystem unless the runtime grants it `--allow-read`. That's the conversation worth having alongside this prune.
