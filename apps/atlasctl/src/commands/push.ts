/**
 * `atlasctl push <dir>` — tar.gz a directory and push it as a Repository
 * revision.
 *
 * Flow per specs/domains/code/repository/capabilities/upload-tarball:
 *   1. Resolve directory.
 *   2. Build a tar.gz in memory (skip .git, node_modules, dist, .vite).
 *   3. sha256 + base64 the bytes; reject > 10 MB.
 *   4. Resolve repoSlug (--repo flag or basename).
 *   5. Submit `Repository.Create` intent (idempotent at the slug level —
 *      we tolerate the current handler's REPO_SLUG_TAKEN response by
 *      looking up the existing repoId via GET /api/v1/repositories).
 *   6. Submit `Repository.Upload` intent with the tarball bytes.
 *   7. Print `pushed: <slug> revision <revisionId> (<bytes> bytes)`.
 *
 * Auth + correlation come from `ClientOptions`; we route every HTTP call
 * through `request()` in `../client.ts` so the credential + header logic
 * is not duplicated.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve as pathResolve } from 'node:path';
import { create as tarCreate } from 'tar';
import { request, type ClientOptions } from '../client.ts';
import { asRecord, errorMessage, readString } from '../json.ts';
import { emitResult, type OutputFlags } from '../output.ts';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — Phase 1 cap.
const SKIP_DIRS: ReadonlySet<string> = new Set([
    '.git',
    'node_modules',
    'dist',
    '.vite',
]);
export interface PushOptions {
    dir: string;
    repoSlug?: string | undefined;
    name?: string | undefined;
    description?: string | undefined;
    tenantId?: string | undefined;
    debug?: boolean;
}
export async function runPush(client: ClientOptions, opts: PushOptions, flags: OutputFlags): Promise<number> {
    // Step 1 — resolve the directory.
    const dirAbs = isAbsolute(opts.dir) ? opts.dir : pathResolve(process.cwd(), opts.dir);
    if (!existsSync(dirAbs)) {
        return fail(client, flags, `directory not found: ${opts.dir}`, 'BAD_INPUT');
    }
    const st = statSync(dirAbs);
    if (!st.isDirectory()) {
        return fail(client, flags, `not a directory: ${opts.dir}`, 'BAD_INPUT');
    }
    // Step 2 — build tarball.
    let tarBytes: Uint8Array;
    try {
        tarBytes = await buildTarball(dirAbs);
    }
    catch (e) {
        return fail(client, flags, `tar failed: ${errorMessage(e)}`, 'TAR_FAILED');
    }
    // Step 3 — size guard.
    if (tarBytes.byteLength > MAX_BYTES) {
        return fail(client, flags, `tarball is ${tarBytes.byteLength} bytes; exceeds the ${MAX_BYTES}-byte (10 MB) Phase 1 cap`, 'UPLOAD_TOO_LARGE');
    }
    if (tarBytes.byteLength === 0) {
        return fail(client, flags, 'tarball is empty', 'BAD_INPUT');
    }
    // Step 4 — sha256 + base64.
    const contentHash = createHash('sha256').update(tarBytes).digest('hex');
    const bytesBase64 = Buffer.from(tarBytes).toString('base64');
    // Step 5 — resolve slug.
    const repoSlug = opts.repoSlug ?? basename(dirAbs);
    if (!isValidSlug(repoSlug)) {
        return fail(client, flags, `repoSlug "${repoSlug}" is not kebab-case (lowercase letters/digits/hyphens, 1-63 chars)`, 'BAD_INPUT');
    }
    // Resolve tenantId for the envelope. Source order:
    //   1. --tenant flag (opts.tenantId).
    //   2. ATLAS_TENANT_ID env var.
    //   3. third component of --debug-principal (e.g. "user:tester:dev-tenant").
    // The server's submitIntent rejects with TENANT_MISMATCH if this disagrees
    // with the resolved principal's tenantId, so guessing wrong is a clear
    // 403 — not silent corruption.
    const tenantId = opts.tenantId ?? process.env['ATLAS_TENANT_ID'] ?? null;
    if (tenantId === null || tenantId === '') {
        return fail(client, flags, 'tenantId not resolvable: pass --tenant <id>, set ATLAS_TENANT_ID, or include the tenant in --debug-principal (user:id:tenantId)', 'BAD_INPUT');
    }
    const name = opts.name ?? repoSlug;
    const description = opts.description;
    // Step 6 — submit Repository.Create.
    const createCorrId = client.correlationId;
    if (opts.debug === true) {
        process.stderr.write(`debug: create correlationId=${createCorrId}\n`);
    }
    const createEnvelope = buildCreateEnvelope({
        tenantId,
        correlationId: createCorrId,
        repoSlug,
        name,
        description,
    });
    const createRes = await request(client, {
        method: 'POST',
        path: '/api/v1/intents',
        body: createEnvelope,
    });
    const createOk = createRes.status >= 200 && createRes.status < 300;
    const createConflict = createRes.status === 409 ||
        extractErrorCode(createRes.body) === 'REPO_SLUG_TAKEN';
    if (!createOk && !createConflict) {
        return fail(client, flags, `Repository.Create failed (HTTP ${createRes.status}): ${describeError(createRes.body)}`, extractErrorCode(createRes.body) ?? 'CREATE_FAILED', createRes.correlationId);
    }
    // Step 7 — resolve repoId. Look up via the read-side list endpoint and
    // find by slug. (The intent response does not echo the repoId — it only
    // returns { eventId, tenantId, principalId }.)
    const repoId = await resolveRepoId(client, repoSlug);
    if (repoId === null) {
        return fail(client, flags, `Repository.Create returned ${createOk ? '202' : 'conflict'} but slug "${repoSlug}" was not found via GET /api/v1/repositories — server projection lag or routing not wired yet`, 'REPO_NOT_FOUND', createRes.correlationId);
    }
    // Step 8 — submit Repository.Upload.
    const uploadCorrId = randomUUID();
    if (opts.debug === true) {
        process.stderr.write(`debug: upload correlationId=${uploadCorrId}\n`);
    }
    const uploadEnvelope = buildUploadEnvelope({
        tenantId,
        correlationId: uploadCorrId,
        repoId,
        byteCount: tarBytes.byteLength,
        contentHash,
        bytesBase64,
    });
    const uploadClient: ClientOptions = { ...client, correlationId: uploadCorrId };
    const uploadRes = await request(uploadClient, {
        method: 'POST',
        path: '/api/v1/intents',
        body: uploadEnvelope,
    });
    if (uploadRes.status < 200 || uploadRes.status >= 300) {
        return fail(client, flags, `Repository.Upload failed (HTTP ${uploadRes.status}): ${describeError(uploadRes.body)}`, extractErrorCode(uploadRes.body) ?? 'UPLOAD_FAILED', uploadRes.correlationId);
    }
    // Step 9 — surface the revision id. The server response is { eventId,
    // tenantId, principalId }; we surface eventId as the revisionId
    // identifier callers can grep audit logs for. For the strict "revisionId"
    // shape, we look it up via GET /api/v1/repositories/:repoId — best-effort.
    const eventId = readStringField(uploadRes.body, 'eventId') ?? '';
    let revisionId = eventId;
    const detail = await fetchRepoDetail(client, repoId);
    if (detail !== null) {
        const latest = readStringField(detail, 'latestRevisionId');
        if (latest !== null)
            revisionId = latest;
    }
    if (flags.json) {
        emitResult(flags, {
            correlationId: uploadRes.correlationId,
            status: 'ok',
            data: {
                repoSlug,
                repoId,
                revisionId,
                byteCount: tarBytes.byteLength,
            },
        });
    }
    else if (!flags.quiet) {
        process.stdout.write(`pushed: ${repoSlug} revision ${revisionId} (${tarBytes.byteLength} bytes)\n`);
    }
    return 0;
}
// ---------- helpers ----------
function isValidSlug(s: string): boolean {
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length >= 1 && s.length <= 63;
}
function fail(client: ClientOptions, flags: OutputFlags, message: string, errorCode: string, correlationId?: string): number {
    emitResult(flags, {
        correlationId: correlationId ?? client.correlationId,
        status: 'error',
        message,
        errorCode,
    });
    return 1;
}
function extractErrorCode(body: unknown): string | undefined {
    const b = asRecord(body);
    if (b === null)
        return undefined;
    return readString(b, 'code') ?? readString(b, 'errorCode') ?? undefined;
}
function describeError(body: unknown): string {
    const b = asRecord(body);
    if (b === null) {
        return typeof body === 'string' ? body : '(no body)';
    }
    const msg = readString(b, 'message') ?? '';
    const code = readString(b, 'code') ?? '';
    if (msg !== '' && code !== '')
        return `[${code}] ${msg}`;
    if (msg !== '')
        return msg;
    if (code !== '')
        return code;
    return JSON.stringify(b);
}
function readStringField(body: unknown, key: string): string | null {
    const obj = asRecord(body);
    return obj === null ? null : readString(obj, key);
}
interface CreateEnvArgs {
    tenantId: string;
    correlationId: string;
    repoSlug: string;
    name: string;
    description: string | undefined;
}
function buildCreateEnvelope(args: CreateEnvArgs): unknown {
    const payload: Record<string, unknown> = {
        actionId: 'Repository.Create',
        resourceType: 'Repository',
        resourceId: null,
        repoSlug: args.repoSlug,
        name: args.name,
    };
    if (args.description !== undefined)
        payload['description'] = args.description;
    return {
        eventId: `evt-${randomUUID()}`,
        eventType: 'Repository.CreateRequested',
        schemaId: 'repository.create.intent.v1',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        tenantId: args.tenantId,
        correlationId: args.correlationId,
        idempotencyKey: `idem-create-${args.repoSlug}-${randomUUID()}`,
        payload,
    };
}
interface UploadEnvArgs {
    tenantId: string;
    correlationId: string;
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
        tenantId: args.tenantId,
        correlationId: args.correlationId,
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
async function resolveRepoId(client: ClientOptions, repoSlug: string): Promise<string | null> {
    const res = await request(client, { method: 'GET', path: '/api/v1/repositories' });
    if (res.status < 200 || res.status >= 300)
        return null;
    const list = readRepoArray(res.body);
    for (const r of list) {
        if (r.repoSlug === repoSlug)
            return r.repoId;
    }
    return null;
}
async function fetchRepoDetail(client: ClientOptions, repoId: string): Promise<unknown> {
    try {
        const res = await request(client, {
            method: 'GET',
            path: `/api/v1/repositories/${encodeURIComponent(repoId)}`,
        });
        if (res.status < 200 || res.status >= 300)
            return null;
        return res.body;
    }
    catch {
        return null;
    }
}
interface RepoLite {
    repoId: string;
    repoSlug: string;
}
export function readRepoArray(body: unknown): RepoLite[] {
    // Tolerant: accept either a bare array or { items: [...] } / { repositories: [...] }.
    let arr: readonly unknown[] | null = null;
    if (Array.isArray(body)) {
        arr = body;
    }
    else {
        const o = asRecord(body);
        if (o !== null) {
            if (Array.isArray(o['items']))
                arr = o['items'];
            else if (Array.isArray(o['repositories']))
                arr = o['repositories'];
            else if (Array.isArray(o['data']))
                arr = o['data'];
        }
    }
    if (arr === null)
        return [];
    const out: RepoLite[] = [];
    for (const e of arr) {
        const r = asRecord(e);
        if (r === null)
            continue;
        const id = readString(r, 'repoId');
        const slug = readString(r, 'repoSlug');
        if (id !== null && slug !== null)
            out.push({ repoId: id, repoSlug: slug });
    }
    return out;
}
/**
 * Build a tar.gz of the directory's contents into an in-memory buffer.
 * Skips the hardcoded directory blacklist anywhere in the tree. Uses
 * `tar.create({ gzip, portable })` and pipes through a temp file because
 * the `tar` package's stream interface in this project's pinned version
 * exposes its readable as a `Stream`-shaped object that doesn't satisfy
 * the modern `ReadableStream` interface; the file detour is a fixed-cost
 * disk write capped by MAX_BYTES + a small margin.
 */
async function buildTarball(dirAbs: string): Promise<Uint8Array> {
    const tmp = mkdtempSync(join(tmpdir(), 'atlasctl-push-'));
    const outPath = join(tmp, 'archive.tar.gz');
    try {
        await tarCreate({
            gzip: true,
            portable: true,
            cwd: dirAbs,
            file: outPath,
            filter: function (relPath: string): boolean {
                return shouldInclude(relPath);
            },
        }, ['.']);
        return readFileSync(outPath);
    }
    finally {
        try {
            rmSync(tmp, { recursive: true, force: true });
        }
        catch {
            // Best-effort cleanup; do not mask the underlying error.
        }
    }
}
function shouldInclude(relPath: string): boolean {
    // tar paths arrive with `./` prefix and forward slashes regardless of
    // platform, but normalise defensively.
    const normalized = relPath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(function (p) {
        return p !== '' && p !== '.';
    });
    for (const part of parts) {
        if (SKIP_DIRS.has(part))
            return false;
    }
    return true;
}
// Re-export for unit tests.
export const __test = { isValidSlug, shouldInclude, MAX_BYTES, SKIP_DIRS };
