# Capability: Upload Tarball

**Capability:** upload-tarball
**Domain:** code / repository
**Status:** **Designed (no implementation yet).** First capability under the Code platform; lands as the next implementable slice after public-signup. The seam is the foundation Phase 1 depends on — a tenant can push code somewhere before workflows or compute are wired.

## Purpose

A signed-in tenant runs `atlasctl push ./hello-world` and a tar.gz of their working directory ends up stored under their tenant scope as a new `Repository` revision. The flow handles two cases in one push:

1. **Repository doesn't exist yet** — the CLI creates one named after the directory (or the `--repo <slug>` flag overrides), then uploads the tarball as revision 1.
2. **Repository exists** — the CLI uploads the tarball as a new revision; the prior revision stays in place but is no longer "latest."

That's all this slice does. Build, deploy, registry push — none of that. The slice's success criterion is: after `atlasctl push`, the tenant can run `atlasctl repo list` and see their repo with the right byte count + commit hash, and the bytes round-trip identically out of `repo download`. The next slice (`pipeline/build-tarball` or similar) consumes the upload.

## Invariants Touched

- **I1** — every endpoint added (`POST /api/v1/intents` for `Repository.*` actions, `GET /api/v1/repositories`, `GET /api/v1/repositories/:id/revisions/:revId/bytes`) is on `apps/server`. No other app exposes the upload path.
- **I2** — both intents (`Repository.Create`, `Repository.Upload`) run through `submitIntent` → ingress pipeline (authn → tenant resolve → schema → idempotency → authz → handler dispatch). Authz is the standard Cedar/stub gate; uploaded bytes are NOT written before authz passes.
- **I3** — `Repository.Create` is idempotent on `(tenantId, repoSlug)`. `Repository.Upload` is idempotent on the standard envelope `idempotencyKey`; replaying the same key returns the same revision id without writing twice. The CLI generates a fresh key per push so a Ctrl-C-and-retry produces two revisions (which is the expected developer experience), not one.
- **I5** — `correlationId` flows from atlasctl → server → handler → events → projection rebuild → query response. The CLI surfaces the correlationId on `--debug` for trace lookup.
- **I7** — repositories and revisions are **strictly tenant-scoped**. Per-tenant DB tables; no row spans tenants. Listing or downloading from another tenant's repo is impossible at the type level (queries take `tenantId`).
- **I9** — read-side cache keys for repository listings include `tenantId`. PUBLIC scope does not apply (no public read surface in this slice).
- **I10** — `Repository.Created` carries `cacheInvalidationTags: ['Tenant:${tenantId}', 'Repository:${repoId}']`. `Repository.Uploaded` carries the same tags plus `Revision:${revisionId}`. Existing tenant-wide query caches purge correctly on push.
- **I12** — repository + revision projections are rebuildable from the event stream. The handler test asserts `dispatch.ts` rebuilds an identical projection from a synthetic event sequence.

## Lexicon

New terms (to add to `specs/LEXICON.md` in the implementation PR):

- **Repository** — a tenant-scoped, named container for source revisions. Identified by `repoId` (UUID-shaped) and a tenant-unique `repoSlug` (kebab-case, e.g. `hello-world`).
- **Revision** — an immutable snapshot of source bytes at a point in time. Identified by `revisionId`. Each `Repository.Uploaded` event mints exactly one revision.
- **Tarball** — a gzipped tar archive (`application/gzip`) containing the source tree. The single ingest format Phase 1 supports; Phase 3's git transport produces the same Revision entity from a different ingest path.

## Surfaces

What this capability adds, by surface:

- **Module** — **NEW** `modules/repository/`:
  - `src/handlers/repository-create.ts` — `Repository.Create` intent handler.
  - `src/handlers/repository-upload.ts` — `Repository.Upload` intent handler.
  - `src/projections/repository-summary.ts` — list view (id, slug, latest revision id, latest pushed-at, total revisions).
  - `src/projections/revision-list.ts` — per-repo revision list (revision id, byte count, content hash, pushed-at, principalId).
  - `src/queries/repositories.ts` — `getRepository`, `listRepositories`, `getRevision`, `listRevisions` (no `getRevisionBytes` here — bytes flow through a separate route, not a query).
  - `src/dispatch.ts` — `repositoryDispatcher` factory.
  - `src/events.ts` — `Repository.Created`, `Repository.Uploaded` event types.
  - `src/errors.ts` — `RepositoryError` with codes (`REPO_NOT_FOUND`, `REPO_SLUG_TAKEN`, `REVISION_NOT_FOUND`, `UPLOAD_TOO_LARGE`).
  - `src/index.ts` — public surface.

- **Port** — **NEW** `ports/src/repository-store.ts`:
  - `RepositoryStore` — tenant-scoped CRUD for repository metadata.
  - `RepositoryRevisionStore` — separate interface for the revision bytes (so storage can move to object-storage later without touching the metadata store).

- **Adapter** — **NEW** `adapters/node/src/repository-store.ts` and `revision-store.ts`. Postgres implementations against per-tenant tables. `adapter-idb` gets a stub that throws `"RepositoryStore is server-only — push from the browser is not supported"`; the contract test for the IDB factory marks the suite as expected-to-throw rather than running it.

- **Routes** — **NEW** `apps/server/src/routes/repositories.ts`:
  - `GET /api/v1/repositories` — list tenant's repositories (read).
  - `GET /api/v1/repositories/:repoId` — repository detail (read).
  - `GET /api/v1/repositories/:repoId/revisions` — revision list (read).
  - `GET /api/v1/repositories/:repoId/revisions/:revisionId/bytes` — stream the tarball back (read; for `atlasctl repo download` and future build pipelines).
  - **No POST routes here** — writes go through the existing `POST /api/v1/intents` route (`Repository.Create` and `Repository.Upload` actions). The standard intent pipeline gives I2/I3/I5 enforcement for free.

- **Migrations** — **NEW** `adapters/node/src/migrations/tenant/<timestamp>_repositories.sql`:

  ```sql
  CREATE TABLE repositories (
      repo_id        TEXT PRIMARY KEY,
      repo_slug      TEXT NOT NULL,
      name           TEXT NOT NULL,
      description    TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by     TEXT NOT NULL,
      UNIQUE (repo_slug)
  );

  CREATE TABLE repository_revisions (
      revision_id    TEXT PRIMARY KEY,
      repo_id        TEXT NOT NULL REFERENCES repositories(repo_id) ON DELETE CASCADE,
      byte_count     INTEGER NOT NULL,
      content_hash   TEXT NOT NULL,           -- sha256 of the tarball, hex
      bytes          BYTEA NOT NULL,
      pushed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      pushed_by      TEXT NOT NULL,
      correlation_id TEXT NOT NULL
  );

  CREATE INDEX repository_revisions_by_repo
      ON repository_revisions (repo_id, pushed_at DESC);
  ```

  Per-tenant — lives in each tenant's per-tenant DB, not control-plane. Mirrored stub object-store in IDB schema (`db.ts`) for parity-test sanity, even if reads/writes throw.

- **atlasctl** — **NEW** `apps/atlasctl/src/commands/push.ts`:
  - `atlasctl push <dir> [--repo <slug>] [--name <name>]`
  - Steps: tar.gz the directory, sha256 the bytes, base64-encode, build two intent envelopes (`Repository.Create` if `--repo` not provided / repo doesn't exist; `Repository.Upload` always). Submit through the existing `intents submit` machinery so auth + correlationId handling is shared.
  - Phase A surface — wires through HTTP only. No SSH, no git protocol.

  Also **NEW** `apps/atlasctl/src/commands/repo.ts`:
  - `atlasctl repo list` → `GET /api/v1/repositories`
  - `atlasctl repo show <slug>` → `GET /api/v1/repositories/:repoId`
  - `atlasctl repo download <slug> [--revision <id>] [--out <path>]` → streams the tarball to disk.

- **UI surfaces** — **none in this slice.** Tenant-home gets a "Your repositories" list block in a follow-up frontend slice; the API surface lands first so atlasctl can drive it.

## End-to-End Flow

1. Tenant runs `atlasctl push ./hello-world`.
2. CLI builds a tar.gz of the directory in memory; computes sha256; base64-encodes.
3. CLI POSTs `Repository.Create` intent (idempotent on `(tenantId, repoSlug)` — returns the existing `repoId` if it's already there, mints a new one otherwise).
4. CLI POSTs `Repository.Upload` intent with `{repoId, byteCount, contentHash, bytesBase64}`. Standard ingress pipeline runs (authz, idempotency, schema validation against the upload size cap).
5. `handleRepositoryUpload` decodes the base64, asserts hash matches, asserts byte count ≤ cap, mints a `revisionId`, emits `Repository.Uploaded` event with `cacheInvalidationTags: ['Tenant:${tenantId}', 'Repository:${repoId}', 'Revision:${revisionId}']`.
6. Dispatcher chain:
   a. `repositoryDispatcher` projection rebuild — `repository_summary` updates the latest revision pointer; `revision_list` appends.
   b. `cacheTagDispatcher(cache)` purges cached query results tagged `Repository:${repoId}` so the next `atlasctl repo show` is fresh.
   c. `serverEventDispatcher` broadcasts the event to SSE subscribers (admin UI live updates, when added).
7. Server returns 202 with the `revisionId` and `correlationId`.
8. CLI prints `pushed: <slug> revision <revisionId> (<byteCount> bytes)`.
9. Tenant runs `atlasctl repo show hello-world` — the GET goes through `evaluateRead`, hits the `repository_summary` projection, returns `{repoId, repoSlug, latestRevisionId, ...}`.

## What's Stubbed Today

**Nothing.** This is greenfield. The closest analogue is `tenancy/custom-domains` (operator-script + port + adapter shape) for the read-side, and `tenancy/public-signup` (handler + event + dispatcher + atlasctl wrapper) for the write-side. Both are pattern references; this capability is not extending them.

## What's NOT in scope

- **Building the tarball into an artifact.** That's the next slice (`code/pipeline/build-tarball` or similar). This capability stops at "bytes are stored, query them back."
- **Container-registry push.** `code/artifact-registry` capability, separate slice.
- **Deployment to a cluster.** `compute/runtime/deploy` capability, separate slice.
- **Git-protocol ingress.** Phase 3 of the project plan; same Repository entity, different transport.
- **Object-storage backing.** Phase 1 stores bytes in Postgres BYTEA per-tenant. When `storage/object-storage` lands, the `RepositoryRevisionStore` adapter migrates to object-storage with a one-shot batch job; the port surface stays the same.
- **Streaming uploads.** Phase 1 is base64-in-JSON, simple. When tarballs grow past the cap, the next slice introduces presigned-URL multipart upload to object-storage.
- **Upload size > 10 MB.** The Phase 1 cap is **10 MB compressed**. Tenants who need more wait for the storage upgrade slice. Hard reject at the schema validation step; clear error code (`UPLOAD_TOO_LARGE`).
- **Quota enforcement.** No quota check on repo count or total bytes today. Commerce/quotas capability adds that pre-check before this can ship to anything reachable from the public internet.
- **Repository deletion / rename / archival.** Each is a separate capability under this domain.
- **SSH key management or push-permission ABAC.** Phase 3 with the git transport.
- **Webhook / on-push trigger emission.** That's the workflow platform's job. This slice only emits `Repository.Uploaded`; the workflow trigger spec consumes it.
- **Frontend UI surface.** Tenant-home dashboard "your repositories" tile is a separate frontend slice.
- **`atlasctl push` automatic gitignore handling.** Phase 1 tarballs the directory verbatim except for `.git/` and `node_modules/` (hardcoded skip list). A `.atlasignore` file is a future addition.

## File-by-File Plan (for the implementation PR)

In execution order. Each step is a separate logical change but they ship as one PR.

1. **Migration** — `adapters/node/src/migrations/tenant/<timestamp>_repositories.sql` — schema above.

2. **Port** — `ports/src/repository-store.ts`:

   ```ts
   export interface RepositoryRecord {
     repoId: string; repoSlug: string; name: string;
     description: string | null; createdAt: string; createdBy: string;
   }
   export interface RevisionRecord {
     revisionId: string; repoId: string; byteCount: number;
     contentHash: string; pushedAt: string; pushedBy: string;
     correlationId: string;
   }
   export interface RepositoryStore {
     getBySlug(tenantId: string, repoSlug: string): Promise<RepositoryRecord | null>;
     get(tenantId: string, repoId: string): Promise<RepositoryRecord | null>;
     list(tenantId: string): Promise<readonly RepositoryRecord[]>;
     create(tenantId: string, input: { repoId; repoSlug; name; description?; createdBy }): Promise<void>;
   }
   export interface RepositoryRevisionStore {
     getMetadata(tenantId: string, revisionId: string): Promise<RevisionRecord | null>;
     listForRepo(tenantId: string, repoId: string): Promise<readonly RevisionRecord[]>;
     getBytes(tenantId: string, revisionId: string): Promise<Uint8Array | null>;
     append(tenantId: string, input: {
       revisionId; repoId; bytes: Uint8Array;
       byteCount; contentHash; pushedBy; correlationId;
     }): Promise<void>;
   }
   ```

   Re-exported from `ports/src/index.ts`.

3. **Adapters** — `adapters/node/src/repository-store.ts` (`PostgresRepositoryStore`, `PostgresRepositoryRevisionStore`). `adapter-idb`: throw-stub.

4. **Module** — `modules/repository/` per the standard skeleton (`modules/CLAUDE.md`). Two handlers, two events, two projections, registry, dispatcher, error class. Cache tags asserted in handler tests.

5. **Schemas** — `specs/schemas/contracts/repository.create.intent.schema.json` and `repository.upload.intent.schema.json`. Upload schema enforces `byteCount <= 10485760` (10 MB).

6. **Routes** — `apps/server/src/routes/repositories.ts`. Read-only routes (4 endpoints listed above). Writes go through `routes/intents.ts` automatically once the action ids are registered.

7. **Bootstrap** — `apps/server/src/bootstrap.ts`. Wire the two new stores into `AppState`. Update `middleware/state.ts` to add `repositoryDispatcher` to the chain. Mirror in `apps/projection-worker/src/tenant-loop.ts` (worker parity).

8. **atlasctl** — `apps/atlasctl/src/commands/push.ts` and `repo.ts`. Wire into `apps/atlasctl/src/main.ts`.

9. **Contract tests** — `packages/contract-tests/src/repository-store.test.ts`. Round-trip create → list → upload → list-revisions → download bytes. Node passes; idb skipped (server-only).

10. **Integration test** — `tests/integration/upload-tarball.itest.ts`. End-to-end: signs in via the existing public-signup helper, runs an in-process atlasctl push against a fixture dir, asserts the bytes round-trip via the download route. Skipped silently when stack isn't up.

11. **Lexicon** — `specs/LEXICON.md` adds `Repository`, `Revision`, `Tarball`.

12. **Domain map** — root `CLAUDE.md` + `specs/CLAUDE.md` flip the `code` platform from net-new-stub to active in the index.

## Things That DON'T Change

- **`apps/server/src/routes/intents.ts`** — unchanged. New action ids register through the existing handler-registry composition.
- **`Mailer` port** — unchanged. No emails in this capability.
- **Tenant-home route (`apps/server/src/routes/tenant-home.ts`)** — unchanged. The "your repositories" tile is a separate frontend slice.
- **Existing modules (`authz`, `catalog`, `content-pages`, `identity`, `tenancy`)** — unchanged. The new module is additive.
- **dep-cruiser config** — unchanged. The new module follows the same hexagonal rules; no new boundary exceptions.
- **`@atlas/api-client`** — no changes in this slice (no frontend surface lands).
- **`compose.smtp4dev.yml`** and the smtp-mailer chain — unchanged.

If a future change *does* alter any of the above, it's a sign the capability is exceeding scope; revisit this spec.

## Acceptance

Tests the implementation PR must include:

- **Migration test** — fresh tenant DB has `repositories` + `repository_revisions` tables with the documented columns and constraints.
- **Handler tests** — `modules/repository/test/handlers.test.ts`:
  - `Repository.Create > emits Repository.Created with cacheInvalidationTags ['Tenant:${tenantId}', 'Repository:${repoId}']`
  - `Repository.Create > idempotent on (tenantId, repoSlug)`
  - `Repository.Upload > emits Repository.Uploaded with cacheInvalidationTags including Revision:${revisionId}`
  - `Repository.Upload > rejects payload over 10 MB with code UPLOAD_TOO_LARGE`
  - `Repository.Upload > rejects when contentHash mismatches decoded bytes`
- **Dispatch test (I12)** — `modules/repository/test/dispatch.test.ts` — replay the synthetic event stream `[Created, Uploaded, Uploaded]` and assert `repository_summary` + `revision_list` projections rebuild identically to in-line dispatch.
- **Adapter contract test** — `packages/contract-tests/src/repository-store.test.ts > PostgresRepositoryStore > round-trip create → list → upload → list-revisions → download bytes`. IDB suite skipped (server-only, throw-stub).
- **Route tests** — `apps/server/test/routes/repositories.test.ts`:
  - `GET /api/v1/repositories > returns tenant's repos only`
  - `GET /.../bytes > tenant A cannot fetch tenant B's revision (I7)`
- **Integration test** — `tests/integration/upload-tarball.itest.ts > push then download round-trips bytes`. Reuses the public-signup test helper to mint a signed-in session, then drives `atlasctl push` in-process. Skipped silently when stack isn't up.
- **Boundary checks** — `pnpm typecheck` + `pnpm deps:check` (0 errors) + `pnpm lint` (no new errors) + `pnpm test`.

## Cross-References

- Platform README: [`../../README.md`](../../README.md)
- Domain README: [`../README.md`](../README.md)
- ADR introducing the Code platform: [`../../../../decisions/0002-developer-platform-domain-map.md`](../../../../decisions/0002-developer-platform-domain-map.md)
- Vision: [`../../../../vision.md`](../../../../vision.md)
- Architecture invariants: [`../../../../architecture.md`](../../../../architecture.md)
- Capability template: [`../../../../_capability-template.md`](../../../../_capability-template.md)
- Pattern reference (write-side, atlasctl, intent flow): [`../../../tenancy/capabilities/public-signup/README.md`](../../../tenancy/capabilities/public-signup/README.md)
- Pattern reference (read-side adapter shape): [`../../../tenancy/capabilities/custom-domains/README.md`](../../../tenancy/capabilities/custom-domains/README.md)
- Module conventions: [`../../../../../modules/CLAUDE.md`](../../../../../modules/CLAUDE.md)
- atlasctl spec: [`../../../../crosscut/atlasctl.md`](../../../../crosscut/atlasctl.md) (Phase A includes `intents submit`; `push` is a thin wrapper over it)
- Code-owner: [`../../../../../.claude/agents/code-owner.md`](../../../../../.claude/agents/code-owner.md)
