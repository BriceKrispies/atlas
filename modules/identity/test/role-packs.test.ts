/**
 * Role-pack Cedar generator tests.
 *
 * The generator is a pure function over `ActionDeclaration[]` — no I/O,
 * no DB. We assert verb classification, action-set ordering (stable so
 * the bundle hash is reproducible), and the structural shape of the
 * emitted Cedar text.
 */

import { describe, it, expect } from 'vitest';
import type { ActionDeclaration } from '@atlas/platform-core';
import { buildRolePacksCedar, buildRolePackBundle } from '../src/index.ts';

const ACTIONS: ActionDeclaration[] = [
  { actionId: 'ContentPages.Page.Create', resourceType: 'Page', verb: 'create', auditLevel: 'INFO' },
  { actionId: 'ContentPages.Page.Update', resourceType: 'Page', verb: 'update', auditLevel: 'INFO' },
  { actionId: 'ContentPages.Page.Delete', resourceType: 'Page', verb: 'delete', auditLevel: 'INFO' },
  { actionId: 'ContentPages.Page.Search', resourceType: 'Page', verb: 'search', auditLevel: 'INFO' },
  { actionId: 'Catalog.Family.Publish', resourceType: 'Family', verb: 'publish', auditLevel: 'INFO' },
  { actionId: 'Catalog.Family.Get', resourceType: 'Family', verb: 'get', auditLevel: 'INFO' },
  { actionId: 'Analytics.Query', resourceType: 'AnalyticsDashboard', verb: 'query', auditLevel: 'INFO' },
];

describe('buildRolePacksCedar', () => {
  it('emits four role permits', () => {
    const cedar = buildRolePacksCedar(ACTIONS);
    expect(cedar).toContain('@id("role-tenant-admin")');
    expect(cedar).toContain('@id("role-author-write")');
    expect(cedar).toContain('@id("role-author-read")');
    expect(cedar).toContain('@id("role-viewer")');
    expect(cedar).toContain('@id("role-service-principal")');
  });

  it('classifies write verbs into the write bucket', () => {
    const cedar = buildRolePacksCedar(ACTIONS);
    // write actions sorted alphabetically
    const writeBlock = cedar.split('@id("role-author-write")')[1]?.split('@id("role-author-read")')[0] ?? '';
    expect(writeBlock).toContain('Action::"Catalog.Family.Publish"');
    expect(writeBlock).toContain('Action::"ContentPages.Page.Create"');
    expect(writeBlock).toContain('Action::"ContentPages.Page.Delete"');
    expect(writeBlock).toContain('Action::"ContentPages.Page.Update"');
    // Reads are not in the write block
    expect(writeBlock).not.toContain('Action::"Analytics.Query"');
    expect(writeBlock).not.toContain('Action::"Catalog.Family.Get"');
  });

  it('classifies read verbs into the read bucket and grants Viewer ONLY reads', () => {
    const cedar = buildRolePacksCedar(ACTIONS);
    const viewerBlock = cedar.split('@id("role-viewer")')[1]?.split('@id("role-service-principal")')[0] ?? '';
    expect(viewerBlock).toContain('Action::"Analytics.Query"');
    expect(viewerBlock).toContain('Action::"Catalog.Family.Get"');
    expect(viewerBlock).toContain('Action::"ContentPages.Page.Search"');
    expect(viewerBlock).not.toContain('Action::"ContentPages.Page.Create"');
    expect(viewerBlock).not.toContain('Action::"Catalog.Family.Publish"');
  });

  it('TenantAdmin gets every action', () => {
    const cedar = buildRolePacksCedar(ACTIONS);
    const adminBlock = cedar.split('@id("role-tenant-admin")')[1]?.split('@id("role-author-write")')[0] ?? '';
    for (const a of ACTIONS) {
      expect(adminBlock).toContain(`Action::"${a.actionId}"`);
    }
  });

  it('ServicePrincipal ships with an empty action set', () => {
    const cedar = buildRolePacksCedar(ACTIONS);
    const spBlock = cedar.split('@id("role-service-principal")')[1] ?? '';
    expect(spBlock).toContain('action in [],');
  });

  it('is deterministic — running twice on the same input yields identical text', () => {
    const a = buildRolePacksCedar(ACTIONS);
    const b = buildRolePacksCedar(ACTIONS);
    expect(a).toBe(b);
  });

  it('order-independent — actions get sorted before emission', () => {
    const reversed = [...ACTIONS].reverse();
    expect(buildRolePacksCedar(ACTIONS)).toBe(buildRolePacksCedar(reversed));
  });

  it('handles an empty manifest set with empty action lists everywhere', () => {
    const cedar = buildRolePacksCedar([]);
    // Every role's action set is `[]`. The permits are still emitted —
    // they just match nothing — so adding actions later doesn't require
    // re-issuing the bundle wrapper.
    expect(cedar).toContain('@id("role-tenant-admin")');
    expect((cedar.match(/action in \[\]/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('treats unknown verbs as reads (defensive)', () => {
    const odd: ActionDeclaration[] = [
      { actionId: 'Module.Mystery', resourceType: 'X', verb: 'mystery', auditLevel: 'INFO' },
    ];
    const cedar = buildRolePacksCedar(odd);
    const writeBlock = cedar.split('@id("role-author-write")')[1]?.split('@id("role-author-read")')[0] ?? '';
    const readBlock = cedar.split('@id("role-author-read")')[1]?.split('@id("role-viewer")')[0] ?? '';
    expect(writeBlock).not.toContain('Action::"Module.Mystery"');
    expect(readBlock).toContain('Action::"Module.Mystery"');
  });
});

describe('buildRolePackBundle', () => {
  it('wraps the cedar text in the policy_json wrapper shape', () => {
    const bundle = buildRolePackBundle(ACTIONS);
    expect(bundle.format).toBe('cedar-text');
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.policies).toContain('@id("role-tenant-admin")');
    expect(bundle.description).toBeTruthy();
  });
});
