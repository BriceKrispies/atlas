/**
 * Platform-default registry rows for the User, Membership, and
 * InviteToken entity types. Wired into the control-plane seed runner
 * (`adapters/node/src/migrations/seed.ts`).
 *
 * `tenant_id IS NULL` rows are platform defaults inherited by every
 * tenant; tenant-specific overrides shadow them at resolve time. Same
 * pattern as `seedContentPagesEntityTypes`.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */

import type postgres from 'postgres';
import {
  USER_ENTITY_TYPE,
  USER_LATEST_VERSION,
} from './user.ts';
import {
  MEMBERSHIP_ENTITY_TYPE,
  MEMBERSHIP_LATEST_VERSION,
} from './membership.ts';
import {
  INVITE_TOKEN_ENTITY_TYPE,
  INVITE_TOKEN_LATEST_VERSION,
} from './invite-token.ts';
import {
  AUTH_SESSION_ENTITY_TYPE,
  AUTH_SESSION_LATEST_VERSION,
} from './auth-session.ts';
import {
  API_KEY_ENTITY_TYPE,
  API_KEY_LATEST_VERSION,
} from './api-key.ts';
import {
  SERVICE_PRINCIPAL_ENTITY_TYPE,
  SERVICE_PRINCIPAL_LATEST_VERSION,
} from './service-principal.ts';
import {
  OAUTH_TOKEN_ENTITY_TYPE,
  OAUTH_TOKEN_LATEST_VERSION,
} from './oauth-token.ts';

const USER_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'identity.user.v1',
  type: 'object',
  required: ['userId', 'email', 'status', 'primaryIdpSubject', 'createdAt', 'updatedAt'],
  additionalProperties: false,
  properties: {
    userId: { type: 'string' },
    email: { type: 'string', format: 'email' },
    status: { type: 'string', enum: ['active', 'suspended', 'deprovisioned'] },
    primaryIdpSubject: { type: ['string', 'null'] },
    givenName: { type: 'string' },
    familyName: { type: 'string' },
    passwordHash: { type: 'string' },
    lastLoginAt: { type: 'string', format: 'date-time' },
    failedLoginCount: { type: 'integer', minimum: 0 },
    lockedUntil: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const MEMBERSHIP_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'identity.membership.v1',
  type: 'object',
  required: ['membershipId', 'tenantId', 'userId', 'roles', 'status', 'createdAt', 'updatedAt'],
  additionalProperties: false,
  properties: {
    membershipId: { type: 'string' },
    tenantId: { type: 'string' },
    userId: { type: 'string' },
    roles: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['active', 'suspended', 'ended'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const AUTH_SESSION_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'identity.auth_session.v1',
  type: 'object',
  required: [
    'sessionId',
    'tenantId',
    'userId',
    'refreshTokenHash',
    'refreshTokenLookup',
    'accessTokenHash',
    'accessTokenLookup',
    'accessExpiresAt',
    'issuedAt',
    'lastRefreshedAt',
    'lastSeenAt',
    'hardExpiresAt',
    'status',
  ],
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string' },
    tenantId: { type: 'string' },
    userId: { type: 'string' },
    refreshTokenHash: { type: 'string' },
    refreshTokenLookup: { type: 'string' },
    previousRefreshTokenHash: { type: 'string' },
    previousRotatedAt: { type: 'string', format: 'date-time' },
    accessTokenHash: { type: 'string' },
    accessTokenLookup: { type: 'string' },
    accessExpiresAt: { type: 'string', format: 'date-time' },
    issuedAt: { type: 'string', format: 'date-time' },
    lastRefreshedAt: { type: 'string', format: 'date-time' },
    lastSeenAt: { type: 'string', format: 'date-time' },
    hardExpiresAt: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: ['active', 'expired', 'revoked', 'evicted'] },
    ip: { type: 'string' },
    userAgent: { type: 'string' },
    endReason: { type: 'string' },
    endedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const INVITE_TOKEN_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'identity.invite_token.v1',
  type: 'object',
  required: [
    'tokenId',
    'tenantId',
    'email',
    'tokenHash',
    'tokenLookup',
    'rolesOnAccept',
    'status',
    'expiresAt',
    'createdAt',
  ],
  additionalProperties: false,
  properties: {
    tokenId: { type: 'string' },
    tenantId: { type: 'string' },
    email: { type: 'string', format: 'email' },
    tokenHash: { type: 'string' },
    tokenLookup: { type: 'string' },
    rolesOnAccept: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['pending', 'accepted', 'expired', 'revoked'] },
    expiresAt: { type: 'string', format: 'date-time' },
    acceptedAt: { type: 'string', format: 'date-time' },
    acceptedUserId: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export async function seedIdentityEntityTypes(
  sql: postgres.Sql,
): Promise<void> {
  // ----- entity_type_registry --------------------------------------
  await sql`
    INSERT INTO control_plane.entity_type_registry
      (entity_type, tenant_id, schema_version, json_schema, origin)
    VALUES
      (${USER_ENTITY_TYPE},          NULL, ${USER_LATEST_VERSION},
       ${sql.json(USER_JSON_SCHEMA as never)},          'platform'),
      (${MEMBERSHIP_ENTITY_TYPE},    NULL, ${MEMBERSHIP_LATEST_VERSION},
       ${sql.json(MEMBERSHIP_JSON_SCHEMA as never)},    'platform'),
      (${INVITE_TOKEN_ENTITY_TYPE},  NULL, ${INVITE_TOKEN_LATEST_VERSION},
       ${sql.json(INVITE_TOKEN_JSON_SCHEMA as never)},  'platform'),
      (${AUTH_SESSION_ENTITY_TYPE},  NULL, ${AUTH_SESSION_LATEST_VERSION},
       ${sql.json(AUTH_SESSION_JSON_SCHEMA as never)},  'platform'),
      (${API_KEY_ENTITY_TYPE},  NULL, ${API_KEY_LATEST_VERSION},
       ${sql.json({ $id: 'identity.api_key.v1', type: 'object' } as never)},  'platform'),
      (${SERVICE_PRINCIPAL_ENTITY_TYPE}, NULL, ${SERVICE_PRINCIPAL_LATEST_VERSION},
       ${sql.json({ $id: 'identity.service_principal.v1', type: 'object' } as never)}, 'platform'),
      (${OAUTH_TOKEN_ENTITY_TYPE}, NULL, ${OAUTH_TOKEN_LATEST_VERSION},
       ${sql.json({ $id: 'identity.oauth_token.v1', type: 'object' } as never)}, 'platform')
    ON CONFLICT (entity_type, tenant_id) DO NOTHING
  `;

  // ----- field_registry --------------------------------------------
  // Only fields that participate in queries / display get rows. Full
  // validation is handled by the JSON schemas above.
  await sql`
    INSERT INTO control_plane.field_registry
      (entity_type, tenant_id, field_path, data_type, label, is_required, origin)
    VALUES
      (${USER_ENTITY_TYPE}, NULL, 'userId',             'string', 'User ID',          TRUE,  'platform'),
      (${USER_ENTITY_TYPE}, NULL, 'email',              'string', 'Email',            TRUE,  'platform'),
      (${USER_ENTITY_TYPE}, NULL, 'primaryIdpSubject',  'string', 'IDP Subject',      FALSE, 'platform'),
      (${USER_ENTITY_TYPE}, NULL, 'status',             'enum',   'Status',           TRUE,  'platform'),
      (${USER_ENTITY_TYPE}, NULL, 'lastLoginAt',        'date',   'Last Login',       FALSE, 'platform')
    ON CONFLICT (entity_type, tenant_id, field_path) DO NOTHING
  `;

  await sql`
    INSERT INTO control_plane.field_registry
      (entity_type, tenant_id, field_path, data_type, label, is_required, origin)
    VALUES
      (${MEMBERSHIP_ENTITY_TYPE}, NULL, 'membershipId', 'string', 'Membership ID', TRUE, 'platform'),
      (${MEMBERSHIP_ENTITY_TYPE}, NULL, 'userId',       'string', 'User ID',       TRUE, 'platform'),
      (${MEMBERSHIP_ENTITY_TYPE}, NULL, 'roles',        'array',  'Roles',         TRUE, 'platform'),
      (${MEMBERSHIP_ENTITY_TYPE}, NULL, 'status',       'enum',   'Status',        TRUE, 'platform')
    ON CONFLICT (entity_type, tenant_id, field_path) DO NOTHING
  `;

  await sql`
    INSERT INTO control_plane.field_registry
      (entity_type, tenant_id, field_path, data_type, label, is_required, origin)
    VALUES
      (${INVITE_TOKEN_ENTITY_TYPE}, NULL, 'tokenId',     'string', 'Token ID',  TRUE,  'platform'),
      (${INVITE_TOKEN_ENTITY_TYPE}, NULL, 'email',       'string', 'Email',     TRUE,  'platform'),
      (${INVITE_TOKEN_ENTITY_TYPE}, NULL, 'tokenLookup', 'string', 'Lookup',    TRUE,  'platform'),
      (${INVITE_TOKEN_ENTITY_TYPE}, NULL, 'status',      'enum',   'Status',    TRUE,  'platform'),
      (${INVITE_TOKEN_ENTITY_TYPE}, NULL, 'expiresAt',   'date',   'Expires',   TRUE,  'platform')
    ON CONFLICT (entity_type, tenant_id, field_path) DO NOTHING
  `;

  // ----- index_registry --------------------------------------------
  // User: unique on (email), unique on (primaryIdpSubject) when present.
  // The materializer builds expression indexes on `attrs->>` paths gated
  // by entity_type via the leading PK columns.
  await sql`
    INSERT INTO control_plane.index_registry
      (entity_type, tenant_id, index_name, field_paths, is_unique, where_clause, origin)
    VALUES
      (${USER_ENTITY_TYPE}, NULL, 'email',
       ${sql.json(['email'] as never)}, TRUE, NULL, 'platform'),
      (${USER_ENTITY_TYPE}, NULL, 'primaryIdpSubject',
       ${sql.json(['primaryIdpSubject'] as never)}, TRUE,
       ${`(attrs->>'primaryIdpSubject') IS NOT NULL`}, 'platform')
    ON CONFLICT (entity_type, tenant_id, index_name) DO NOTHING
  `;

  // Membership: unique on (userId) per tenant; the deterministic
  // entity_id (`m:<userId>`) plus the substrate's PK already enforce
  // uniqueness. The named index below is for the query path
  // (`listMembershipsForUser` cross-tenant — Phase A3+).
  await sql`
    INSERT INTO control_plane.index_registry
      (entity_type, tenant_id, index_name, field_paths, is_unique, where_clause, origin)
    VALUES
      (${MEMBERSHIP_ENTITY_TYPE}, NULL, 'userId',
       ${sql.json(['userId'] as never)}, FALSE, NULL, 'platform'),
      (${MEMBERSHIP_ENTITY_TYPE}, NULL, 'status',
       ${sql.json(['status'] as never)}, FALSE, NULL, 'platform')
    ON CONFLICT (entity_type, tenant_id, index_name) DO NOTHING
  `;

  await sql`
    INSERT INTO control_plane.index_registry
      (entity_type, tenant_id, index_name, field_paths, is_unique, where_clause, origin)
    VALUES
      (${INVITE_TOKEN_ENTITY_TYPE}, NULL, 'tokenLookup',
       ${sql.json(['tokenLookup'] as never)}, FALSE, NULL, 'platform'),
      (${INVITE_TOKEN_ENTITY_TYPE}, NULL, 'email',
       ${sql.json(['email'] as never)}, FALSE, NULL, 'platform')
    ON CONFLICT (entity_type, tenant_id, index_name) DO NOTHING
  `;

  // AuthSession field registry — only the queryable fields.
  await sql`
    INSERT INTO control_plane.field_registry
      (entity_type, tenant_id, field_path, data_type, label, is_required, origin)
    VALUES
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'sessionId',          'string', 'Session ID', TRUE,  'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'userId',             'string', 'User ID',    TRUE,  'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'status',             'enum',   'Status',     TRUE,  'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'refreshTokenLookup', 'string', 'Refresh Lookup', TRUE, 'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'accessTokenLookup',  'string', 'Access Lookup',  TRUE, 'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'lastSeenAt',         'date',   'Last Seen',  TRUE,  'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'hardExpiresAt',      'date',   'Hard Expires', TRUE, 'platform')
    ON CONFLICT (entity_type, tenant_id, field_path) DO NOTHING
  `;

  // AuthSession indexes — userId for "list active sessions for user"
  // (the concurrent-limit eviction path), refreshTokenLookup for the
  // bucket-narrowing on cookie-less refresh, accessTokenLookup for the
  // principal middleware bearer-auth path.
  await sql`
    INSERT INTO control_plane.index_registry
      (entity_type, tenant_id, index_name, field_paths, is_unique, where_clause, origin)
    VALUES
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'userId',
       ${sql.json(['userId'] as never)}, FALSE, NULL, 'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'status',
       ${sql.json(['status'] as never)}, FALSE, NULL, 'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'refreshTokenLookup',
       ${sql.json(['refreshTokenLookup'] as never)}, FALSE, NULL, 'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'accessTokenLookup',
       ${sql.json(['accessTokenLookup'] as never)}, FALSE, NULL, 'platform')
    ON CONFLICT (entity_type, tenant_id, index_name) DO NOTHING
  `;

  // ApiKey + ServicePrincipal + OAuthAccessToken indexes (Phase A2.7-9).
  await sql`
    INSERT INTO control_plane.index_registry
      (entity_type, tenant_id, index_name, field_paths, is_unique, where_clause, origin)
    VALUES
      (${API_KEY_ENTITY_TYPE}, NULL, 'userId',
       ${sql.json(['userId'] as never)}, FALSE, NULL, 'platform'),
      (${API_KEY_ENTITY_TYPE}, NULL, 'servicePrincipalId',
       ${sql.json(['servicePrincipalId'] as never)}, FALSE, NULL, 'platform'),
      (${API_KEY_ENTITY_TYPE}, NULL, 'status',
       ${sql.json(['status'] as never)}, FALSE, NULL, 'platform'),
      (${SERVICE_PRINCIPAL_ENTITY_TYPE}, NULL, 'ownerUserId',
       ${sql.json(['ownerUserId'] as never)}, FALSE, NULL, 'platform'),
      (${OAUTH_TOKEN_ENTITY_TYPE}, NULL, 'secretLookup',
       ${sql.json(['secretLookup'] as never)}, FALSE, NULL, 'platform'),
      (${OAUTH_TOKEN_ENTITY_TYPE}, NULL, 'apiKeyId',
       ${sql.json(['apiKeyId'] as never)}, FALSE, NULL, 'platform'),
      (${OAUTH_TOKEN_ENTITY_TYPE}, NULL, 'status',
       ${sql.json(['status'] as never)}, FALSE, NULL, 'platform')
    ON CONFLICT (entity_type, tenant_id, index_name) DO NOTHING
  `;
}
