/**
 * Emit the canonical error responses every operation can return.
 * The error envelope shape is `{ error: { code, message, correlationId, supportId } }`
 * per specs/crosscut/errors.md and apps/server/src/middleware/errors.ts.
 *
 * The generator references a single component (`ErrorEnvelope`) and uses
 * named responses (`Unauthorized`, `Forbidden`, etc.) so every operation's
 * `responses` block is short and consistent.
 */

const ERROR_ENVELOPE_REF = { $ref: '#/components/schemas/ErrorEnvelope' };

export const STANDARD_ERROR_RESPONSES = {
  BadRequest: {
    description: 'Malformed request — body shape, missing required fields, etc.',
    content: { 'application/json': { schema: ERROR_ENVELOPE_REF } },
  },
  Unauthorized: {
    description: 'Authentication required or invalid credentials.',
    content: { 'application/json': { schema: ERROR_ENVELOPE_REF } },
  },
  Forbidden: {
    description: 'Authenticated but lacks required role / authz denied.',
    content: { 'application/json': { schema: ERROR_ENVELOPE_REF } },
  },
  Conflict: {
    description: 'Idempotency conflict, version mismatch, or constraint violation.',
    content: { 'application/json': { schema: ERROR_ENVELOPE_REF } },
  },
  PrincipalInvalid: {
    description: 'Tenant scope mismatch, malformed test-auth header, or other principal error.',
    content: { 'application/json': { schema: ERROR_ENVELOPE_REF } },
  },
  TransactionFailed: {
    description: 'Internal error reaching downstream storage. Retry with the same idempotencyKey.',
    content: { 'application/json': { schema: ERROR_ENVELOPE_REF } },
  },
} as const;

/** Default response set for an authenticated write operation (intent submit). */
export function intentResponses(): Record<string, unknown> {
  return {
    '202': {
      description: 'Intent accepted. The response body carries the eventId; downstream projections continue asynchronously.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/IntentAcceptedResponse' },
        },
      },
    },
    '400': { $ref: '#/components/responses/BadRequest' },
    '401': { $ref: '#/components/responses/Unauthorized' },
    '403': { $ref: '#/components/responses/Forbidden' },
    '409': { $ref: '#/components/responses/Conflict' },
    '500': { $ref: '#/components/responses/TransactionFailed' },
  };
}

/** Inline OpenAPI components.responses entries — referenced by intentResponses(). */
export function buildErrorResponseComponents(): Record<string, unknown> {
  return STANDARD_ERROR_RESPONSES as unknown as Record<string, unknown>;
}

/** The IntentAcceptedResponse schema — what 202 returns from POST /api/v1/intents. */
export function intentAcceptedResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['eventId', 'tenantId', 'principalId'],
    properties: {
      eventId: { type: 'string', description: 'The id of the event the handler emitted. Use this to track the action downstream.' },
      tenantId: { type: 'string', description: 'Echoed from the request envelope.' },
      principalId: { type: 'string', description: 'The principal that submitted the intent.' },
    },
  };
}
