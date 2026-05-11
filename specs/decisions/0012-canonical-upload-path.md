# 0012 — Canonical upload path: Revision is the unit

**Status:** Proposed (2026-05-11)
**Relates to:** [`0002-developer-platform-domain-map.md`](0002-developer-platform-domain-map.md) (Code platform), `specs/domains/code/repository/capabilities/upload-tarball/README.md` (already-designed Phase 1 capability), [`vision.md`](../vision.md) §"How a tenant's code reaches the internet" + §"Wrapped components" (Gitea is Phase 3).

## Context

The `upload-tarball` capability spec (status: *Designed, no implementation yet*) commits to a `Revision` entity as the immutable unit of source code: each `Repository.Upload` intent emits exactly one `Repository.Uploaded` event minting one `Revision`, with bytes stored in `repository_revisions.bytes`. The spec mentions in passing that "Phase 3's git transport produces the same Revision entity from a different ingest path."

That single sentence carries a load-bearing decision that isn't yet recorded as an ADR: **Atlas's source-of-truth for tenant code is the Revision, not a git tree.** Git, when it arrives in Phase 3, is a *transport* — a way to put bytes into Revisions — not the storage model.

The alternative position is real and worth naming: in a Salesforce-shaped data + Vercel-shaped provisioning stack with "tenants build their own GitHub" as a long-horizon possibility, one could argue the Repository should *be* a git tree (storage shaped like git's pack format, full commit/branch/tag history as first-class), with tarball upload as a fallback path that synthesizes a single commit. That model preserves git's semantics. It also requires Gitea (or an equivalent git server) to ship in Phase 1, which contradicts the vision's roadmap (Gitea is Phase 3).

The decision affects every downstream event consumer (build, deploy, registry, pipeline orchestration) — they all key on either `Repository.Uploaded` (Revision-shaped) or some git-shaped event (`Push`, `BranchUpdated`, etc.). Picking late means rewriting consumers.

## Decision

### 1. The Revision is canonical

The **`Revision` entity is Atlas's source-of-truth for tenant code**. Each push (whether via tarball today or via git in Phase 3) mints a new immutable Revision with:

- `revisionId` (UUID-shaped, Atlas-minted)
- `repoId` (the parent Repository)
- `byteCount`, `contentHash` (sha256 of the canonical bytes), `bytes` (the tarball)
- `pushedAt`, `pushedBy`, `correlationId`

Revisions are immutable, ordered within a Repository by `pushedAt`. The "current" revision is whichever has the latest `pushedAt`. Repositories do not have branches, tags, or commit graphs at the Atlas storage layer.

### 2. Git is a transport, added in Phase 3

When Phase 3's git capability lands, it ingests git pushes by:

1. Receiving the push via Gitea (or whatever git server adapter is wired).
2. Materializing the pushed tree as a tarball internally.
3. Emitting `Repository.Uploaded` with the same shape any tarball push emits, plus optional metadata fields the transport carries (`gitCommitSha`, `gitRef`, `gitParentSha`).

The `Revision` entity gains nullable git-metadata fields; it does not change shape. Existing event consumers (build, deploy, pipeline) keep working without modification — they listen for `Repository.Uploaded` and act on `revisionId`.

### 3. Implications for what tenants get

**Phase 1 (tarball only):** tenants push flat snapshots. There is no `git log`, no branches, no tags from Atlas's perspective. Tenant-visible "history" is the list of Revisions ordered by `pushedAt`. The CLI surfaces this as `atlasctl repo show <slug>` (latest Revision) and `atlasctl repo download <slug> --revision <id>` (historical Revision).

**Phase 3 (git transport added):** tenants who push via git get the same Revision history *plus* the original commit metadata available alongside (`atlasctl repo show <slug> --git` could surface the commit SHA chain). Tenants who continue to use tarball push are unchanged.

**Branches and tags as first-class concepts** are explicitly NOT promised. If tenant demand emerges for branch-scoped deploys (e.g., preview environments per branch), it lands as a separate capability that defines a `Branch` entity with its own immutability/mutability rules — not as a retrofit of `Revision`.

### 4. Storage shape across the migration

- **Phase 1:** `Revision.bytes` is `BYTEA` in per-tenant Postgres (10 MB cap). Acceptable because tarballs are small and in the request path.
- **Phase 2 (object-storage):** `RepositoryRevisionStore` adapter migrates bytes to object storage; the port surface stays the same. Existing Revisions migrate via a one-shot batch job. The Repository entity is unchanged.
- **Phase 3 (git transport):** Gitea (or chosen git server) stores its own pack files for the git surface. Atlas's `Revision.bytes` continues to hold the canonical tarball — the bytes the build pipeline consumes — even when the same tree is also expressible as a git commit. **Atlas does not promote git-storage as the truth.** Bytes-on-disk are the contract for downstream consumers.

This means there's some duplication in Phase 3 (a git push lives both in Gitea's pack file and as an Atlas-side tarball). The duplication is intentional: the Revision is the contract everything else depends on, and decoupling it from Gitea's storage means swapping git servers later is an adapter swap, not a model change.

### 5. What's NOT decided here

- **Whether to ship Gitea, gitea-fork, or a git-protocol library in Phase 3.** That's a Phase 3 ADR; this one only fixes that whatever ships, it produces Revisions.
- **Branches / tags / commit graph as first-class Atlas concepts.** Out of scope; would land as separate capabilities if demand emerges.
- **Per-revision deployments / preview environments.** Capability-shaped feature; depends on `compute/runtime`'s lifecycle model (Wave 2).
- **Garbage collection of historical Revisions.** Storage retention policy is a separate capability under `code/repository`; this ADR doesn't pre-decide it.
- **Tarball format details.** The capability spec already names gzipped tar + a hardcoded skip list (`.git/`, `node_modules/`); this ADR doesn't relitigate it.

## What becomes invalid if this is reversed

- **If git becomes canonical later:** every event consumer (`pipeline/push-to-deploy`, `compute/image-build`, audit reports, `atlasctl repo show`) has to re-key from `Repository.Uploaded` to git-shaped events. The Revision entity becomes a derived view of git state — a destructive refactor of the data model and the dispatch chain.
- **If branches / tags become first-class:** the immutability + linear-history model of Revision breaks. Consumers have to learn "which branch's latest" semantics. Easier to *add* a Branch entity later (Revision unchanged) than to *retrofit* branches into Revision.
- **If we tried to ship Gitea in Phase 1 to make git canonical from the start:** Phase 1 can no longer ship without a git server, breaking the vision's phased roadmap and adding a substantial new dependency to the MVP.

## Consequences

**Positive:**

- **Phase 1 ships without a git server.** Tarball + Revision is a complete, simple slice. The `upload-tarball` capability (already designed) is internally consistent.
- **Downstream consumers have a stable contract.** `Repository.Uploaded` + `revisionId` is the trigger for build, deploy, and audit. Adding git in Phase 3 is additive.
- **Adapter portability for git server choice.** Gitea, gitea-fork, or a from-scratch git library are all interchangeable as long as they emit Revisions on push.
- **Aligns with Heroku / early-Vercel mental model.** Tenants used to deploy-on-push platforms find "each push is a Revision" intuitive; tenants expecting full git workflows see git as a transport, not the data model.

**Negative:**

- **No native git history at Atlas's storage layer.** Tenants who want a Phase 1 product with `git log`-shaped semantics over their Atlas-deployed code don't get it; they keep git history in their own tools (GitHub, local git, etc.) and push tarballs to deploy.
- **Phase 3 carries duplicate storage.** Git push lands in Gitea's pack files *and* as an Atlas-side tarball. Storage cost roughly 2x for git-pushed code. Mitigated by the fact that tarballs are small and object-storage tiering is cheap.
- **Branches-as-deploy-target is a future capability, not a freebie.** Preview environments per branch require a Branch entity that doesn't exist yet. Tenants asking for it in Phase 3 hear "next slice."
- **The "Atlas as a github replacement" pitch is downstream of the truth model.** Atlas can host git transport (Phase 3) without being an opinionated git platform. Tenants wanting deep git workflows will find Atlas thin compared to GitHub for the foreseeable future — by design, not by accident.

## Migration

This ADR is spec-only. Concrete follow-ups:

1. **`upload-tarball` capability spec** stays as-is (already aligned with this ADR). Add a one-line cross-reference back to ADR 0012 in the next spec touch.
2. **Wave 2** — `code/pipeline/push-to-deploy` capability spec consumes `Repository.Uploaded` and references the Revision as the deployable unit. `compute/image-build` builds *from a Revision*, not from a git ref.
3. **Phase 3** — when the git transport capability is scoped, it explicitly produces Revisions and adds nullable `gitCommitSha`/`gitRef` annotations on the existing Revision shape. The Revision entity does not split.
4. **`atlasctl push` UX** stays as the upload-tarball spec defines. `atlasctl push --git <url>` could appear in Phase 3 as a transport switch; output shape (printed `revision <id>`) does not change.

No code changes in this PR.
