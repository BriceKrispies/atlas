/**
 * DSL read + validate routes.
 *
 * Per ADR 0007 §8 every DSL kind exposes the same authoring shape. This
 * file ships the read + validate half:
 *   - `GET  /api/v1/dsl/:kind`                  → list artifacts for the kind
 *   - `GET  /api/v1/dsl/:kind/:apiName`         → latest version of one
 *   - `GET  /api/v1/dsl/:kind/:apiName/v/:vers` → specific historical version
 *   - `POST /api/v1/dsl/:kind/validate`         → parse + static-check (no save)
 *
 * The save half (`Dsl.<Kind>.Update`) flows through the standard intent
 * pipeline at `POST /api/v1/intents` once the action schema is registered
 * (deferred to slice #5b).
 *
 * Authz: the action ids (`Dsl.<Kind>.{List,Read,Validate}`) are not yet
 * in the platform's module manifests, so the `policyEngine.evaluate()`
 * check that other read routes run is deliberately skipped here — adding
 * it now would deny every request. A follow-up slice lands the manifest +
 * the policy check together; until then, the route is auth-gated by the
 * standard `principalMiddleware` (the principal must resolve before
 * reaching this route group).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getDslArtifact,
  getDslArtifactVersion,
  listDslArtifacts,
  validateDslSource,
} from '@atlas/dsl';
import { DslHandlerError } from '@atlas/dsl';
import type { AppState } from '../bootstrap.ts';
import { errorResponse, mapError } from '../middleware/errors.ts';
import { buildRequestBundle } from '../middleware/state.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

interface ValidateBody {
  source?: unknown;
  hints?: unknown;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function dslRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  // -------- GET /api/v1/dsl/:kind --------
  app.get('/api/v1/dsl/:kind', async function (c: AppCtx) {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const kind = c.req.param('kind');
    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const artifacts = await listDslArtifacts(
        {
          tenantId: principal.tenantId,
          artifactStore: bundle.dslArtifactStore,
          registry: state.dslKindRegistry,
        },
        kind,
      );
      return c.json({
        kind,
        artifacts: artifacts.map(function (a) {
          return {
            artifactId: a.artifactId,
            apiName: a.apiName,
            version: a.version,
            substrateVersion: a.substrateVersion,
            updatedAt: a.updatedAt,
            updatedBy: a.updatedBy,
          };
        }),
      });
    } catch (e) {
      if (e instanceof DslHandlerError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      return mapError(c, e, correlationId);
    }
  });

  // -------- GET /api/v1/dsl/:kind/:apiName --------
  app.get('/api/v1/dsl/:kind/:apiName', async function (c: AppCtx) {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const kind = c.req.param('kind');
    const apiName = c.req.param('apiName');
    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const artifact = await getDslArtifact(
        {
          tenantId: principal.tenantId,
          artifactStore: bundle.dslArtifactStore,
          registry: state.dslKindRegistry,
        },
        kind,
        apiName,
      );
      if (!artifact) {
        return errorResponse(
          c,
          'DSL_ARTIFACT_NOT_FOUND',
          `no ${kind} artifact named '${apiName}'`,
          404,
          correlationId,
        );
      }
      return c.json(serialiseArtifact(artifact));
    } catch (e) {
      if (e instanceof DslHandlerError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      return mapError(c, e, correlationId);
    }
  });

  // -------- GET /api/v1/dsl/:kind/:apiName/v/:version --------
  app.get('/api/v1/dsl/:kind/:apiName/v/:version', async function (c: AppCtx) {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const kind = c.req.param('kind');
    const apiName = c.req.param('apiName');
    const versionRaw = c.req.param('version');
    const version = Number.parseInt(versionRaw, 10);
    if (!Number.isFinite(version) || version < 1) {
      return errorResponse(
        c,
        'DSL_INVALID_VERSION',
        `version must be a positive integer (got '${versionRaw}')`,
        400,
        correlationId,
      );
    }
    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const artifact = await getDslArtifactVersion(
        {
          tenantId: principal.tenantId,
          artifactStore: bundle.dslArtifactStore,
          registry: state.dslKindRegistry,
        },
        kind,
        apiName,
        version,
      );
      if (!artifact) {
        return errorResponse(
          c,
          'DSL_ARTIFACT_NOT_FOUND',
          `no ${kind} artifact '${apiName}' at version ${version}`,
          404,
          correlationId,
        );
      }
      return c.json(serialiseArtifact(artifact));
    } catch (e) {
      if (e instanceof DslHandlerError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      return mapError(c, e, correlationId);
    }
  });

  // -------- POST /api/v1/dsl/:kind/validate --------
  // Validate-without-commit per ADR 0007 §8. Agents iterate against this
  // endpoint to surface parse / static-check errors before paying the
  // artifact-write budget. Idempotent (no audit, no event, no write).
  app.post('/api/v1/dsl/:kind/validate', async function (c: AppCtx) {
    const correlationId = c.get('correlationId');
    const kind = c.req.param('kind');
    let body: ValidateBody;
    try {
      body = (await c.req.json()) as ValidateBody;
    } catch {
      return errorResponse(
        c,
        'DSL_INVALID_REQUEST',
        'request body must be valid JSON',
        400,
        correlationId,
      );
    }
    if (typeof body.source !== 'string') {
      return errorResponse(
        c,
        'DSL_INVALID_REQUEST',
        'request body must include `source: string`',
        400,
        correlationId,
      );
    }
    const hints = isObject(body.hints) ? body.hints : undefined;
    try {
      const result = validateDslSource(
        { registry: state.dslKindRegistry },
        {
          kind,
          source: body.source,
          ...(hints ? { hints } : {}),
        },
      );
      return c.json({
        kind,
        ok: result.ok,
        errors: result.errors,
        ...(result.ast !== undefined ? { ast: result.ast } : {}),
        ...(result.sourceMap !== undefined ? { sourceMap: result.sourceMap } : {}),
      });
    } catch (e) {
      if (e instanceof DslHandlerError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      return mapError(c, e, correlationId);
    }
  });

  return app;
}

function serialiseArtifact(a: import('@atlas/dsl-substrate').DslArtifact<string, unknown>) {
  return {
    kind: a.kind,
    artifactId: a.artifactId,
    apiName: a.apiName,
    version: a.version,
    substrateVersion: a.substrateVersion,
    source: a.source,
    ast: a.ast,
    sourceMap: a.sourceMap,
    dependencies: a.dependencies,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    createdBy: a.createdBy,
    updatedBy: a.updatedBy,
  };
}
