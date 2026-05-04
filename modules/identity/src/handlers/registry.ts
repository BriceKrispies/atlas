import type {
  EntityStore,
  HandlerRegistry,
  IntentHandler,
  IntentHandlerContext,
  HandlerResult,
} from '@atlas/ports';
import type { IntentEnvelope } from '@atlas/platform-core';
import { handleUserCreate } from './user-create.ts';
import { handleMembershipCreate } from './membership-create.ts';
import { handleInviteIssue } from './invite-issue.ts';
import { handleInviteAccept } from './invite-accept.ts';
import { handlePasswordSet } from './password-set.ts';
import { handlePasswordLogin } from './password-login.ts';

function readString(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  if (typeof v !== 'string') {
    throw new Error(`expected string for payload.${key}`);
  }
  return v;
}

function readOptionalString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = payload[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new Error(`expected string|null|undefined for payload.${key}`);
  }
  return v;
}

function readStringArray(
  payload: Record<string, unknown>,
  key: string,
): string[] {
  const v = payload[key];
  if (!Array.isArray(v) || !v.every((item) => typeof item === 'string')) {
    throw new Error(`expected string[] for payload.${key}`);
  }
  return v as string[];
}

function readOptionalNumber(
  payload: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = payload[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number') {
    throw new Error(`expected number|null|undefined for payload.${key}`);
  }
  return v;
}

/**
 * Construct identity handler entries.
 *
 * Membership-create + invite-accept need an `EntityStore` (User /
 * Membership / InviteToken lookups). Threaded via closure since
 * `IntentHandlerContext` doesn't carry it — same pattern as content-pages.
 */
export function identityHandlerEntries(
  entities: EntityStore,
): ReadonlyArray<readonly [string, IntentHandler]> {
  const userCreateHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleUserCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          email: readString(payload, 'email'),
          ...(readOptionalString(payload, 'userId') !== undefined
            ? { userId: readOptionalString(payload, 'userId') as string }
            : {}),
          ...(readOptionalString(payload, 'primaryIdpSubject') !== undefined
            ? {
                primaryIdpSubject: readOptionalString(
                  payload,
                  'primaryIdpSubject',
                ) as string,
              }
            : {}),
          ...(readOptionalString(payload, 'givenName') !== undefined
            ? { givenName: readOptionalString(payload, 'givenName') as string }
            : {}),
          ...(readOptionalString(payload, 'familyName') !== undefined
            ? {
                familyName: readOptionalString(payload, 'familyName') as string,
              }
            : {}),
        },
        ctx.eventStore,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const membershipCreateHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleMembershipCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          userId: readString(payload, 'userId'),
          roles: readStringArray(payload, 'roles'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const inviteIssueHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleInviteIssue(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          email: readString(payload, 'email'),
          rolesOnAccept: readStringArray(payload, 'rolesOnAccept'),
          ...(readOptionalNumber(payload, 'ttlSeconds') !== undefined
            ? { ttlSeconds: readOptionalNumber(payload, 'ttlSeconds') as number }
            : {}),
        },
        ctx.eventStore,
      );
      // The plaintext token is surfaced via the intent response shape
      // documented in `events/issue.md`. The handler shape here returns
      // only the envelope chain; the route layer reads `result.plaintextToken`
      // separately (see `apps/server/src/routes/identity/invite.ts`).
      return { primary: result.envelope, follow: [] };
    },
  };

  const inviteAcceptHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleInviteAccept(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          presentedToken: readString(payload, 'presentedToken'),
          ...(readOptionalString(payload, 'primaryIdpSubject') !== undefined
            ? {
                primaryIdpSubject: readOptionalString(
                  payload,
                  'primaryIdpSubject',
                ) as string,
              }
            : {}),
          ...(readOptionalString(payload, 'givenName') !== undefined
            ? { givenName: readOptionalString(payload, 'givenName') as string }
            : {}),
          ...(readOptionalString(payload, 'familyName') !== undefined
            ? {
                familyName: readOptionalString(payload, 'familyName') as string,
              }
            : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  const passwordSetHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handlePasswordSet(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          userId: readString(payload, 'userId'),
          newPassword: readString(payload, 'newPassword'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const passwordLoginHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handlePasswordLogin(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          email: readString(payload, 'email'),
          password: readString(payload, 'password'),
          ...(readOptionalString(payload, 'attemptIp') !== undefined
            ? { attemptIp: readOptionalString(payload, 'attemptIp') as string }
            : {}),
          ...(readOptionalString(payload, 'attemptUserAgent') !== undefined
            ? {
                attemptUserAgent: readOptionalString(
                  payload,
                  'attemptUserAgent',
                ) as string,
              }
            : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  return [
    ['Identity.User.Create', userCreateHandler],
    ['Identity.Membership.Create', membershipCreateHandler],
    ['Identity.Invite.Issue', inviteIssueHandler],
    ['Identity.Invite.Accept', inviteAcceptHandler],
    ['Identity.User.SetPassword', passwordSetHandler],
    ['Identity.Login.Password', passwordLoginHandler],
  ];
}

export function identityHandlerRegistry(
  entities: EntityStore,
): HandlerRegistry {
  const map = new Map<string, IntentHandler>(identityHandlerEntries(entities));
  return {
    get(actionId: string): IntentHandler | undefined {
      return map.get(actionId);
    },
  };
}
