/**
 * Phase A7 — Platform retention floor unit tests.
 *
 * Pure-function coverage for `audit-retention.ts`. The integration with
 * the audit-export pipeline lives in `a4-acceptance.test.ts`.
 */
import { describe, it, expect } from '@atlas/test';
import { PLATFORM_RETENTION_FLOOR, isPlatformFloorRetention, shouldExportEvent, effectiveRetentionDays, } from '../src/index.ts';
describe('audit-retention: PLATFORM_RETENTION_FLOOR', function () {
    it('contains exactly the 7y and 10y tags', function () {
        expect(PLATFORM_RETENTION_FLOOR).toContain('retention:7y');
        expect(PLATFORM_RETENTION_FLOOR).toContain('retention:10y');
        expect(PLATFORM_RETENTION_FLOOR.length).toBe(2);
    });
});
describe('audit-retention: isPlatformFloorRetention', function () {
    it('returns true for retention:7y (impersonation)', function () {
        expect(isPlatformFloorRetention('retention:7y')).toBe(true);
    });
    it('returns true for retention:10y (break-glass)', function () {
        expect(isPlatformFloorRetention('retention:10y')).toBe(true);
    });
    it('returns false for retention:1y (default tier)', function () {
        expect(isPlatformFloorRetention('retention:1y')).toBe(false);
    });
    it('returns false for undefined', function () {
        expect(isPlatformFloorRetention(undefined)).toBe(false);
    });
    it('returns false for unrecognised tags', function () {
        expect(isPlatformFloorRetention('retention:30d')).toBe(false);
    });
});
describe('audit-retention: shouldExportEvent — floor wins over tenant filter', function () {
    it('floor (7y) is exported even when tenant filter excludes it', function () {
        // Pen-test: tenant admin tries to drop impersonation events from
        // their export bucket by setting filter=['retention:1y'].
        expect(shouldExportEvent('retention:7y', ['retention:1y'])).toBe(true);
    });
    it('floor (10y) is exported even when tenant filter is empty', function () {
        // Empty filter would otherwise exclude EVERY event (legacy filter
        // semantics treat empty-array as "no tier matched"); the floor
        // overrides.
        expect(shouldExportEvent('retention:10y', [])).toBe(true);
    });
    it('floor (10y) is exported when filter only allows 1y', function () {
        expect(shouldExportEvent('retention:10y', ['retention:1y'])).toBe(true);
    });
});
describe('audit-retention: shouldExportEvent — tenant filter semantics for non-floor tags', function () {
    it('non-floor tag in filter → included', function () {
        expect(shouldExportEvent('retention:1y', ['retention:1y'])).toBe(true);
    });
    it('non-floor tag NOT in filter → excluded', function () {
        expect(shouldExportEvent('retention:1y', ['retention:7y'])).toBe(false);
    });
    it('non-floor tag with undefined filter → default-include', function () {
        expect(shouldExportEvent('retention:1y', undefined)).toBe(true);
    });
    it('undefined tag with undefined filter → default-include', function () {
        expect(shouldExportEvent(undefined, undefined)).toBe(true);
    });
    it('undefined tag treated as retention:1y for filter matching', function () {
        expect(shouldExportEvent(undefined, ['retention:1y'])).toBe(true);
        expect(shouldExportEvent(undefined, ['retention:7y'])).toBe(false);
    });
});
describe('audit-retention: effectiveRetentionDays — floor cannot be shortened', function () {
    it('retention:7y → 2555 days', function () {
        expect(effectiveRetentionDays('retention:7y')).toBe(2555);
    });
    it('retention:10y → 3650 days', function () {
        expect(effectiveRetentionDays('retention:10y')).toBe(3650);
    });
    it('retention:7y with tenant override of 100 days → still 2555 (floor wins)', function () {
        expect(effectiveRetentionDays('retention:7y', 100)).toBe(2555);
    });
    it('retention:10y with tenant override of 100 days → still 3650 (floor wins)', function () {
        expect(effectiveRetentionDays('retention:10y', 100)).toBe(3650);
    });
});
describe('audit-retention: effectiveRetentionDays — tenant CAN extend', function () {
    it('retention:1y with override 9999 → 9999 (tenant extends default)', function () {
        expect(effectiveRetentionDays('retention:1y', 9999)).toBe(9999);
    });
    it('retention:7y with override 4000 → 4000 (tenant extends floor)', function () {
        expect(effectiveRetentionDays('retention:7y', 4000)).toBe(4000);
    });
    it('retention:10y with override 99999 → 99999 (tenant extends floor)', function () {
        expect(effectiveRetentionDays('retention:10y', 99999)).toBe(99999);
    });
});
describe('audit-retention: effectiveRetentionDays — defaults', function () {
    it('undefined tag → 365 (default platform retention)', function () {
        expect(effectiveRetentionDays(undefined)).toBe(365);
    });
    it('retention:1y (no override) → 365', function () {
        expect(effectiveRetentionDays('retention:1y')).toBe(365);
    });
    it('unrecognised tag → 365 (default platform retention)', function () {
        expect(effectiveRetentionDays('retention:30d')).toBe(365);
    });
    it('unrecognised tag with override 1000 → 1000 (tenant extends default)', function () {
        expect(effectiveRetentionDays('retention:30d', 1000)).toBe(1000);
    });
});
