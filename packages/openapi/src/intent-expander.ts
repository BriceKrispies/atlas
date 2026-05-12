/**
 * Expands the canonical /api/v1/intents endpoint into one OpenAPI
 * operation per declared action, walking module manifests.
 *
 * Per specs/crosscut/openapi.md: this is the load-bearing DX decision —
 * SDK codegen produces `client.contentPages.pageCreate(payload)` instead
 * of `client.intents.submit({actionId, payload})`. Each operation has
 * its own operationId derived from actionId; the request body schema
 * is the envelope wrapped around the action's specific payload shape.
 */

import type {
  ActionAudienceOverrides,
  ActionDeclaration,
  Audience,
  JsonSchema,
  ModuleManifest,
} from './types.ts';
import { intentResponses } from './error-responses.ts';

export interface IntentExpansion {
  /** OpenAPI path entries for /api/v1/intents — one method per action. */
  readonly pathOperations: Readonly<Record<string, Record<string, unknown>>>;
  /** components/schemas entries built for the per-action envelopes. */
  readonly schemaComponents: Readonly<Record<string, unknown>>;
  /** Tags emitted (one per module). */
  readonly tags: ReadonlyArray<{ name: string; description?: string }>;
}

export interface ExpandIntentsInput {
  readonly audience: Audience;
  readonly manifests: ReadonlyArray<ModuleManifest>;
  readonly actionAudienceOverrides: ActionAudienceOverrides;
  readonly actionPayloadSchemas: Readonly<Record<string, JsonSchema>>;
  readonly envelopeSchema: JsonSchema;
}

/**
 * Walk every manifest's actions[]. For each action whose audience
 * matches the target audience, emit one operation. Each emitted
 * operation lives at `/api/v1/intents` — a Hono route can only have
 * one HTTP method, so all intent operations would technically need
 * to be merged. OpenAPI doesn't support that natively; we work around
 * it by emitting each as a SEPARATE PATH using a synthetic suffix
 * (`/api/v1/intents#contentPagesPageCreate`) — this is a valid OpenAPI
 * path string and SDK codegen tools handle it as distinct operations.
 *
 * (The fragment-style discriminator path is the OpenAPI 3.1 idiom for
 * documenting a single endpoint with multiple discriminated payloads
 * such that codegen produces separate methods. The runtime collapses
 * back to the single POST /api/v1/intents endpoint — Atlas's server
 * doesn't see the suffix.)
 */
export function expandIntents(input: ExpandIntentsInput): IntentExpansion {
  const pathOperations: Record<string, Record<string, unknown>> = {};
  const schemaComponents: Record<string, JsonSchema> = {};
  const tags: { name: string; description?: string }[] = [];

  for (const manifest of input.manifests) {
    const tagName = manifest.moduleId;
    const tagAdded = tags.some((t) => t.name === tagName);
    let moduleHadIncludedAction = false;

    for (const action of manifest.actions) {
      const audience = input.actionAudienceOverrides[action.actionId] ?? 'tenant';
      if (audience !== input.audience) continue;

      moduleHadIncludedAction = true;

      const operationId = actionIdToOperationId(action.actionId);
      // Synthetic per-action path so SDK generators see distinct ops.
      // Server collapses back to POST /api/v1/intents.
      const path = `/api/v1/intents#${operationId}`;

      const payloadSchema = input.actionPayloadSchemas[action.actionId];
      const envelopeSchemaName = `Envelope_${operationId}`;
      schemaComponents[envelopeSchemaName] = wrapPayloadInEnvelope(
        action,
        input.envelopeSchema,
        payloadSchema,
      );

      pathOperations[path] = {
        post: buildOperation(action, operationId, manifest.moduleId, envelopeSchemaName),
      };
    }

    if (moduleHadIncludedAction && !tagAdded) {
      const tag: { name: string; description?: string } = { name: tagName };
      if (manifest.displayName !== undefined) {
        tag.description = manifest.displayName;
      }
      tags.push(tag);
    }
  }

  return { pathOperations, schemaComponents, tags };
}

/**
 * `ContentPages.Page.Create` → `contentPagesPageCreate`.
 * Each dot-segment is camel-case-stripped and concatenated.
 */
export function actionIdToOperationId(actionId: string): string {
  const parts = actionId.split('.').filter((p) => p.length > 0);
  if (parts.length === 0) return 'unknown';
  return parts
    .map((seg, i) => (i === 0 ? lowerFirst(seg) : upperFirst(seg)))
    .join('');
}

function lowerFirst(s: string): string {
  // `charAt(0)` returns `''` for empty strings (never undefined), so we
  // get the empty-string short-circuit for free without a non-null assertion.
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildOperation(
  action: ActionDeclaration,
  operationId: string,
  moduleId: string,
  envelopeSchemaName: string,
): Record<string, unknown> {
  return {
    tags: [moduleId],
    operationId,
    summary: humanizeAction(action),
    description: buildActionDescription(action),
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${envelopeSchemaName}` },
        },
      },
    },
    parameters: [
      {
        name: 'X-Correlation-Id',
        in: 'header',
        required: false,
        description:
          'Optional flow id; minted server-side if absent. Preserved across retries; use the same id when retrying a failed request.',
        schema: { type: 'string' },
      },
    ],
    responses: intentResponses(),
  };
}

function humanizeAction(action: ActionDeclaration): string {
  const verbMap: Readonly<Record<string, string>> = {
    create: 'Create',
    update: 'Update',
    delete: 'Delete',
    read: 'Read',
    apply: 'Apply',
    publish: 'Publish',
    archive: 'Archive',
    activate: 'Activate',
  };
  const verb = verbMap[action.verb] ?? capitalise(action.verb);
  return `${verb} ${action.resourceType}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildActionDescription(action: ActionDeclaration): string {
  const lines: string[] = [];
  lines.push(`Submits the **${action.actionId}** intent through the canonical ingress pipeline.`);
  lines.push('');
  lines.push(`The actual HTTP target is \`POST /api/v1/intents\` with \`actionId: "${action.actionId}"\` in the envelope. SDK codegen emits this as a distinct operation for ergonomic per-action methods; the server runtime sees a single endpoint.`);
  lines.push('');
  lines.push('Returns **202 Accepted**: the handler emitted an event; downstream projections + cache invalidation run asynchronously per `WORKER_MODE`.');
  if (action.auditLevel) {
    lines.push('');
    lines.push(`Audit level: \`${action.auditLevel}\`.`);
  }
  return lines.join('\n');
}

/**
 * Wrap a per-action payload schema inside the event envelope. The
 * envelope's `payload` property gets typed to the specific shape;
 * `schemaId` and `eventType` get const-ed so the spec documents
 * exactly what to send.
 *
 * If no payload schema is bundled (the action ships before its schema
 * does), we emit `payload: {}` (any object) so the operation still
 * appears in the spec. This is rare — most actions have schemas.
 */
function wrapPayloadInEnvelope(
  action: ActionDeclaration,
  envelopeSchema: JsonSchema,
  payloadSchema: JsonSchema | undefined,
): Record<string, unknown> {
  // Clone the envelope and patch `payload` + `eventType` + `schemaId`
  // to be specific to this action.
  const cloned = structuredClone(envelopeSchema) as Record<string, unknown>;
  // Clear $id so the cloned schema doesn't collide with the source's $id.
  delete cloned['$id'];
  // The envelope's $schema clause is fine to keep. Narrow `properties`
  // via a runtime shape check rather than a structural cast.
  const rawProps = cloned['properties'];
  const properties: Record<string, unknown> | undefined =
    typeof rawProps === 'object' && rawProps !== null && !Array.isArray(rawProps)
      ? (rawProps as Record<string, unknown>) // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- boundary: JSON object narrowed by the typeof+non-null+!isArray guard above
      : undefined;
  if (properties !== undefined) {
    properties['eventType'] = {
      type: 'string',
      const: synthesiseEventType(action),
      description: 'Discriminator. Must equal this value for this operation.',
    };
    if (payloadSchema !== undefined) {
      properties['payload'] = payloadSchema;
    } else {
      properties['payload'] = {
        type: 'object',
        description: 'Action-specific payload shape (no bundled schema yet).',
      };
    }
  }
  return cloned;
}

/**
 * Atlas events use the form `Domain.ResourceType.Past-tense-verb`.
 * The action declares `verb` (create/update/etc.); the past-tense form
 * comes from a small map. Unknown verbs are kept as-is — the schema
 * generator doesn't need to enumerate every verb in the system.
 */
function synthesiseEventType(action: ActionDeclaration): string {
  const PAST: Readonly<Record<string, string>> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    publish: 'Published',
    archive: 'Archived',
    activate: 'Activated',
    apply: 'Applied',
  };
  // Take the leading domain segment from actionId.
  const domain = action.actionId.split('.')[0] ?? '';
  const past = PAST[action.verb] ?? capitalise(action.verb);
  return `${domain}.${action.resourceType}${past}`;
}
