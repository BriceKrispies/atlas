import { describe, it, expect } from 'vitest';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { buildOpenApi } from '../src/build.ts';
import type { BuildOpenApiInput, ModuleManifest } from '../src/types.ts';
/**
 * Type guard: narrows `unknown` to a plain JSON object. Indexing returns
 * `unknown` because JSON values are unknown by nature.
 */
function isJsonObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
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
    // Build a manifest using only the fields ModuleManifest actually declares —
    // earlier versions of this fixture stamped `manifestVersion`/`moduleType`
    // on the literal and laundered it through `as unknown as ModuleManifest`.
    // Those fields aren't part of the contract; dropping them lets the literal
    // satisfy the interface directly (mirrors intent-expander.test.ts).
    const manifest: ModuleManifest = {
        moduleId: 'content-pages',
        displayName: 'Content Pages',
        version: '0.1.0',
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
    };
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
describe('buildOpenApi', function () {
    it('emits an OpenAPI 3.1 document with required fields', function () {
        const doc = buildOpenApi(fixtureInput());
        expect(doc.openapi).toBe('3.1.0');
        expect(doc.info.title).toBe('Atlas Tenant API');
        expect(doc.info.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(doc.info['x-atlas-build'].gitCommit).toBe('deadbeef');
    });
    it('audience selects title + description', function () {
        const tenant = buildOpenApi(fixtureInput({ audience: 'tenant' }));
        const operator = buildOpenApi(fixtureInput({ audience: 'operator' }));
        expect(tenant.info.title).toBe('Atlas Tenant API');
        expect(operator.info.title).toBe('Atlas Operator API');
    });
    it('intent endpoint is expanded per-action with per-action paths', function () {
        const doc = buildOpenApi(fixtureInput());
        expect(Object.keys(doc.paths)).toContain('/api/v1/intents#contentPagesPageCreate');
    });
    it('components.schemas contains the error envelope and intent-accepted response', function () {
        const doc = buildOpenApi(fixtureInput());
        expect(doc.components.schemas['ErrorEnvelope']).toBeDefined();
        expect(doc.components.schemas['IntentAcceptedResponse']).toBeDefined();
    });
    it('components.responses contains canonical error responses', function () {
        const doc = buildOpenApi(fixtureInput());
        expect(doc.components.responses['BadRequest']).toBeDefined();
        expect(doc.components.responses['Unauthorized']).toBeDefined();
        expect(doc.components.responses['Forbidden']).toBeDefined();
        expect(doc.components.responses['Conflict']).toBeDefined();
        expect(doc.components.responses['TransactionFailed']).toBeDefined();
    });
    it('tenant security schemes do NOT include debugPrincipal', function () {
        const doc = buildOpenApi(fixtureInput({ audience: 'tenant' }));
        expect(Object.keys(doc.components.securitySchemes)).toEqual(expect.arrayContaining(['bearerAuth', 'apiKeyAuth', 'oauth2ClientCredentials']));
        expect(doc.components.securitySchemes['debugPrincipal']).toBeUndefined();
    });
    it('operator security schemes DO include debugPrincipal', function () {
        const doc = buildOpenApi(fixtureInput({ audience: 'operator' }));
        expect(doc.components.securitySchemes['debugPrincipal']).toBeDefined();
    });
    it('document is JSON-serializable (no cycles, no symbols)', function () {
        const doc = buildOpenApi(fixtureInput());
        expect(function () {
            return JSON.stringify(doc);
        }).not.toThrow();
        // JSON.parse returns `any`; narrow through `unknown` + the isJsonObject
        // guard so we read `.openapi` against a typed bag rather than `any`.
        const round: unknown = JSON.parse(JSON.stringify(doc));
        if (!isJsonObject(round))
            throw new Error('round-tripped document not an object');
        expect(round['openapi']).toBe('3.1.0');
    });
    it('route annotations land at their declared path/method', function () {
        const doc = buildOpenApi(fixtureInput({
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
        }));
        // `OpenApiDocument.paths` is typed as `Record<string, Record<string, unknown>>`,
        // so the lookup is already a `Record<string, unknown>` — no cast needed.
        // assertDefined fails the test with a meaningful message if the generator
        // stops emitting the route, rather than `Cannot read property 'get' of undefined`.
        const path = assertDefined(doc.paths['/healthz'], 'paths[/healthz]');
        expect(path['get']).toMatchObject({
            operationId: 'healthz',
            summary: 'Liveness probe',
        });
    });
    it('audience filter excludes annotations of other audience', function () {
        const doc = buildOpenApi(fixtureInput({
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
        }));
        expect(doc.paths['/admin/secrets']).toBeUndefined();
    });
});
