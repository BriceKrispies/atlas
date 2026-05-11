/**
 * Stage-2 sanity tests for the platform-tenant primitives. These are
 * shape assertions only — the integration that the bootstrap upsert
 * actually inserts a row, and that handlers stamp the robot id on
 * system-initiated events, is exercised by the apps/server boot
 * sequence and the identity handler tests respectively.
 */
import { describe, expect, it } from 'vitest';
import {
  PLATFORM_ROBOT_PRINCIPAL_ID,
  PLATFORM_TENANT_ID,
  bootstrapPlatformRobot,
} from './platform-tenant.ts';

describe('platform-tenant primitives', () => {
  it('PLATFORM_TENANT_ID is the canonical _platform slug', () => {
    // The slug is load-bearing for back-compat — renaming is a
    // migration, not a code change (ADR 0008 §1).
    expect(PLATFORM_TENANT_ID).toBe('_platform');
  });

  it('PLATFORM_ROBOT_PRINCIPAL_ID is a stable kinded id', () => {
    // Format mirrors other principal kinds: `<kind>:<sub-id>`. The
    // audit pipeline reads this verbatim; renaming requires a
    // retention-tag migration.
    expect(PLATFORM_ROBOT_PRINCIPAL_ID).toBe('platform-robot:bootstrap');
  });

  it('bootstrapPlatformRobot defaults to the platform tenant', () => {
    const p = bootstrapPlatformRobot();
    expect(p.kind).toBe('platform-robot');
    expect(p.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
    expect(p.tenantId).toBe(PLATFORM_TENANT_ID);
  });

  it('bootstrapPlatformRobot accepts a customer tenant override', () => {
    // Some flows emit events INTO a customer tenant (signup confirm
    // creates the first User inside `<new-tenant>` while the principal
    // stays the platform robot). Override at the call site so audit
    // retains tenant scoping.
    const p = bootstrapPlatformRobot('cust-42');
    expect(p.tenantId).toBe('cust-42');
    expect(p.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
  });

  it('PlatformRobotPrincipal has no human-user fields', () => {
    const p = bootstrapPlatformRobot();
    // Audit invariant: this is a process identity, not an account.
    // If/when fields are added, they must be process-level (e.g. a
    // sub-robot id), not human-user-level (email, displayName).
    const keys = Object.keys(p).sort();
    expect(keys).toEqual(['kind', 'principalId', 'tenantId']);
  });
});
