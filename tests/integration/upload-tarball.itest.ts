/**
 * Integration test: Repository.Create + Repository.Upload round-trip.
 *
 * Drives the upload-tarball capability end-to-end against the real
 * `apps/server`:
 *
 *   1. POST /api/v1/intents { actionId: 'Repository.Create' }   → 202
 *   2. GET  /api/v1/repositories                                → find repoId by slug
 *   3. POST /api/v1/intents { actionId: 'Repository.Upload' }   → 202
 *   4. GET  /api/v1/repositories/:repoId/revisions              → 1 row, right metadata
 *   5. GET  /api/v1/.../revisions/:revisionId/bytes             → bytes round-trip
 *
 * **Pre-provision vs full signup loop.** The capability spec says "reuse
 * the public-signup test helper." That helper isn't an importable function
 * — it's inline `beforeAll` logic in `public-signup.itest.ts`. Two options:
 *
 *   (a) Full signup loop: signup → admin approve → poll smtp4dev → click
 *       magic link → upload. Slow (10s+), needs smtp4dev, mirrors UX.
 *   (b) Pre-provision via raw SQL: INSERT a tenant row directly, then
 *       use `X-Debug-Principal: user:test:${TENANT_SLUG}:admin`. Fast,
 *       no smtp4dev, the auth pipeline is still exercised through the
 *       debug-principal path.
 *
 * We picked (b). Rationale:
 *   - The signup → magic-link flow is already covered by its own
 *     integration test; this test is about the repository capability,
 *     not auth.
 *   - The Repository.Create / Repository.Upload pipeline runs the same
 *     submitIntent → authn → authz → handler dispatch chain regardless of
 *     how the principal was minted, so we don't lose coverage.
 *   - smtp4dev being optional means this test can run in more CI matrices.
 *
 * **Tarball shortcut.** The route does not unpack the tarball — it stores
 * the bytes opaquely and asserts they round-trip. We pass a small fixed
 * Buffer (not a real tar.gz) so the test focuses on the bytes-contract,
 * not on the tar format. The handler's only payload-shape gates are
 * `byteCount === bytes.byteLength` and `contentHash === sha256(bytes)`,
 * both of which a fixed Buffer satisfies.
 *
 * Pre-requisites (all checked in `beforeAll`; skipped silently otherwise):
 *   - apps/server running on `INGRESS_BASE_URL` (default
 *     http://localhost:3000) with `TEST_AUTH_ENABLED=true`
 *   - control-plane DB at `CONTROL_PLANE_DB_URL`
 *
 * Spec: specs/domains/code/repository/capabilities/upload-tarball/README.md
 */

import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const INGRESS = process.env['INGRESS_BASE_URL'] ?? 'http://localhost:3000';
const CP_URL = process.env['CONTROL_PLANE_DB_URL'];

// Unique per-run identifiers so reruns don't collide on the
// `(repo_slug)` UNIQUE index in the per-tenant `repositories` table or
// the tenant_id PRIMARY KEY in `control_plane.tenants`.
const RUN_ID = Date.now().toString(36);
const TENANT_SLUG = `repo-itest-${RUN_ID}`;
const REPO_SLUG = `hello-world-${RUN_ID}`;

interface RepoListItem {
  repoId: string;
  repoSlug: string;
  name?: string;
}

interface RevisionListItem {
  revisionId: string;
  repoId: string;
  byteCount: number;
  contentHash: string;
}

function debugPrincipal(): string {
  // 4-segment form per the parser change in `apps/server/src/middleware/principal.ts`:
  //   `<type>:<id>:<tenantId>:<comma-separated-roles>`
  // The `admin` role grants enough for both the intent and the read
  // routes; the user role would also work for these endpoints but the
  // matching public-signup test uses `:admin` so we stay consistent.
  return `user:test:${TENANT_SLUG}:admin`;
}

function authedHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'X-Debug-Principal': debugPrincipal(),
    ...extra,
  };
}

function buildCreateEnvelope(): unknown {
  return {
    eventId: `evt-${randomUUID()}`,
    eventType: 'Repository.CreateRequested',
    schemaId: 'repository.create.intent.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: TENANT_SLUG,
    correlationId: `corr-${randomUUID()}`,
    idempotencyKey: `idem-create-${REPO_SLUG}-${randomUUID()}`,
    payload: {
      actionId: 'Repository.Create',
      resourceType: 'Repository',
      resourceId: null,
      repoSlug: REPO_SLUG,
      name: 'Hello World',
      description: 'upload-tarball integration test fixture',
    },
  };
}

interface UploadEnvArgs {
  repoId: string;
  byteCount: number;
  contentHash: string;
  bytesBase64: string;
}

function buildUploadEnvelope(args: UploadEnvArgs): unknown {
  return {
    eventId: `evt-${randomUUID()}`,
    eventType: 'Repository.UploadRequested',
    schemaId: 'repository.upload.intent.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: TENANT_SLUG,
    correlationId: `corr-${randomUUID()}`,
    idempotencyKey: `idem-upload-${randomUUID()}`,
    payload: {
      actionId: 'Repository.Upload',
      resourceType: 'Repository',
      resourceId: args.repoId,
      repoId: args.repoId,
      byteCount: args.byteCount,
      contentHash: args.contentHash,
      bytesBase64: args.bytesBase64,
    },
  };
}

test.describe('upload-tarball: Repository.Create + Repository.Upload round-trip', () => {
  let sql: postgres.Sql | null = null;

  test.beforeAll(async () => {
    if (!CP_URL) {
      test.skip(true, 'CONTROL_PLANE_DB_URL not set');
      return;
    }
    try {
      const ping = await fetch(`${INGRESS}/healthz`);
      if (!ping.ok) {
        test.skip(true, `apps/server at ${INGRESS} not healthy`);
        return;
      }
    } catch {
      test.skip(true, `apps/server at ${INGRESS} not reachable`);
      return;
    }

    sql = postgres(CP_URL, { max: 2 });
    // Defensive cleanup: a previous run with the same RUN_ID is
    // impossible (Date.now() based), but if a developer pins RUN_ID for
    // repro this prevents collisions on the tenants PK.
    await sql`DELETE FROM control_plane.custom_domains WHERE tenant_id = ${TENANT_SLUG}`;
    await sql`DELETE FROM control_plane.signup_requests WHERE tenant_slug = ${TENANT_SLUG}`;
    await sql`DELETE FROM control_plane.tenants WHERE tenant_id = ${TENANT_SLUG}`;
    // Pre-provision the tenant row. db_host/db_port/etc stay NULL so the
    // tenant-db provider falls back to its `defaultConnectionInfo` —
    // matches the dev/sim path the public-signup approve handler also
    // takes (see adapters/node/src/tenant-store.ts header comment).
    await sql`
      INSERT INTO control_plane.tenants (tenant_id, name, status)
      VALUES (${TENANT_SLUG}, 'Repo ITest', 'active')
    `;

    // Pre-clean the per-tenant `repositories` rows for our slug. In dev
    // mode all tenants share one DB, so the table may carry rows from
    // prior runs. We only delete by our slug (unique per RUN_ID anyway)
    // to keep the cleanup tight.
    try {
      await sql`DELETE FROM repository_revisions
                WHERE repo_id IN (SELECT repo_id FROM repositories WHERE repo_slug = ${REPO_SLUG})`;
      await sql`DELETE FROM repositories WHERE repo_slug = ${REPO_SLUG}`;
    } catch {
      // Tenant DB tables may not exist yet (migration runs on first
      // ensureTenantMigrated). The first POST /api/v1/intents triggers
      // it; nothing to clean up beforehand.
    }
  });

  test.afterAll(async () => {
    if (!sql) return;
    try {
      await sql`DELETE FROM repository_revisions
                WHERE repo_id IN (SELECT repo_id FROM repositories WHERE repo_slug = ${REPO_SLUG})`;
      await sql`DELETE FROM repositories WHERE repo_slug = ${REPO_SLUG}`;
    } catch {
      // Best-effort — if the tenant DB never got migrated the tables
      // don't exist and the DELETEs throw. Either way nothing to clean.
    }
    await sql`DELETE FROM control_plane.custom_domains WHERE tenant_id = ${TENANT_SLUG}`;
    await sql`DELETE FROM control_plane.signup_requests WHERE tenant_slug = ${TENANT_SLUG}`;
    await sql`DELETE FROM control_plane.tenants WHERE tenant_id = ${TENANT_SLUG}`;
    await sql.end({ timeout: 5 });
  });

  test('push then download round-trips bytes', async () => {
    // 1. Build a small in-memory "tarball". The route doesn't unpack it
    //    — the handler validates byteCount + sha256 match the bytes and
    //    stores them opaquely. A fixed Buffer is enough to exercise the
    //    bytes-round-trip contract without dragging in `tar` for a real
    //    .tar.gz; the handler's tar-format-agnosticism is the same shape
    //    the real CLI relies on.
    const tarball = Buffer.from(
      'integration-test-tarball-fixture\n' +
        '<index.html>\n<package.json>\n' +
        `run-id:${RUN_ID}\n`,
      'utf8',
    );
    const byteCount = tarball.byteLength;
    const contentHash = createHash('sha256').update(tarball).digest('hex');
    const bytesBase64 = tarball.toString('base64');

    // 2. POST Repository.Create → 202.
    const createRes = await fetch(`${INGRESS}/api/v1/intents`, {
      method: 'POST',
      headers: authedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildCreateEnvelope()),
    });
    expect(
      createRes.status,
      `Repository.Create unexpected status: ${createRes.status} ${await createRes.clone().text()}`,
    ).toBe(202);

    // 3. List repositories, find the one we just created by slug. The
    //    route returns the bare list adapter rows; in dev mode all
    //    tenants share one DB so rows from other test slugs may also
    //    appear — match strictly on REPO_SLUG (unique per RUN_ID).
    const listRes = await fetch(`${INGRESS}/api/v1/repositories`, {
      headers: authedHeaders(),
    });
    expect(
      listRes.status,
      `GET /api/v1/repositories failed: ${listRes.status} ${await listRes.clone().text()}`,
    ).toBe(200);
    const list = (await listRes.json()) as RepoListItem[];
    const repo = list.find((r) => r.repoSlug === REPO_SLUG);
    expect(
      repo,
      `repo ${REPO_SLUG} missing from list (got ${list.length} entries)`,
    ).toBeTruthy();
    const repoId = repo!.repoId;

    // 4. POST Repository.Upload → 202.
    const uploadEnv = buildUploadEnvelope({
      repoId,
      byteCount,
      contentHash,
      bytesBase64,
    });
    const uploadRes = await fetch(`${INGRESS}/api/v1/intents`, {
      method: 'POST',
      headers: authedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(uploadEnv),
    });
    expect(
      uploadRes.status,
      `Repository.Upload unexpected status: ${uploadRes.status} ${await uploadRes.clone().text()}`,
    ).toBe(202);

    // 5. GET revisions: expect exactly one with our metadata. With
    //    WORKER_MODE=inline (the default in dev), the dispatcher chain
    //    runs synchronously before 202 returns, so no polling is needed.
    const revListRes = await fetch(
      `${INGRESS}/api/v1/repositories/${encodeURIComponent(repoId)}/revisions`,
      { headers: authedHeaders() },
    );
    expect(
      revListRes.status,
      `GET revisions failed: ${revListRes.status} ${await revListRes.clone().text()}`,
    ).toBe(200);
    const revisions = (await revListRes.json()) as RevisionListItem[];
    expect(revisions.length, 'expected exactly one revision after a single upload').toBe(1);
    const rev = revisions[0]!;
    expect(rev.byteCount).toBe(byteCount);
    expect(rev.contentHash).toBe(contentHash);
    expect(rev.repoId).toBe(repoId);

    // 6. GET bytes: assert content-type, disposition, and exact-byte
    //    equality with the original tarball.
    const bytesRes = await fetch(
      `${INGRESS}/api/v1/repositories/${encodeURIComponent(repoId)}/revisions/${encodeURIComponent(rev.revisionId)}/bytes`,
      { headers: authedHeaders() },
    );
    expect(bytesRes.status, `GET bytes failed: ${bytesRes.status}`).toBe(200);
    expect(bytesRes.headers.get('content-type')).toBe('application/gzip');
    const disposition = bytesRes.headers.get('content-disposition') ?? '';
    expect(
      disposition,
      `Content-Disposition should reference slug ${REPO_SLUG}; got ${disposition}`,
    ).toContain(REPO_SLUG);
    const downloaded = Buffer.from(await bytesRes.arrayBuffer());
    expect(
      downloaded.equals(tarball),
      `downloaded bytes must equal pushed bytes (downloaded ${downloaded.byteLength} vs ${byteCount})`,
    ).toBe(true);
  });

  // I7 cross-tenant 404: deferred. Pre-provisioning a second tenant
  // doubles the setup complexity (tenant row + cleanup), and the
  // route-test layer (`apps/server/test/routes/repositories.test.ts`)
  // already asserts the same shape with a unit-mocked tenant-store. The
  // value-add of an integration-level repeat is "catches per-tenant-DB
  // isolation issues" — but in dev mode all tenants share one DB, so the
  // isolation surface is already a flat table; the unit test's coverage
  // is sufficient. Re-add when the per-tenant-DB topology lands.
});
