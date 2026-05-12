import { describe, it, expect } from 'vitest';
import { assertDefined } from '@atlas/test-fixtures/assert';
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

// Build a manifest using only the fields ModuleManifest declares — earlier
// versions of this test stamped a stray `manifestVersion`/`moduleType` on
// the literal and laundered it through `as unknown as ModuleManifest`. The
// extra fields aren't part of the contract; dropping them lets the literal
// satisfy the interface directly.
function makeManifest(actions: ModuleManifest['actions']): ModuleManifest {
  return {
    moduleId: 'content-pages',
    displayName: 'Content Pages',
    version: '0.1.0',
    capabilities: ['content-management'],
    actions,
    resources: [],
    events: [],
    projections: [],
    migrations: [],
    uiRoutes: [],
    jobs: [],
    cacheArtifacts: [],
  };
}

/**
 * Type-guard: narrows `unknown` to a JSON-object (non-null, non-array).
 * Once narrowed, members are still `unknown` — every leaf field stays
 * typed at the boundary and must narrow before use.
 */
function isJsonObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Narrow a freshly-built openapi schema component to its `{ properties }`
 * shape. Replaces a `someEntry as { properties?: … } | undefined` cast +
 * non-null-bang chain: the runtime guard fails loudly if the generator
 * stops emitting `properties` rather than crashing on a downstream
 * undefined deref.
 */
function envelopeProps(
  components: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  const entry = assertDefined(components[key], `schemaComponents[${key}]`);
  if (!isJsonObject(entry)) {
    throw new Error(`schemaComponents[${key}] not an object`);
  }
  const props = entry['properties'];
  if (!isJsonObject(props)) {
    throw new Error(`schemaComponents[${key}].properties missing`);
  }
  return props;
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
      } satisfies ModuleManifest['actions'][number],
      {
        actionId: 'ContentPages.Page.Delete',
        resourceType: 'Page',
        verb: 'delete',
        auditLevel: 'SENSITIVE',
      } satisfies ModuleManifest['actions'][number],
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
      } satisfies ModuleManifest['actions'][number],
      {
        actionId: 'Tenancy.Signup.Approve',
        resourceType: 'SignupRequest',
        verb: 'apply',
        auditLevel: 'SENSITIVE',
      } satisfies ModuleManifest['actions'][number],
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
      } satisfies ModuleManifest['actions'][number],
    ]);
    const m2 = { ...makeManifest([]), moduleId: 'authz' } satisfies ModuleManifest;

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
      } satisfies ModuleManifest['actions'][number],
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

    const props = envelopeProps(
      result.schemaComponents,
      'Envelope_contentPagesPageCreate',
    );
    // payload mirror
    expect(props['payload']).toEqual(payloadSchema);
    // eventType stamped to ContentPages.PageCreated. `eventType` is the
    // generator's own output — assert its object shape via the type-guard
    // before reading `.const`, no cast required.
    const eventType = props['eventType'];
    if (!isJsonObject(eventType)) {
      throw new Error('eventType prop is not a JSON object');
    }
    expect(eventType['const']).toBe('ContentPages.PageCreated');
  });

  it('falls back to generic payload when no bundled schema is provided', () => {
    const manifest = makeManifest([
      {
        actionId: 'Authz.Policy.Create',
        resourceType: 'Policy',
        verb: 'create',
        auditLevel: 'INFO',
      } satisfies ModuleManifest['actions'][number],
    ]);

    const result = expandIntents({
      audience: 'tenant',
      manifests: [manifest],
      actionAudienceOverrides: {},
      actionPayloadSchemas: {}, // empty
      envelopeSchema: minimalEnvelope,
    });

    const props = envelopeProps(result.schemaComponents, 'Envelope_authzPolicyCreate');
    expect(props['payload']).toMatchObject({ type: 'object' });
  });
});
