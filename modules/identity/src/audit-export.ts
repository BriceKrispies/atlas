/**
 * Audit-export pipeline core (Phase A4.9).
 *
 * Pure business logic: drains a tenant's events past the export
 * cursor, JSON-Lines serializes, hands the buffer to a pluggable
 * `Uploader` (S3, MinIO, in-memory mock for tests). Advances the
 * cursor on success. Records each pass as an `AuditExportRun`
 * entity.
 *
 * The worker lives at `scripts/audit-export.ts` (Phase A4.9 ships it
 * as a one-shot script; long-running daemon mode lifts later).
 */
import type { EntityStore, EventStore } from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import type { AuditExportConfigDocument, AuditExportRunDocument, AuditExportS3Destination, } from './types.ts';
import { newAuditExportRunId } from './ids.ts';
import { getAuditExportConfig, putAuditExportConfig, putAuditExportRun, } from './entities/audit-export-config.ts';
import { shouldExportEvent } from './audit-retention.ts';
import { must } from './internal/assert.ts';
/**
 * Read `.message` from an arbitrary thrown value. `catch` clauses are
 * typed `unknown`; narrow without an unsafe cast.
 */
function errMessage(e: unknown): string {
    if (e instanceof Error)
        return e.message;
    return String(e);
}
/**
 * Object-store uploader. Receives the JSON-Lines buffer + a
 * destination spec; returns the count of bytes pushed (caller
 * records it on the run document).
 */
export interface Uploader {
    upload(destination: AuditExportS3Destination, objectKey: string, body: Buffer): Promise<{
        bytes: number;
    }>;
}
/**
 * In-memory uploader for tests. Stores everything in `pushed[]`;
 * the test asserts on it.
 */
export class InMemoryUploader implements Uploader {
    pushed: Array<{
        destination: AuditExportS3Destination;
        key: string;
        body: Buffer;
    }> = [];
    async upload(destination: AuditExportS3Destination, objectKey: string, body: Buffer): Promise<{
        bytes: number;
    }> {
        this.pushed.push({ destination, key: objectKey, body });
        return { bytes: body.byteLength };
    }
}
export interface AuditExportRunOptions {
    /**
     * Maximum events drained per pass. Bounded so a backlog doesn't
     * produce a single multi-GB push. Worker schedules another pass
     * if the cursor caught up.
     */
    maxBatch?: number;
    /**
     * Object-key prefix template. Defaults to
     * `audit/<tenantId>/<runId>.jsonl` — overridable for tenants that
     * want a date-partitioned layout.
     */
    objectKey?: (ctx: {
        tenantId: string;
        runId: string;
        isoDate: string;
    }) => string;
}
/**
 * One export pass. Idempotent on failure — the cursor only advances
 * after the upload succeeds. A failed run leaves the config's
 * `lastFailureAt` + `lastFailureReason` set; the next call retries
 * from the same cursor.
 */
export async function runAuditExport(config: AuditExportConfigDocument, uploader: Uploader, eventStore: EventStore, entities: EntityStore, opts: AuditExportRunOptions = {}): Promise<AuditExportRunDocument> {
    const startedAt = new Date().toISOString();
    const runId = newAuditExportRunId();
    const fromCursor = config.cursor ?? '0';
    const isoDate = startedAt.slice(0, 10);
    const objectKey = opts.objectKey?.({ tenantId: config.tenantId, runId, isoDate }) ??
        `audit/${config.tenantId}/${isoDate}/${runId}.jsonl`;
    const maxBatch = opts.maxBatch ?? 10000;
    // Drain events past the cursor. The EventStore's `readEvents`
    // returns all events for the tenant in seq order; we filter by
    // seq > fromCursor and clip at maxBatch.
    let events: EventEnvelope[];
    try {
        events = await eventStore.readEvents(config.tenantId);
    }
    catch (e) {
        return await recordFailure(entities, config, runId, startedAt, fromCursor, `event-store read failed: ${errMessage(e)}`);
    }
    const fromSeqN = BigInt(fromCursor);
    const fresh = events
        .filter(function (e) {
        return (e.seq ?? 0n) > fromSeqN;
    })
        // Apply the platform retention floor + tenant filter. Floor tags
        // (`retention:7y`, `retention:10y`) are ALWAYS included, even when
        // the tenant has set a `retentionFilter` that would otherwise
        // exclude them — tenants can lengthen retention but never shorten
        // it. See `audit-retention.ts` for the full pen-test rationale.
        .filter(function (e) {
        return shouldExportEvent(e.retentionTag, config.retentionFilter);
    })
        .slice(0, maxBatch);
    if (fresh.length === 0) {
        // Nothing to do — record an empty success run.
        const run: AuditExportRunDocument = {
            runId,
            tenantId: config.tenantId,
            configId: config.configId,
            startedAt,
            endedAt: new Date().toISOString(),
            fromCursor,
            toCursor: fromCursor,
            status: 'succeeded',
            eventCount: 0,
            bytes: 0,
        };
        await putAuditExportRun(entities, run);
        return run;
    }
    // Serialize. Each line is one event envelope (JSON), seq stringified.
    const lines = fresh.map(function (e) {
        return JSON.stringify({
            ...e,
            seq: e.seq?.toString(),
        });
    });
    const body = Buffer.from(lines.join('\n') + '\n', 'utf8');
    let bytes = 0;
    try {
        const uploadResult = await uploader.upload(config.destination, objectKey, body);
        bytes = uploadResult.bytes;
    }
    catch (e) {
        return await recordFailure(entities, config, runId, startedAt, fromCursor, `upload failed: ${errMessage(e)}`);
    }
    // `fresh.length > 0` was checked above, and EventStore always populates
    // `seq` on read. `must` makes the invariants explicit and avoids two `!`.
    const lastEvent = must(fresh[fresh.length - 1], 'fresh.length > 0 guarded above');
    const lastSeq = must(lastEvent.seq, 'EventStore.readEvents populates seq on every event').toString();
    const endedAt = new Date().toISOString();
    const run: AuditExportRunDocument = {
        runId,
        tenantId: config.tenantId,
        configId: config.configId,
        startedAt,
        endedAt,
        fromCursor,
        toCursor: lastSeq,
        status: 'succeeded',
        eventCount: fresh.length,
        bytes,
    };
    await putAuditExportRun(entities, run);
    // Advance the config's cursor + lastSuccessAt.
    await putAuditExportConfig(entities, {
        ...config,
        cursor: lastSeq,
        lastSuccessAt: endedAt,
        updatedAt: endedAt,
    });
    return run;
}
async function recordFailure(entities: EntityStore, config: AuditExportConfigDocument, runId: string, startedAt: string, fromCursor: string, reason: string): Promise<AuditExportRunDocument> {
    const endedAt = new Date().toISOString();
    const run: AuditExportRunDocument = {
        runId,
        tenantId: config.tenantId,
        configId: config.configId,
        startedAt,
        endedAt,
        fromCursor,
        status: 'failed',
        failureReason: reason,
    };
    await putAuditExportRun(entities, run);
    await putAuditExportConfig(entities, {
        ...config,
        lastFailureAt: endedAt,
        lastFailureReason: reason,
        updatedAt: endedAt,
    });
    return run;
}
/**
 * Convenience: load config + run in one call. Used by the worker
 * script (`scripts/audit-export.ts`) and the acceptance tests.
 */
export async function exportTenantAudit(tenantId: string, configId: string, uploader: Uploader, eventStore: EventStore, entities: EntityStore, opts: AuditExportRunOptions = {}): Promise<AuditExportRunDocument> {
    const config = await getAuditExportConfig(entities, tenantId, configId);
    if (!config) {
        throw new Error(`audit export config not found: ${tenantId}/${configId}`);
    }
    if (config.status !== 'active') {
        throw new Error(`audit export config ${configId} is in status ${config.status} (must be active)`);
    }
    return runAuditExport(config, uploader, eventStore, entities, opts);
}
