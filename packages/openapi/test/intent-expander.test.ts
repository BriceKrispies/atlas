import { describe, it, expect } from 'vitest';
import {
  actionIdToOperationId,
  expandIntents,
} from '../src/intent-expander.ts';
import type { ModuleManifest } from '../src/types.ts';

const minimalEnvelope = {
  type: 'object',
  required: ['eventType', 'tenantId', 'correlationId', 'idempotencyKey', 'payload'],
  properties: {
    eventType: { type: 'string' },
    tenantId: { type: 'string' },
    correlationId: { type: 'string' },
    idempotencyKey: { type: 'string' },
    payload: { type: 'object' },
  },
} as const;

function makeManifest(actions: ModuleManifest['actions']): ModuleManifest {
  return {
    manifestVersion: 2,
    moduleId: 'content-pages',
    displayName: 'Content Pages',
    version: '0.1.0',
    moduleType: ['api'],
    capabilities: ['content-management'],
    actions,
    resources: [],
    events: [],
    projections: [],
    migrations: [],
    uiRoutes: [],
    jobs: [],
    cacheArtifacts: [],
  } as unknown as ModuleManifest;
}

describe('actionIdToOperationId', () => {
  it.each([
    ['ContentPages.Page.Create', 'contentPagesPageCreate'],
    ['Catalog.SeedPackage.Apply', 'catalogSeedPackageApply'],
    ['Authz.Policy.Activate', 'authzPolicyActivate'],
    ['identity.user.create', 'identityUserCreate'],
    ['Single', 'single'],
    ['', 'unknown'],
  ])('%s → %s', (input, expected) => {
    expect(actionIdToOperationId(input)).toBe(expected);
  });
});

describe('expandIntents', () => {
  it('emits one path per matching-audience action', () => {
    const manifest = makeManifest([
      {
        actionId: 'ContentPages.Page.Create',
        resourceType: 'Page',
        verb: 'create',
        auditLevel: 'INFO',
      } as ModuleManifest['actions'][number],
      {
        actionId: 'ContentPages.Page.Delete',
        resourceType: 'Page',
        verb: 'delete',
        auditLevel: 'SENSITIVE',
      } as ModuleManifest['actions'][number],
    ]);

    const result = expandIntents({
      audience: 'tenant',
      manifests: [manifest],
      actionAudienceOverrides: {},
      actionPayloadSchemas: {},
      envelopeSchema: minimalEnvelope,
    });

    expect(Object.keys(result.pathOperations).sort()).toEqual([
      '/api/v1/intents#contentPagesPageCreate',
      '/api/v1/intents#contentPagesPageDelete',
    ]);
  });

  it('audience filter excludes operator actions from tenant doc', () => {
    const manifest = makeManifest([
      {
        actionId: 'ContentPages.Page.Create',
        resourceType: 'Page',
        verb: 'create',
        auditLevel: 'INFO',
      } as ModuleManifest['actions'][number],
      {
        actionId: 'Tenancy.Signup.Approve',
        resourceType: 'SignupRequest',
        verb: 'apply',
        auditLevel: 'SENSITIVE',
      } as ModuleManifest['actions'][number],
    ]);

    const result = expandIntents({
      audience: 'tenant',
      manifests: [manifest],
      actionAudienceOverrides: { 'Tenancy.Signup.Approve': 'operator' },
      actionPayloadSchemas: {},
      envelopeSchema: minimalEnvelope,
    });

    expect(Object.keys(result.pathOperations)).toEqual([
      '/api/v1/intents#contentPagesPageCreate',
    ]);
  });

  it('emits a tag per module that contributes at least one operation', () => {
    const m1 = makeManifest([
      {
        actionId: 'ContentPages.Page.Create',
        resourceType: 'Page',
        verb: 'create',
        auditLevel: 'INFO',
      } as ModuleManifest['actions'][number],
    ]);
    const m2 = { ...makeManifest([]), moduleId: 'authz' } as ModuleManifest;

    const result = expandIntents({
      audience: 'tenant',
      manifests: [m1, m2],
      actionAudienceOverrides: {},
      actionPayloadSchemas: {},
      envelopeSchema: minimalEnvelope,
    });

    expect(result.tags.map((t) => t.name)).toEqual(['content-pages']);
  });

  it('per-action envelope wraps the bundled payload schema and stamps eventType', () => {
    const manifest = makeManifest([
      {
        actionId: 'ContentPages.Page.Create',
        resourceType: 'Page',
        verb: 'create',
        auditLevel: 'INFO',
      } as ModuleManifest['actions'][number],
    ]);

    const payloadSchema = {
      type: 'object',
      properties: { pageId: { type: 'string' }, title: { type: 'string' } },
      required: ['pageId', 'title'],
    } as const;

    const result = expandIntents({
      audience: 'tenant',
      manifests: [manifest],
      actionAudienceOverrides: {},
      actionPayloadSchemas: {
        'ContentPages.Page.Create': payloadSchema,
      },
      envelopeSchema: minimalEnvelope,
    });

    const envelope = result.schemaComponents['Envelope_contentPagesPageCreate'] as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(envelope).toBeDefined();
    const props = envelope!.properties!;
    // payload mirror
    expect(props['payload']).toEqual(payloadSchema);
    // eventType stamped to ContentPages.PageCreated
    const eventType = props['eventType'] as Record<string, unknown>;
    expect(eventType['const']).toBe('ContentPages.PageCreated');
  });

  it('falls back to generic payload when no bundled schema is provided', () => {
    const manifest = makeManifest([
      {
        actionId: 'Authz.Policy.Create',
        resourceType: 'Policy',
        verb: 'create',
        auditLevel: 'INFO',
      } as ModuleManifest['actions'][number],
    ]);

    const result = expandIntents({
      audience: 'tenant',
      manifests: [manifest],
      actionAudienceOverrides: {},
      actionPayloadSchemas: {}, // empty
      envelopeSchema: minimalEnvelope,
    });

    const envelope = result.schemaComponents['Envelope_authzPolicyCreate'] as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(envelope).toBeDefined();
    const props = envelope!.properties!;
    expect(props['payload']).toMatchObject({ type: 'object' });
  });
});
