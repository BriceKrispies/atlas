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
 * Authz (Invariant I2): every handler below runs `evaluateRead()` BEFORE
 * touching the store or parsing any source — mirroring the read-path gate
 * in `routes/authz.ts`. The action ids are:
 *   - `GET  /api/v1/dsl/:kind`                  → `Dsl.<Kind>.List`
 *   - `GET  /api/v1/dsl/:kind/:apiName(/v/...)` → `Dsl.<Kind>.Read`
 *   - `POST /api/v1/dsl/:kind/validate`         → `Dsl.<Kind>.Validate`
 * A `deny` decision short-circuits to 403 `AUTHZ_POLICY_DENIED` with NO
 * store read (so the existence of an artifact is never leaked) and, for
 * `validate`, NO parse — the gate runs before `validateDslSource()` because
 * even parsing is a side effect I2 forbids on a denied request. The action
 * ids are registered in `specs/domains/dsl/expression/module.manifest.json`;
 * the default permit shape lives in
 * `specs/policy-fixtures/cli/dsl-expression-default.cedar` and the runtime
 * grant comes from the platform-default role packs (read/list verbs land in
 * the read bucket for TenantAdmin / Author / Viewer).
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
import { evaluateRead } from '@atlas/ingress';
import type { PolicyDecision } from '@atlas/ports';
import type { IngressState } from '@atlas/ingress';
import type { AppState } from '../bootstrap.ts';
import { errorResponse, mapError } from '../middleware/errors.ts';
import { buildRequestBundle } from '../middleware/state.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

/**
 * Capitalise a DSL `kind` for action-id composition (`expression` →
 * `Expression`), matching the `Dsl.<Kind>.<Verb>` action naming in the
 * module manifests. Mirrors the helper in `modules/dsl`'s update handler.
 */
function capitaliseKind(kind: string): string {
  if (kind.length === 0) return kind;
  return (kind[0] ?? '').toUpperCase() + kind.slice(1);
}

/**
 * Run the read-path authz gate for a DSL action against the `DslArtifact`
 * resource type. Returns the decision; the caller short-circuits on
 * `deny`. Kept as a named helper (not an inline closure) so it's directly
 * unit-testable and so all four routes share one gate shape.
 *
 * `artifactId` is the resource id — `''` for List (resource-set-wide) and
 * for Validate (no persisted artifact yet), the apiName for Read.
 */
function dslReadDecision(
  ingress: IngressState,
  principalId: string,
  tenantId: string,
  action: string,
  artifactId: string,
  correlationId: string,
): Promise<PolicyDecision> {
  return evaluateRead(
    {
      principal: { id: principalId, tenantId, attributes: {} },
      action,
      resource: { type: 'DslArtifact', id: artifactId, tenantId, attributes: {} },
      context: { correlationId },
    },
    ingress,
  );
}

const POLICY_DENIED_CODE = 'AUTHZ_POLICY_DENIED';
const POLICY_DENIED_MESSAGE = 'Not authorized to perform this action';

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
    const kind = c.req.param('kind') ?? '';
    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const decision = await dslReadDecision(
        bundle.ingress,
        principal.principalId,
        principal.tenantId,
        `Dsl.${capitaliseKind(kind)}.List`,
        '',
        correlationId,
      );
      if (decision.effect === 'deny') {
        return errorResponse(c, POLICY_DENIED_CODE, POLICY_DENIED_MESSAGE, 403, correlationId);
      }
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
    const kind = c.req.param('kind') ?? '';
    const apiName = c.req.param('apiName') ?? '';
    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const decision = await dslReadDecision(
        bundle.ingress,
        principal.principalId,
        principal.tenantId,
        `Dsl.${capitaliseKind(kind)}.Read`,
        apiName,
        correlationId,
      );
      if (decision.effect === 'deny') {
        return errorResponse(c, POLICY_DENIED_CODE, POLICY_DENIED_MESSAGE, 403, correlationId);
      }
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
    const kind = c.req.param('kind') ?? '';
    const apiName = c.req.param('apiName') ?? '';
    const versionRaw = c.req.param('version') ?? '';
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
      const decision = await dslReadDecision(
        bundle.ingress,
        principal.principalId,
        principal.tenantId,
        `Dsl.${capitaliseKind(kind)}.Read`,
        apiName,
        correlationId,
      );
      if (decision.effect === 'deny') {
        return errorResponse(c, POLICY_DENIED_CODE, POLICY_DENIED_MESSAGE, 403, correlationId);
      }
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
    const principal = c.get('principal');
    const kind = c.req.param('kind') ?? '';
    // I2 short-circuit: authz runs BEFORE the body is read and BEFORE
    // `validateDslSource()` parses anything. Even parsing the candidate
    // source is a side effect (CPU, error shapes, log lines) that a
    // denied request must not trigger — so the gate is the very first
    // thing the handler does, ahead of `c.req.json()`.
    let denied: Response | undefined;
    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const decision = await dslReadDecision(
        bundle.ingress,
        principal.principalId,
        principal.tenantId,
        `Dsl.${capitaliseKind(kind)}.Validate`,
        '',
        correlationId,
      );
      if (decision.effect === 'deny') {
        denied = errorResponse(c, POLICY_DENIED_CODE, POLICY_DENIED_MESSAGE, 403, correlationId);
      }
    } catch (e) {
      if (e instanceof DslHandlerError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      return mapError(c, e, correlationId);
    }
    if (denied) return denied;
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
