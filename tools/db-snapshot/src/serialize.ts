/**
 * Serialize / deserialize a `SnapshotBundle` to the golden directory.
 *
 * Layout (output dir defaults to `fixtures/golden/`):
 *   control_plane.json
 *   tenants/<tenantId>.json
 *   manifest.json
 *
 * Format contract (so a re-capture of unchanged data produces byte-identical
 * files, making `git diff` meaningful):
 *   - 2-space indent
 *   - FIXED key order (objects re-serialized through `orderKeys`)
 *   - trailing newline
 *
 * `manifest.json` records capturedAt, per-DB table+rowcount, the
 * `_migrations.filename` set per DB, and a sha256 of each DB file.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
    DatabaseSnapshot,
    Manifest,
    ManifestDatabaseEntry,
    SnapshotBundle,
} from './types.ts';

/** Fixed top-level key order for a DatabaseSnapshot. */
const DB_KEY_ORDER = [
    'database',
    'kind',
    'tenantId',
    'connection',
    'migrations',
    'tables',
];
const TABLE_KEY_ORDER = ['table', 'schema', 'columns', 'rows', 'rowCount'];
const CONNECTION_KEY_ORDER = ['dbHost', 'dbPort', 'dbName', 'dbUser', 'dbPassword'];

/**
 * Re-order a plain object's keys to a fixed list (keys not in the list keep
 * their original relative order, appended after). Recursion is shallow — the
 * `rows`/`columns`/jsonb payloads keep their own order (jsonb is compared
 * structurally by diff, so its key order is cosmetic).
 */
function orderKeys(obj: Record<string, unknown>, order: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of order) {
        if (k in obj && obj[k] !== undefined) out[k] = obj[k];
    }
    for (const k of Object.keys(obj)) {
        if (!order.includes(k) && obj[k] !== undefined) out[k] = obj[k];
    }
    return out;
}

/** Serialize one DatabaseSnapshot to the canonical JSON string. */
export function serializeDatabase(db: DatabaseSnapshot): string {
    const ordered = orderKeys(db as unknown as Record<string, unknown>, DB_KEY_ORDER);
    if (ordered['connection'] !== undefined) {
        ordered['connection'] = orderKeys(
            ordered['connection'] as Record<string, unknown>,
            CONNECTION_KEY_ORDER,
        );
    }
    ordered['tables'] = (db.tables ?? []).map((t) =>
        orderKeys(t as unknown as Record<string, unknown>, TABLE_KEY_ORDER),
    );
    return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** sha256 hex of a string. */
export function sha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Filename (relative to golden dir) for a DB snapshot. */
export function fileFor(db: DatabaseSnapshot): string {
    if (db.kind === 'control-plane') return 'control_plane.json';
    return join('tenants', `${db.tenantId}.json`);
}

/**
 * Write a full bundle to `goldenDir`. Returns the manifest.
 */
export async function writeBundle(bundle: SnapshotBundle, goldenDir: string): Promise<Manifest> {
    await mkdir(join(goldenDir, 'tenants'), { recursive: true });
    const entries: ManifestDatabaseEntry[] = [];
    for (const db of bundle.databases) {
        const file = fileFor(db);
        const content = serializeDatabase(db);
        const fullPath = join(goldenDir, file);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, 'utf8');
        const entry: ManifestDatabaseEntry = {
            database: db.database,
            kind: db.kind,
            file: file.split('\\').join('/'),
            sha256: sha256(content),
            tables: db.tables.map((t) => ({
                table: t.table,
                schema: t.schema,
                rowCount: t.rowCount,
            })),
            migrations: db.migrations,
        };
        if (db.tenantId !== undefined) entry.tenantId = db.tenantId;
        entries.push(entry);
    }
    const manifest: Manifest = { capturedAt: bundle.capturedAt, databases: entries };
    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(goldenDir, 'manifest.json'), manifestContent, 'utf8');
    return manifest;
}

/**
 * Load a bundle previously written by `writeBundle`. Reads `manifest.json`,
 * then each DB file it references.
 */
export async function readBundle(goldenDir: string): Promise<SnapshotBundle> {
    const manifestRaw = await readFile(join(goldenDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as Manifest;
    const databases: DatabaseSnapshot[] = [];
    for (const entry of manifest.databases) {
        const raw = await readFile(join(goldenDir, entry.file), 'utf8');
        databases.push(JSON.parse(raw) as DatabaseSnapshot);
    }
    return { capturedAt: manifest.capturedAt, databases };
}

/** List tenant snapshot files under `goldenDir/tenants`. */
export async function listTenantFiles(goldenDir: string): Promise<string[]> {
    try {
        const files = await readdir(join(goldenDir, 'tenants'));
        return files.filter((f) => f.endsWith('.json'));
    } catch {
        return [];
    }
}
