/**
 * `atlasctl repo` — read-side commands for repositories.
 *
 *   atlasctl repo list
 *   atlasctl repo show <slug>
 *   atlasctl repo download <slug> [--revision <id>] [--out <path>]
 *
 * All commands route through `request()` in `../client.ts`, so credential
 * resolution + correlationId propagation live in one place.
 */

import { createWriteStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isAbsolute, join, resolve as pathResolve } from 'node:path';
import { request, type ClientOptions } from '../client.ts';
import { emitResult, type OutputFlags } from '../output.ts';
import { readRepoArray } from './push.ts';

interface RepoSummary {
  repoId: string;
  repoSlug: string;
  name?: string;
  latestRevisionId?: string;
  latestPushedAt?: string;
  totalRevisions?: number;
  byteCount?: number;
}

export async function runRepoList(
  client: ClientOptions,
  flags: OutputFlags,
): Promise<number> {
  const res = await request(client, { method: 'GET', path: '/api/v1/repositories' });
  if (res.status < 200 || res.status >= 300) {
    emitResult(flags, {
      correlationId: res.correlationId,
      status: 'error',
      message: `repo list failed (HTTP ${res.status})`,
      errorCode: extractErrorCode(res.body) ?? 'LIST_FAILED',
      httpStatus: res.status,
      data: res.body,
    });
    return 1;
  }

  const repos = readFullRepoArray(res.body);

  if (flags.json) {
    emitResult(flags, {
      correlationId: res.correlationId,
      status: 'ok',
      data: repos,
    });
    return 0;
  }

  if (flags.quiet) return 0;

  if (repos.length === 0) {
    process.stdout.write('(no repositories)\n');
    return 0;
  }

  // Tabular output. Columns chosen to match what `repo show` would
  // surface: slug, latest revision, total revisions, latest pushed-at.
  const rows: string[][] = [
    ['SLUG', 'LATEST REVISION', 'REVISIONS', 'PUSHED AT'],
  ];
  for (const r of repos) {
    rows.push([
      r.repoSlug,
      r.latestRevisionId ?? '-',
      r.totalRevisions !== undefined ? String(r.totalRevisions) : '-',
      r.latestPushedAt ?? '-',
    ]);
  }
  process.stdout.write(formatTable(rows));
  return 0;
}

export async function runRepoShow(
  client: ClientOptions,
  slug: string,
  flags: OutputFlags,
): Promise<number> {
  const repo = await findBySlug(client, slug);
  if (repo === null) {
    emitResult(flags, {
      correlationId: client.correlationId,
      status: 'error',
      message: `repository "${slug}" not found`,
      errorCode: 'REPO_NOT_FOUND',
    });
    return 1;
  }

  // Prefer the detail endpoint when reachable — it carries fields the
  // list view may omit. Fall back to the list row if detail isn't wired.
  const detailRes = await request(client, {
    method: 'GET',
    path: `/api/v1/repositories/${encodeURIComponent(repo.repoId)}`,
  });
  const detail =
    detailRes.status >= 200 && detailRes.status < 300 ? detailRes.body : repo;
  const correlationId =
    detailRes.status >= 200 && detailRes.status < 300
      ? detailRes.correlationId
      : client.correlationId;

  if (flags.json) {
    emitResult(flags, { correlationId, status: 'ok', data: detail });
    return 0;
  }

  if (flags.quiet) return 0;

  const obj = (typeof detail === 'object' && detail !== null
    ? (detail as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const lines: string[] = [];
  lines.push(`slug:           ${str(obj['repoSlug']) ?? slug}`);
  lines.push(`repoId:         ${str(obj['repoId']) ?? repo.repoId}`);
  if (str(obj['name'])) lines.push(`name:           ${str(obj['name'])}`);
  if (str(obj['description'])) lines.push(`description:    ${str(obj['description'])}`);
  if (str(obj['createdAt'])) lines.push(`createdAt:      ${str(obj['createdAt'])}`);
  if (str(obj['createdBy'])) lines.push(`createdBy:      ${str(obj['createdBy'])}`);
  if (str(obj['latestRevisionId']))
    lines.push(`latestRevision: ${str(obj['latestRevisionId'])}`);
  if (str(obj['latestPushedAt']))
    lines.push(`latestPushedAt: ${str(obj['latestPushedAt'])}`);
  if (typeof obj['totalRevisions'] === 'number')
    lines.push(`totalRevisions: ${obj['totalRevisions']}`);
  if (typeof obj['byteCount'] === 'number')
    lines.push(`byteCount:      ${obj['byteCount']}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

export async function runRepoDownload(
  client: ClientOptions,
  slug: string,
  revisionFlag: string | undefined,
  outFlag: string | undefined,
  flags: OutputFlags,
): Promise<number> {
  const repo = await findBySlug(client, slug);
  if (repo === null) {
    emitResult(flags, {
      correlationId: client.correlationId,
      status: 'error',
      message: `repository "${slug}" not found`,
      errorCode: 'REPO_NOT_FOUND',
    });
    return 1;
  }

  // Resolve revision: explicit flag wins; otherwise look up the repo's
  // latestRevisionId via detail or summary.
  let revisionId = revisionFlag;
  if (!revisionId || revisionId === '') {
    revisionId =
      repo.latestRevisionId ??
      (await fetchLatestRevisionId(client, repo.repoId)) ??
      undefined;
  }
  if (!revisionId || revisionId === '') {
    emitResult(flags, {
      correlationId: client.correlationId,
      status: 'error',
      message: `no revision known for "${slug}"; pass --revision`,
      errorCode: 'REVISION_NOT_FOUND',
    });
    return 1;
  }

  const outPath = resolveOutPath(outFlag, slug, revisionId);

  // Stream the bytes to disk via the underlying fetch. We intentionally
  // bypass `request()` here because that helper buffers the response
  // body via `res.text()` — fine for JSON, wasteful for tarballs.
  const url = new URL(
    `/api/v1/repositories/${encodeURIComponent(repo.repoId)}/revisions/${encodeURIComponent(revisionId)}/bytes`,
    client.endpoint,
  ).toString();
  const headers = buildHeaders(client);
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    emitResult(flags, {
      correlationId: res.headers.get('x-correlation-id') ?? client.correlationId,
      status: 'error',
      message: `download failed (HTTP ${res.status})`,
      errorCode: extractErrorCode(body) ?? 'DOWNLOAD_FAILED',
      httpStatus: res.status,
      data: body,
    });
    return 1;
  }

  if (res.body === null) {
    emitResult(flags, {
      correlationId: res.headers.get('x-correlation-id') ?? client.correlationId,
      status: 'error',
      message: 'empty response body',
      errorCode: 'DOWNLOAD_FAILED',
    });
    return 1;
  }

  const dest = createWriteStream(outPath);
  // `fetch` returns a web ReadableStream; Node's `Readable.fromWeb` gives
  // us a node-side stream we can pipe. Available in Node 18+.
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, dest);

  const correlationId =
    res.headers.get('x-correlation-id') ?? client.correlationId;
  if (flags.json) {
    emitResult(flags, {
      correlationId,
      status: 'ok',
      data: { repoSlug: slug, repoId: repo.repoId, revisionId, path: outPath },
    });
  } else if (!flags.quiet) {
    process.stdout.write(`${outPath}\n`);
  }
  return 0;
}

// ---------- helpers ----------

function buildHeaders(client: ClientOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Correlation-Id': client.correlationId,
    Accept: 'application/gzip, application/octet-stream, */*',
  };
  if (client.credential.kind === 'api-key') {
    headers['X-Api-Key'] = client.credential.key;
  } else if (client.credential.kind === 'token') {
    headers['Authorization'] = `Bearer ${client.credential.token}`;
  } else if (client.credential.kind === 'debug-principal') {
    headers['X-Debug-Principal'] = client.credential.value;
  }
  return headers;
}

async function findBySlug(
  client: ClientOptions,
  slug: string,
): Promise<RepoSummary | null> {
  const res = await request(client, { method: 'GET', path: '/api/v1/repositories' });
  if (res.status < 200 || res.status >= 300) return null;
  const list = readFullRepoArray(res.body);
  return list.find((r) => r.repoSlug === slug) ?? null;
}

async function fetchLatestRevisionId(
  client: ClientOptions,
  repoId: string,
): Promise<string | null> {
  try {
    const res = await request(client, {
      method: 'GET',
      path: `/api/v1/repositories/${encodeURIComponent(repoId)}`,
    });
    if (res.status < 200 || res.status >= 300) return null;
    return str(
      typeof res.body === 'object' && res.body !== null
        ? (res.body as Record<string, unknown>)['latestRevisionId']
        : undefined,
    );
  } catch {
    return null;
  }
}

function resolveOutPath(
  outFlag: string | undefined,
  slug: string,
  revisionId: string,
): string {
  // If the user passed a directory, drop a default-named file inside it.
  if (outFlag !== undefined && outFlag !== '') {
    const abs = isAbsolute(outFlag) ? outFlag : pathResolve(process.cwd(), outFlag);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      return join(abs, `${slug}-${revisionId}.tar.gz`);
    }
    return abs;
  }
  return pathResolve(process.cwd(), `${slug}-${revisionId}.tar.gz`);
}

function readFullRepoArray(body: unknown): RepoSummary[] {
  // Tolerant: accept bare arrays or { items | repositories | data: [...] }.
  let arr: unknown;
  if (Array.isArray(body)) arr = body;
  else if (typeof body === 'object' && body !== null) {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o['items'])) arr = o['items'];
    else if (Array.isArray(o['repositories'])) arr = o['repositories'];
    else if (Array.isArray(o['data'])) arr = o['data'];
  }
  if (!Array.isArray(arr)) {
    // Fall back to the lite reader so we still see ids if shape is
    // off-canon — used by `push.ts` for slug→id resolution.
    return readRepoArray(body).map((r) => ({
      repoId: r.repoId,
      repoSlug: r.repoSlug,
    }));
  }
  const out: RepoSummary[] = [];
  for (const e of arr) {
    if (typeof e !== 'object' || e === null) continue;
    const r = e as Record<string, unknown>;
    const id = str(r['repoId']);
    const slug = str(r['repoSlug']);
    if (id === null || slug === null) continue;
    const entry: RepoSummary = { repoId: id, repoSlug: slug };
    const name = str(r['name']);
    if (name !== null) entry.name = name;
    const latest = str(r['latestRevisionId']);
    if (latest !== null) entry.latestRevisionId = latest;
    const pushedAt = str(r['latestPushedAt']);
    if (pushedAt !== null) entry.latestPushedAt = pushedAt;
    if (typeof r['totalRevisions'] === 'number') entry.totalRevisions = r['totalRevisions'];
    if (typeof r['byteCount'] === 'number') entry.byteCount = r['byteCount'];
    out.push(entry);
  }
  return out;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function extractErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b['code'] === 'string') return b['code'];
  if (typeof b['errorCode'] === 'string') return b['errorCode'];
  return undefined;
}

function formatTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const widths: number[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      const cell = row[i] ?? '';
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    }
  }
  const lines: string[] = [];
  for (const row of rows) {
    const padded = row.map((cell, i) => cell.padEnd(widths[i] ?? cell.length));
    lines.push(padded.join('  '));
  }
  return `${lines.join('\n')}\n`;
}
