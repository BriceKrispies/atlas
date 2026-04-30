/**
 * Handler unit tests against an in-memory PolicyStore. Exercises the
 * three write handlers' contract behaviour without a real Postgres.
 */

import { describe, it, expect } from 'vitest';
import {
  handleCreatePolicy,
  handleActivatePolicy,
  handleArchivePolicy,
  AuthzError,
  authzErrorCodes,
  type PolicyStore,
  type PolicyDetail,
  type PolicySummary,
  type PolicyStatus,
} from '../src/index.ts';

interface Row {
  tenantId: string;
  version: number;
  status: PolicyStatus;
  cedarText: string;
  description: string | null;
  lastModifiedAt: string;
  lastModifiedBy: string | null;
}

class InMemoryPolicyStore implements PolicyStore {
  rows: Row[] = [];

  async list(tenantId: string): Promise<readonly PolicySummary[]> {
    return this.rows
      .filter((r) => r.tenantId === tenantId)
      .map(({ cedarText: _ct, ...rest }) => rest)
      .sort((a, b) => b.version - a.version);
  }

  async get(tenantId: string, version: number): Promise<PolicyDetail | null> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.version === version);
    return row ? { ...row } : null;
  }

  async createDraft(input: {
    tenantId: string;
    cedarText: string;
    description: string | null;
    principalId: string | null;
  }): Promise<number> {
    const max = this.rows
      .filter((r) => r.tenantId === input.tenantId)
      .reduce((m, r) => Math.max(m, r.version), 0);
    const version = max + 1;
    this.rows.push({
      tenantId: input.tenantId,
      version,
      status: 'draft',
      cedarText: input.cedarText,
      description: input.description,
      lastModifiedAt: new Date().toISOString(),
      lastModifiedBy: input.principalId,
    });
    return version;
  }

  async activate(input: {
    tenantId: string;
    version: number;
    principalId: string | null;
  }): Promise<void> {
    const row = this.rows.find((r) => r.tenantId === input.tenantId && r.version === input.version);
    if (!row) {
      throw new AuthzError(authzErrorCodes.POLICY_NOT_FOUND, 'not found', 404);
    }
    if (row.status !== 'draft') {
      throw new AuthzError(authzErrorCodes.POLICY_NOT_DRAFT, 'not draft', 400);
    }
    for (const r of this.rows) {
      if (r.tenantId === input.tenantId && r.status === 'active') r.status = 'archived';
    }
    row.status = 'active';
  }

  async archive(input: {
    tenantId: string;
    version: number;
    principalId: string | null;
  }): Promise<void> {
    const row = this.rows.find((r) => r.tenantId === input.tenantId && r.version === input.version);
    if (!row) {
      throw new AuthzError(authzErrorCodes.POLICY_NOT_FOUND, 'not found', 404);
    }
    if (row.status === 'archived') return;
    if (row.status === 'active') {
      const activeCount = this.rows.filter(
        (r) => r.tenantId === input.tenantId && r.status === 'active',
      ).length;
      if (activeCount <= 1) {
        throw new AuthzError(
          authzErrorCodes.POLICY_LAST_ACTIVE,
          'cannot archive only active policy',
          400,
        );
      }
    }
    row.status = 'archived';
  }
}

describe('handleCreatePolicy', () => {
  it('rejects empty cedarText', async () => {
    const store = new InMemoryPolicyStore();
    await expect(
      handleCreatePolicy(
        {
          tenantId: 't1',
          correlationId: 'corr',
          principalId: 'u1',
          cedarText: '   ',
          description: null,
        },
        store,
      ),
    ).rejects.toThrow(/non-empty/);
  });

  it('saves a draft and assigns version 1 when first', async () => {
    const store = new InMemoryPolicyStore();
    const result = await handleCreatePolicy(
      {
        tenantId: 't1',
        correlationId: 'corr',
        principalId: 'u1',
        cedarText: 'permit (principal, action, resource);',
        description: null,
      },
      store,
    );
    expect(result.version).toBe(1);
    expect(result.envelope.eventType).toBe('Authz.PolicyDrafted');
    expect(result.envelope.cacheInvalidationTags).toEqual(['Tenant:t1']);
  });

  it('emits monotonically-increasing versions', async () => {
    const store = new InMemoryPolicyStore();
    const a = await handleCreatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', cedarText: 'permit (principal, action, resource);', description: null },
      store,
    );
    const b = await handleCreatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', cedarText: 'permit (principal, action, resource);', description: null },
      store,
    );
    expect(a.version).toBe(1);
    expect(b.version).toBe(2);
  });
});

describe('handleActivatePolicy', () => {
  it('promotes draft and demotes prior active', async () => {
    const store = new InMemoryPolicyStore();
    await handleCreatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', cedarText: 'permit (principal, action, resource);', description: null },
      store,
    );
    await handleActivatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', version: 1 },
      store,
    );
    await handleCreatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', cedarText: 'permit (principal, action, resource);', description: null },
      store,
    );
    await handleActivatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', version: 2 },
      store,
    );
    const list = await store.list('t1');
    const v1 = list.find((p) => p.version === 1);
    const v2 = list.find((p) => p.version === 2);
    expect(v1?.status).toBe('archived');
    expect(v2?.status).toBe('active');
  });

  it('rejects activating a non-draft', async () => {
    const store = new InMemoryPolicyStore();
    await handleCreatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', cedarText: 'permit (principal, action, resource);', description: null },
      store,
    );
    await handleActivatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', version: 1 },
      store,
    );
    await expect(
      handleActivatePolicy(
        { tenantId: 't1', correlationId: 'c', principalId: 'u', version: 1 },
        store,
      ),
    ).rejects.toThrow(/draft/);
  });

  it('emits Tenant cache-invalidation tag on activate', async () => {
    const store = new InMemoryPolicyStore();
    await handleCreatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', cedarText: 'permit (principal, action, resource);', description: null },
      store,
    );
    const { envelope } = await handleActivatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', version: 1 },
      store,
    );
    expect(envelope.cacheInvalidationTags).toEqual(['Tenant:t1']);
  });
});

describe('handleArchivePolicy', () => {
  it('refuses to archive the last active policy', async () => {
    const store = new InMemoryPolicyStore();
    await handleCreatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', cedarText: 'permit (principal, action, resource);', description: null },
      store,
    );
    await handleActivatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', version: 1 },
      store,
    );
    await expect(
      handleArchivePolicy(
        { tenantId: 't1', correlationId: 'c', principalId: 'u', version: 1 },
        store,
      ),
    ).rejects.toThrow(/only active policy/);
  });

  it('archives a draft fine', async () => {
    const store = new InMemoryPolicyStore();
    await handleCreatePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', cedarText: 'permit (principal, action, resource);', description: null },
      store,
    );
    const { envelope } = await handleArchivePolicy(
      { tenantId: 't1', correlationId: 'c', principalId: 'u', version: 1 },
      store,
    );
    expect(envelope.eventType).toBe('Authz.PolicyArchived');
    const detail = await store.get('t1', 1);
    expect(detail?.status).toBe('archived');
  });
});
