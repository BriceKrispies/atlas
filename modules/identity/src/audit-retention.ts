/**
 * Phase A7 — Platform retention floor.
 *
 * Pure helpers used by the audit-export pipeline (and the future cleanup
 * job) to enforce platform-mandated long-retention tags REGARDLESS of
 * tenant configuration.
 *
 * Tenants can lengthen retention but never shorten it. Specifically:
 *
 *   - `AuditExportConfig.retentionFilter` cannot exclude floor tags from
 *     the export bundle — `shouldExportEvent` always returns `true` for
 *     events whose retention tag is in the floor.
 *   - The platform-side cleanup job MUST gate row-level deletes through
 *     `effectiveRetentionDays` so a tenant override cannot drop floor
 *     events before their nominal lifetime has elapsed.
 *
 * Pen-test surface: an attacker with tenant-admin credentials may try to
 * set `retentionFilter = ['retention:1y']` to EXCLUDE 7y/10y events from
 * their export bucket. They may also push a tenant override of
 * "retain for 30 days" hoping the cleanup loop will purge break-glass
 * audit. Neither succeeds — the floor here treats those events as
 * always-exportable and never-prematurely-deletable.
 *
 * Pure functions only: no I/O, no clock reads, no tenant lookups. Wire
 * shape of `AuditExportConfigDocument` is unchanged — the floor lives at
 * the export pipeline, not on the entity.
 */

/**
 * Platform-mandated retention floor. Tenants can lengthen retention but
 * never shorten — these tags MUST be exported and MUST NOT be deleted
 * before their nominal lifetime, regardless of tenant configuration.
 */
export const PLATFORM_RETENTION_FLOOR: ReadonlyArray<string> = [
  'retention:7y', // impersonation
  'retention:10y', // break-glass
];

/**
 * Returns true if the event's retention tag is in the platform floor —
 * i.e., must be exported regardless of tenant filter.
 */
export function isPlatformFloorRetention(
  retentionTag: string | undefined,
): boolean {
  if (retentionTag === undefined) return false;
  return PLATFORM_RETENTION_FLOOR.includes(retentionTag);
}

/**
 * Resolves whether an event should be included in a tenant's export.
 *
 *   - If the tag is in the platform floor → always include.
 *   - Else if filter is unset (or empty) → include (default-include).
 *   - Else → include iff tag is in filter.
 */
export function shouldExportEvent(
  retentionTag: string | undefined,
  tenantFilter: ReadonlyArray<string> | undefined,
): boolean {
  if (isPlatformFloorRetention(retentionTag)) return true;
  if (!tenantFilter || tenantFilter.length === 0) return true;
  // Match the legacy export pipeline behavior: an event with no tag is
  // treated as `retention:1y` for filter purposes.
  const tag = retentionTag ?? 'retention:1y';
  return tenantFilter.includes(tag);
}

/**
 * Default platform retention floor for any unrecognised tag (1 year).
 */
const DEFAULT_RETENTION_DAYS = 365;

/**
 * Nominal floor (in days) for each platform-recognised retention tag.
 * The cleanup job MAY NOT delete an event before this many days have
 * elapsed since its `occurredAt`, regardless of tenant override.
 */
const FLOOR_DAYS_BY_TAG: Readonly<Record<string, number>> = {
  'retention:1y': 365,
  'retention:7y': 7 * 365, // 2555 — impersonation
  'retention:10y': 10 * 365, // 3650 — break-glass
};

/**
 * Returns the effective retention duration in days for a given tag.
 *
 * Platform-floor tags (retention:7y, retention:10y) return their floor
 * value regardless of any tenant shortening attempt. Tenants CAN extend
 * retention by passing a larger `tenantOverrideDays`. Other tags fall
 * back to the default platform retention (365 days), which a tenant may
 * also extend.
 */
export function effectiveRetentionDays(
  retentionTag: string | undefined,
  tenantOverrideDays?: number,
): number {
  const floorDays =
    retentionTag !== undefined && retentionTag in FLOOR_DAYS_BY_TAG
      ? FLOOR_DAYS_BY_TAG[retentionTag]!
      : DEFAULT_RETENTION_DAYS;
  if (tenantOverrideDays === undefined) return floorDays;
  // Tenant can EXTEND but never shorten — pick the longer of the two.
  return tenantOverrideDays > floorDays ? tenantOverrideDays : floorDays;
}
