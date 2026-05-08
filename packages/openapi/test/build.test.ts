import { describe, it, expect } from 'vitest';
import { buildOpenApi } from '../src/build.ts';
import type { BuildOpenApiInput, ModuleManifest } from '../src/types.ts';

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

const minimalErrorEnvelope = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'correlationId', 'supportId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        correlationId: { type: 'string' },
        supportId: { type: 'string' },
      },
    },
  },
} as const;

function fixtureInput(overrides: Partial<BuildOpenApiInput> = {}): BuildOpenApiInput {
  const manifest = {
    manifestVersion: 2,
    moduleId: 'content-pages',
    displayName: 'Content Pages',
    version: '0.1.0',
    moduleType: ['api'],
    capabilities: [],
    actions: [
      {
        actionId: 'ContentPages.Page.Create',
        resourceType: 'Page',
        verb: 'create',
        auditLevel: 'INFO',
      },
    ],
    resources: [],
    events: [],
    projections: [],
    migrations: [],
    uiRoutes: [],
    jobs: [],
    cacheArtifacts: [],
  } as unknown as ModuleManifest;

  return {
    audience: 'tenant',
    manifests: [manifest],
    actionAudienceOverrides: {},
    actionPayloadSchemas: {},
    envelopeSchema: minimalEnvelope,
    errorEnvelopeSchema: minimalErrorEnvelope,
    routeAnnotations: [],
    buildMetadata: {
      atlasVersion: '0.1.0',
      gitCommit: 'deadbeef',
      generatedAt: '2026-05-08T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('buildOpenApi', () => {
  it('emits an OpenAPI 3.1 document with required fields', () => {
    const doc = buildOpenApi(fixtureInput());
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Atlas Tenant API');
    expect(doc.info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(doc.info['x-atlas-build'].gitCommit).toBe('deadbeef');
  });

  it('audience selects title + description', () => {
    const tenant = buildOpenApi(fixtureInput({ audience: 'tenant' }));
    const operator = buildOpenApi(fixtureInput({ audience: 'operator' }));
    expect(tenant.info.title).toBe('Atlas Tenant API');
    expect(operator.info.title).toBe('Atlas Operator API');
  });

  it('intent endpoint is expanded per-action with per-action paths', () => {
    const doc = buildOpenApi(fixtureInput());
    expect(Object.keys(doc.paths)).toContain('/api/v1/intents#contentPagesPageCreate');
  });

  it('components.schemas contains the error envelope and intent-accepted response', () => {
    const doc = buildOpenApi(fixtureInput());
    expect(doc.components.schemas['ErrorEnvelope']).toBeDefined();
    expect(doc.components.schemas['IntentAcceptedResponse']).toBeDefined();
  });

  it('components.responses contains canonical error responses', () => {
    const doc = buildOpenApi(fixtureInput());
    expect(doc.components.responses['BadRequest']).toBeDefined();
    expect(doc.components.responses['Unauthorized']).toBeDefined();
    expect(doc.components.responses['Forbidden']).toBeDefined();
    expect(doc.components.responses['Conflict']).toBeDefined();
    expect(doc.components.responses['TransactionFailed']).toBeDefined();
  });

  it('tenant security schemes do NOT include debugPrincipal', () => {
    const doc = buildOpenApi(fixtureInput({ audience: 'tenant' }));
    expect(Object.keys(doc.components.securitySchemes)).toEqual(
      expect.arrayContaining(['bearerAuth', 'apiKeyAuth', 'oauth2ClientCredentials']),
    );
    expect(doc.components.securitySchemes['debugPrincipal']).toBeUndefined();
  });

  it('operator security schemes DO include debugPrincipal', () => {
    const doc = buildOpenApi(fixtureInput({ audience: 'operator' }));
    expect(doc.components.securitySchemes['debugPrincipal']).toBeDefined();
  });

  it('document is JSON-serializable (no cycles, no symbols)', () => {
    const doc = buildOpenApi(fixtureInput());
    expect(() => JSON.stringify(doc)).not.toThrow();
    const round = JSON.parse(JSON.stringify(doc));
    expect(round.openapi).toBe('3.1.0');
  });

  it('route annotations land at their declared path/method', () => {
    const doc = buildOpenApi(
      fixtureInput({
        routeAnnotations: [
          {
            method: 'GET',
            path: '/healthz',
            audience: 'tenant',
            operationId: 'healthz',
            summary: 'Liveness probe',
            tags: ['health'],
            responses: {
              '200': {
                description: 'Server is alive',
                schemaRef: '#/components/schemas/HealthzResponse',
              },
            },
          },
        ],
      }),
    );
    const path = doc.paths['/healthz'] as Record<string, Record<string, unknown>> | undefined;
    expect(path).toBeDefined();
    expect(path!['get']).toMatchObject({
      operationId: 'healthz',
      summary: 'Liveness probe',
    });
  });

  it('audience filter excludes annotations of other audience', () => {
    const doc = buildOpenApi(
      fixtureInput({
        audience: 'tenant',
        routeAnnotations: [
          {
            method: 'GET',
            path: '/admin/secrets',
            audience: 'operator',
            operationId: 'adminListSecrets',
            summary: 'Operator-only',
            responses: { '200': { description: 'ok' } },
          },
        ],
      }),
    );
    expect(doc.paths['/admin/secrets']).toBeUndefined();
  });
});
