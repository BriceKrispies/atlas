/**
 * buildOpenApi — assemble the full OpenAPI 3.1 document from authoritative
 * Atlas sources (manifests, schemas, route annotations).
 *
 * Pure function. No I/O. The CLI in scripts/sync-openapi.ts wires it to
 * the filesystem.
 */

import {
  buildErrorResponseComponents,
  intentAcceptedResponseSchema,
} from './error-responses.ts';
import { expandIntents } from './intent-expander.ts';
import { buildSecuritySchemes, defaultSecurity } from './security-schemes.ts';
import type {
  Audience,
  BuildOpenApiInput,
  OpenApiDocument,
} from './types.ts';

const TITLES: Readonly<Record<Audience, string>> = {
  tenant: 'Atlas Tenant API',
  operator: 'Atlas Operator API',
  internal: 'Atlas Internal API',
};

const DESCRIPTIONS: Readonly<Record<Audience, string>> = {
  tenant: tenantDescription(),
  operator: operatorDescription(),
  internal: 'Internal Atlas surfaces. Not for tenant or operator use.',
};

export function buildOpenApi(input: BuildOpenApiInput): OpenApiDocument {
  const audience = input.audience;

  const intents = expandIntents({
    audience,
    manifests: input.manifests,
    actionAudienceOverrides: input.actionAudienceOverrides,
    actionPayloadSchemas: input.actionPayloadSchemas,
    envelopeSchema: input.envelopeSchema,
  });

  const errorResponses = buildErrorResponseComponents();
  const securitySchemes = buildSecuritySchemes(audience);

  // Path entries — currently just intent operations. Slice B-2 will fold
  // in routeAnnotations for non-intent routes.
  const paths: Record<string, Record<string, unknown>> = {
    ...intents.pathOperations,
  };

  for (const ann of input.routeAnnotations) {
    if (ann.audience !== audience) continue;
    const existing = paths[ann.path] ?? {};
    existing[ann.method.toLowerCase()] = buildOperationFromAnnotation(ann);
    paths[ann.path] = existing;
  }

  const tags: { name: string; description?: string }[] = [
    ...intents.tags,
  ];
  for (const ann of input.routeAnnotations) {
    if (ann.audience !== audience || !ann.tags) continue;
    for (const tagName of ann.tags) {
      if (!tags.some((t) => t.name === tagName)) tags.push({ name: tagName });
    }
  }

  const schemas: Record<string, unknown> = {
    ErrorEnvelope: input.errorEnvelopeSchema,
    IntentAcceptedResponse: intentAcceptedResponseSchema(),
    ...intents.schemaComponents,
  };

  return {
    openapi: '3.1.0',
    info: {
      title: TITLES[audience],
      version: '1.0.0',
      description: DESCRIPTIONS[audience],
      'x-atlas-build': input.buildMetadata,
    },
    servers: [
      { url: '/', description: 'Same-origin (default).' },
    ],
    tags,
    paths,
    components: {
      schemas,
      responses: errorResponses,
      securitySchemes,
    },
    security: defaultSecurity(),
  };
}

function buildOperationFromAnnotation(ann: BuildOpenApiInput['routeAnnotations'][number]): Record<string, unknown> {
  const op: Record<string, unknown> = {
    operationId: ann.operationId,
    summary: ann.summary,
    responses: Object.fromEntries(
      Object.entries(ann.responses).map(([status, r]) => [
        status,
        r.schemaRef !== undefined
          ? {
              description: r.description,
              content: {
                'application/json': { schema: { $ref: r.schemaRef } },
              },
            }
          : { description: r.description },
      ]),
    ),
  };
  if (ann.description !== undefined) op['description'] = ann.description;
  if (ann.tags !== undefined) op['tags'] = ann.tags;
  if (ann.security !== undefined) op['security'] = ann.security;
  if (ann.parameters !== undefined) op['parameters'] = ann.parameters;
  if (ann.requestBody !== undefined) {
    op['requestBody'] = {
      required: ann.requestBody.required ?? true,
      content: {
        'application/json': {
          schema: { $ref: ann.requestBody.schemaRef },
        },
      },
    };
  }
  return op;
}

function tenantDescription(): string {
  return [
    'The HTTP API tenant developers integrate against. **Generated** from Atlas manifests + schemas — see specs/crosscut/openapi.md.',
    '',
    '## Multi-tenant',
    '',
    'Atlas paths do not include `:tenantId`. Tenant identity is implicit in the auth credential (JWT `iss`, API key tenant binding, OAuth client tenant). When you authenticate as a tenant, every operation resolves to that tenant automatically.',
    '',
    '## Correlation + idempotency',
    '',
    '**`X-Correlation-Id`** — optional request header; the server mints one if absent. The same id is echoed in the response and stamped on every log line and event downstream (Invariant I5). When you retry a request, send the same id so the entire flow correlates.',
    '',
    '**`idempotencyKey`** in the envelope — required for every write intent. Per-logical-operation, not per-HTTP-retry. Replays return the same `eventId` without re-executing the handler (Invariant I3).',
    '',
    '## Errors',
    '',
    'All errors return the same envelope: `{ error: { code, message, correlationId, supportId } }`. The `code` is from a closed taxonomy (see specs/crosscut/errors.md). When escalating to support, paste the `supportId` — it joins request → root cause server-side.',
  ].join('\n');
}

function operatorDescription(): string {
  return [
    'Operator-facing HTTP API. Used by atlasctl and admin tooling. **Generated** from Atlas manifests + schemas + route annotations — see specs/crosscut/openapi.md.',
    '',
    'Includes admin-only routes (`/admin/*`), debug routes (gated by `TEST_AUTH_ENABLED`), and operator-tagged actions. NOT for tenant integration.',
    '',
    'Authentication adds `X-Debug-Principal` (test-auth bypass) on top of the standard tenant schemes. `X-Debug-Principal` is honored only when the server has `TEST_AUTH_ENABLED=true`; production servers reject the header.',
  ].join('\n');
}
