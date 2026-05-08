/**
 * Shapes consumed by buildOpenApi(). Atlas's generator does NOT depend
 * on a third-party OpenAPI library — these types are the minimum slice
 * of OpenAPI 3.1 we emit. The output is a plain object that JSON.stringify
 * produces a valid spec from.
 */

import type { ModuleManifest, ActionDeclaration } from '@atlas/platform-core';

export type Audience = 'tenant' | 'operator' | 'internal';

/**
 * Per-action OpenAPI metadata. Defaults to `audience: 'tenant'` for any
 * action that doesn't override. Operator-only actions (e.g. signup approval)
 * declare `audience: 'operator'` in the manifest's action declaration.
 */
export interface ActionAudienceOverrides {
  /** Map from `actionId` → audience override (when not 'tenant'). */
  readonly [actionId: string]: Audience;
}

/**
 * Annotation for a non-intent route (every Hono route outside
 * POST /api/v1/intents). Built up in apps/server/src/openapi-routes.ts
 * and passed to buildOpenApi() in routeAnnotations.
 *
 * Extended in slice B-2 with full request/response schema fields.
 * For slice B-1 the generator only emits intent operations; route
 * annotations are reserved space.
 */
export interface RouteAnnotation {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  readonly path: string;
  readonly audience: Audience;
  readonly operationId: string;
  readonly summary: string;
  readonly description?: string;
  readonly tags?: ReadonlyArray<string>;
  /** OpenAPI security requirement(s). [] = no auth required. */
  readonly security?: ReadonlyArray<Record<string, ReadonlyArray<string>>>;
  /** Path-level parameters. */
  readonly parameters?: ReadonlyArray<OpenApiParameter>;
  /** Request body shape (JSON only for now). */
  readonly requestBody?: { schemaRef: string; required?: boolean };
  /**
   * Response shapes keyed by status code. Body schemaRef is optional
   * (for empty 202 / 204 responses).
   */
  readonly responses: Readonly<Record<string, { description: string; schemaRef?: string }>>;
}

export interface OpenApiParameter {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header' | 'cookie';
  readonly required?: boolean;
  readonly description?: string;
  readonly schema: { type: 'string' | 'number' | 'integer' | 'boolean' };
}

/** Input for buildOpenApi(). All fields are required so the call site is explicit. */
export interface BuildOpenApiInput {
  readonly audience: 'tenant' | 'operator';
  /** Module manifests; consumed for action expansion. */
  readonly manifests: ReadonlyArray<ModuleManifest>;
  /** Per-action audience overrides; keyed by actionId. */
  readonly actionAudienceOverrides: ActionAudienceOverrides;
  /**
   * Per-action payload schema: `{ [actionId]: jsonSchema }`. When an
   * action has no bundled payload schema, the generator emits a
   * generic `unknown` payload. (Atlas's runtime validates payloads
   * via @atlas/schemas; the OpenAPI generator just documents what's
   * available.)
   */
  readonly actionPayloadSchemas: Readonly<Record<string, JsonSchema>>;
  /** The envelope schema (event_envelope.schema.json). */
  readonly envelopeSchema: JsonSchema;
  /** The error envelope schema. */
  readonly errorEnvelopeSchema: JsonSchema;
  /** Non-intent route annotations. */
  readonly routeAnnotations: ReadonlyArray<RouteAnnotation>;
  /** Build metadata stamped into info.x-atlas-build. */
  readonly buildMetadata: {
    readonly atlasVersion: string;
    readonly gitCommit?: string;
    readonly generatedAt: string;
  };
}

/** A JSON Schema document — opaque to the generator; passed through to components. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** The emitted OpenAPI 3.1 document. Plain object; JSON.stringify produces valid spec. */
export interface OpenApiDocument {
  openapi: '3.1.0';
  info: {
    title: string;
    version: string;
    description: string;
    'x-atlas-build': BuildOpenApiInput['buildMetadata'];
  };
  servers: ReadonlyArray<{ url: string; description?: string }>;
  tags: ReadonlyArray<{ name: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    responses: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
  security: ReadonlyArray<Record<string, ReadonlyArray<string>>>;
}

export type { ModuleManifest, ActionDeclaration };
