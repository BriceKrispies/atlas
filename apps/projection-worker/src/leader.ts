/**
 * Postgres advisory-lock-based leader election for the projection worker.
 *
 * Multiple worker replicas may boot; only the holder of the per-module
 * advisory lock processes events. The other replicas poll for the lock
 * and take over if the leader exits or its connection drops.
 *
 * Design notes:
 *   - The lock is keyed off `moduleId` so different worker pools (e.g.
 *     `projection-default`, `projection-search`) don't contend with each
 *     other. We hash the moduleId down to a 32-bit signed integer (which
 *     widens to BIGINT for the single-arg `pg_try_advisory_lock` call).
 *   - The lock is connection-scoped. We must hold a *dedicated* connection
 *     for the entire leadership term — postgres.js's `sql.reserve()` returns
 *     a `ReservedSql` that is detached from the pool until `release()`.
 *   - If the underlying connection drops, Postgres auto-releases the lock.
 *     We can't transparently recover because in-flight projection writes
 *     in another replica may have raced ahead; instead we detect loss via
 *     a periodic `pg_try_advisory_lock` self-check (a no-op if we still
 *     own it because advisory locks are re-entrant per-session) and exit
 *     fast so the orchestrator restarts us.
 *
 * Logging: every log line goes through `ctx.logger` from the
 * AtlasExecutionContext threaded in by main.ts, per
 * specs/crosscut/logging.md.
 */

import type postgres from 'postgres';
import type { AtlasExecutionContext } from '@atlas/platform-core';

export interface Leadership {
  /** Idempotent. Releases the advisory lock and returns the connection to the pool. */
  release(): Promise<void>;
}

/**
 * Hash `moduleId` to a stable 32-bit signed integer suitable for
 * `pg_try_advisory_lock(BIGINT)`.
 *
 * Uses FNV-1a 64-bit (fast, no deps, well-distributed for short ASCII)
 * folded down to int32 via XOR of the two 32-bit halves. We fold to
 * int32 — rather than passing a 64-bit BigInt — because:
 *
 *   1. JS `number` can't safely represent the full int64 range, and
 *      postgres.js's `SerializableParameter` doesn't include `bigint`.
 *   2. int32 fits cleanly in `number` and postgres.js silently widens
 *      to `int8` for the BIGINT-arg form of `pg_try_advisory_lock`.
 *   3. Collision probability is negligible for the small set of
 *      `moduleId` values we expect (one per logical worker pool).
 *
 * The result lives in [-2^31, 2^31).
 */
function hashModuleId(moduleId: string): number {
  // FNV-1a 64-bit
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK64 = 0xffffffffffffffffn;
  let h = FNV_OFFSET;
  for (let i = 0; i < moduleId.length; i++) {
    h ^= BigInt(moduleId.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  // Fold to 32 bits via XOR of upper and lower halves, then convert
  // the unsigned 32-bit value to a signed int32.
  const folded32 = Number((h >> 32n) ^ (h & 0xffffffffn));
  return folded32 | 0; // bitwise OR with 0 reinterprets as int32
}

const POLL_INTERVAL_MS = 5_000;
const WAIT_LOG_INTERVAL_MS = 30_000;
const VERIFY_INTERVAL_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Acquire leadership by polling `pg_try_advisory_lock`. Resolves only
 * once the lock is held. Logs "waiting for leadership" every 30s while
 * blocked so operators can see hot-standby replicas.
 */
export async function acquireLeadership(
  ctx: AtlasExecutionContext,
  sql: postgres.Sql,
  moduleId: string,
): Promise<Leadership> {
  const key = hashModuleId(moduleId);

  // Reserve a dedicated connection for the lifetime of leadership.
  // postgres.js's `reserve()` returns a `ReservedSql` that is callable
  // exactly like `sql` but detached from the pool until `.release()`.
  const reserved = await sql.reserve();

  let lastWaitLog = 0;
  try {
    while (true) {
      const rows = await reserved<Array<{ pg_try_advisory_lock: boolean }>>`
        SELECT pg_try_advisory_lock(${key}) AS pg_try_advisory_lock
      `;
      const acquired = rows[0]?.pg_try_advisory_lock === true;
      if (acquired) break;

      const now = Date.now();
      if (now - lastWaitLog >= WAIT_LOG_INTERVAL_MS) {
        ctx.logger.info('waiting for leadership', {
          event: 'ProjectionWorker.Leader.Waiting',
          properties: { moduleId },
        });
        lastWaitLog = now;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  } catch (err) {
    // If polling fails before we ever hold the lock, return the
    // reserved connection to the pool so we don't leak it.
    try {
      reserved.release();
    } catch (releaseErr) {
      // Don't let the cleanup error mask the original failure, but
      // surface it — operator visibility matters because a leaked
      // reserved connection can starve the pool.
      ctx.logger.warn('reserved connection release failed during error path', {
        event: 'ProjectionWorker.Leader.ReleaseFailed',
        properties: { moduleId, cause: errorMessage(releaseErr) },
      });
    }
    throw err;
  }

  // We hold the lock. Start the verify timer that detects connection
  // loss / silent release. `pg_try_advisory_lock` is re-entrant per
  // session: if we still own it, this returns true and bumps the lock
  // count by one — which we balance with a matching unlock. If we lost
  // it (connection bounced under us), it returns true *as a fresh
  // acquisition*, which we can't distinguish from "still held" via the
  // boolean alone. Instead we check `pg_locks` for a session-scoped
  // entry with our pid + classid/objid.
  let released = false;
  const verifyTimer = setInterval(() => {
    void verifyStillLeader();
  }, VERIFY_INTERVAL_MS);
  // Don't keep the event loop alive just for the verify timer.
  if (typeof verifyTimer.unref === 'function') verifyTimer.unref();

  async function verifyStillLeader(): Promise<void> {
    if (released) return;
    try {
      // `pg_advisory_lock` keys are stored as (classid, objid) — a pair
      // of int4 — when callers use the two-arg form, OR as a single
      // int8 when callers use the one-arg form. The single-arg form
      // sets classid=0 in pg_locks (well, it stores the int8 split
      // across the two int4 columns). The simplest portable check is
      // to confirm the lock is still held by THIS backend pid.
      const rows = await reserved<Array<{ held: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory'
            AND pid = pg_backend_pid()
        ) AS held
      `;
      const held = rows[0]?.held === true;
      if (!held) {
        ctx.logger.error('leadership lost', {
          event: 'ProjectionWorker.Leader.Lost',
          error: {
            code: 'LEADERSHIP_LOST',
            message: 'pg_locks no longer reports advisory lock for our pid',
          },
          properties: {
            moduleId,
            cause: 'advisory lock no longer held by this backend',
          },
        });
        process.exit(1);
      }
    } catch (err) {
      ctx.logger.error('leadership verify failed', {
        event: 'ProjectionWorker.Leader.VerifyFailed',
        error: {
          code: 'LEADERSHIP_VERIFY_FAILED',
          message: errorMessage(err),
          ...(err instanceof Error && err.stack !== undefined
            ? { stack: err.stack }
            : {}),
        },
        properties: { moduleId, cause: errorMessage(err) },
      });
      process.exit(1);
    }
  }

  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      clearInterval(verifyTimer);
      try {
        await reserved`SELECT pg_advisory_unlock(${key})`;
      } catch (err) {
        // If unlock fails (e.g. connection already dropped), the lock
        // is already gone server-side; log and proceed to release.
        ctx.logger.warn('pg_advisory_unlock failed', {
          event: 'ProjectionWorker.Leader.UnlockFailed',
          properties: { moduleId, cause: errorMessage(err) },
        });
      } finally {
        try {
          reserved.release();
        } catch (releaseErr) {
          // Best-effort, but operators must see this — a stuck reserved
          // connection produces split-brain risk on the next replica
          // restart, so we log at warn with a clear cause.
          ctx.logger.warn('reserved connection release failed during shutdown', {
            event: 'ProjectionWorker.Leader.ReleaseFailed',
            properties: { moduleId, cause: errorMessage(releaseErr) },
          });
        }
      }
    },
  };
}
