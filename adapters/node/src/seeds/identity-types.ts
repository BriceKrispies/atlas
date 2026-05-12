/**
 * Platform-default registry rows for the identity entity types
 * (User, Membership, InviteToken, AuthSession, ApiKey, ServicePrincipal,
 * IdentityProvider, OAuthAccessToken).
 *
 * Lives in @atlas/adapter-node so the postgres.js dependency stays
 * confined to the adapter package. Wired into the control-plane seed
 * runner (`../migrations/seed.ts`).
 *
 * `tenant_id IS NULL` rows are platform defaults inherited by every
 * tenant; tenant-specific overrides shadow them at resolve time.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */

import type postgres from 'postgres';
import {
  USER_ENTITY_TYPE,
  USER_LATEST_VERSION,
  MEMBERSHIP_ENTITY_TYPE,
  MEMBERSHIP_LATEST_VERSION,
  INVITE_TOKEN_ENTITY_TYPE,
  INVITE_TOKEN_LATEST_VERSION,
  AUTH_SESSION_ENTITY_TYPE,
  AUTH_SESSION_LATEST_VERSION,
  API_KEY_ENTITY_TYPE,
  API_KEY_LATEST_VERSION,
  SERVICE_PRINCIPAL_ENTITY_TYPE,
  SERVICE_PRINCIPAL_LATEST_VERSION,
  IDENTITY_PROVIDER_ENTITY_TYPE,
  IDENTITY_PROVIDER_LATEST_VERSION,
  OAUTH_TOKEN_ENTITY_TYPE,
  OAUTH_TOKEN_LATEST_VERSION,
} from '@atlas/identity';
import { jsonParam, type JsonSchema } from './sql-json.ts';

const USER_JSON_SCHEMA: JsonSchema = {
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
};

const MEMBERSHIP_JSON_SCHEMA: JsonSchema = {
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
};

const AUTH_SESSION_JSON_SCHEMA: JsonSchema = {
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
};

const INVITE_TOKEN_JSON_SCHEMA: JsonSchema = {
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
};

const API_KEY_JSON_SCHEMA: JsonSchema = {
  $id: 'identity.api_key.v1',
  type: 'object',
};

const SERVICE_PRINCIPAL_JSON_SCHEMA: JsonSchema = {
  $id: 'identity.service_principal.v1',
  type: 'object',
};

const OAUTH_TOKEN_JSON_SCHEMA: JsonSchema = {
  $id: 'identity.oauth_token.v1',
  type: 'object',
};

const IDENTITY_PROVIDER_JSON_SCHEMA: JsonSchema = {
  $id: 'identity.identity_provider.v1',
  type: 'object',
};

export async function seedIdentityEntityTypes(
  sql: postgres.Sql,
): Promise<void> {
  // ----- entity_type_registry --------------------------------------
  await sql`
    INSERT INTO control_plane.entity_type_registry
      (entity_type, tenant_id, schema_version, json_schema, origin)
    VALUES
      (${USER_ENTITY_TYPE},          NULL, ${USER_LATEST_VERSION},
       ${jsonParam(sql, USER_JSON_SCHEMA)},          'platform'),
      (${MEMBERSHIP_ENTITY_TYPE},    NULL, ${MEMBERSHIP_LATEST_VERSION},
       ${jsonParam(sql, MEMBERSHIP_JSON_SCHEMA)},    'platform'),
      (${INVITE_TOKEN_ENTITY_TYPE},  NULL, ${INVITE_TOKEN_LATEST_VERSION},
       ${jsonParam(sql, INVITE_TOKEN_JSON_SCHEMA)},  'platform'),
      (${AUTH_SESSION_ENTITY_TYPE},  NULL, ${AUTH_SESSION_LATEST_VERSION},
       ${jsonParam(sql, AUTH_SESSION_JSON_SCHEMA)},  'platform'),
      (${API_KEY_ENTITY_TYPE},  NULL, ${API_KEY_LATEST_VERSION},
       ${jsonParam(sql, API_KEY_JSON_SCHEMA)},  'platform'),
      (${SERVICE_PRINCIPAL_ENTITY_TYPE}, NULL, ${SERVICE_PRINCIPAL_LATEST_VERSION},
       ${jsonParam(sql, SERVICE_PRINCIPAL_JSON_SCHEMA)}, 'platform'),
      (${OAUTH_TOKEN_ENTITY_TYPE}, NULL, ${OAUTH_TOKEN_LATEST_VERSION},
       ${jsonParam(sql, OAUTH_TOKEN_JSON_SCHEMA)}, 'platform'),
      (${IDENTITY_PROVIDER_ENTITY_TYPE}, NULL, ${IDENTITY_PROVIDER_LATEST_VERSION},
       ${jsonParam(sql, IDENTITY_PROVIDER_JSON_SCHEMA)}, 'platform')
    ON CONFLICT (entity_type, tenant_id) DO NOTHING
  `;

  // ----- field_registry --------------------------------------------
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
  await sql`
    INSERT INTO control_plane.index_registry
      (entity_type, tenant_id, index_name, field_paths, is_unique, where_clause, origin)
    VALUES
      (${USER_ENTITY_TYPE}, NULL, 'email',
       ${jsonParam(sql, ['email'])}, TRUE, NULL, 'platform'),
      (${USER_ENTITY_TYPE}, NULL, 'primaryIdpSubject',
       ${jsonParam(sql, ['primaryIdpSubject'])}, TRUE,
       ${`(attrs->>'primaryIdpSubject') IS NOT NULL`}, 'platform')
    ON CONFLICT (entity_type, tenant_id, index_name) DO NOTHING
  `;

  await sql`
    INSERT INTO control_plane.index_registry
      (entity_type, tenant_id, index_name, field_paths, is_unique, where_clause, origin)
    VALUES
      (${MEMBERSHIP_ENTITY_TYPE}, NULL, 'userId',
       ${jsonParam(sql, ['userId'])}, FALSE, NULL, 'platform'),
      (${MEMBERSHIP_ENTITY_TYPE}, NULL, 'status',
       ${jsonParam(sql, ['status'])}, FALSE, NULL, 'platform')
    ON CONFLICT (entity_type, tenant_id, index_name) DO NOTHING
  `;

  await sql`
    INSERT INTO control_plane.index_registry
      (entity_type, tenant_id, index_name, field_paths, is_unique, where_clause, origin)
    VALUES
      (${INVITE_TOKEN_ENTITY_TYPE}, NULL, 'tokenLookup',
       ${jsonParam(sql, ['tokenLookup'])}, FALSE, NULL, 'platform'),
      (${INVITE_TOKEN_ENTITY_TYPE}, NULL, 'email',
       ${jsonParam(sql, ['email'])}, FALSE, NULL, 'platform')
    ON CONFLICT (entity_type, tenant_id, index_name) DO NOTHING
  `;

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

  await sql`
    INSERT INTO control_plane.index_registry
      (entity_type, tenant_id, index_name, field_paths, is_unique, where_clause, origin)
    VALUES
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'userId',
       ${jsonParam(sql, ['userId'])}, FALSE, NULL, 'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'status',
       ${jsonParam(sql, ['status'])}, FALSE, NULL, 'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'refreshTokenLookup',
       ${jsonParam(sql, ['refreshTokenLookup'])}, FALSE, NULL, 'platform'),
      (${AUTH_SESSION_ENTITY_TYPE}, NULL, 'accessTokenLookup',
       ${jsonParam(sql, ['accessTokenLookup'])}, FALSE, NULL, 'platform')
    ON CONFLICT (entity_type, tenant_id, index_name) DO NOTHING
  `;

  await sql`
    INSERT INTO control_plane.index_registry
      (entity_type, tenant_id, index_name, field_paths, is_unique, where_clause, origin)
    VALUES
      (${API_KEY_ENTITY_TYPE}, NULL, 'userId',
       ${jsonParam(sql, ['userId'])}, FALSE, NULL, 'platform'),
      (${API_KEY_ENTITY_TYPE}, NULL, 'servicePrincipalId',
       ${jsonParam(sql, ['servicePrincipalId'])}, FALSE, NULL, 'platform'),
      (${API_KEY_ENTITY_TYPE}, NULL, 'status',
       ${jsonParam(sql, ['status'])}, FALSE, NULL, 'platform'),
      (${SERVICE_PRINCIPAL_ENTITY_TYPE}, NULL, 'ownerUserId',
       ${jsonParam(sql, ['ownerUserId'])}, FALSE, NULL, 'platform'),
      (${OAUTH_TOKEN_ENTITY_TYPE}, NULL, 'secretLookup',
       ${jsonParam(sql, ['secretLookup'])}, FALSE, NULL, 'platform'),
      (${OAUTH_TOKEN_ENTITY_TYPE}, NULL, 'apiKeyId',
       ${jsonParam(sql, ['apiKeyId'])}, FALSE, NULL, 'platform'),
      (${OAUTH_TOKEN_ENTITY_TYPE}, NULL, 'status',
       ${jsonParam(sql, ['status'])}, FALSE, NULL, 'platform'),
      (${IDENTITY_PROVIDER_ENTITY_TYPE}, NULL, 'issuer',
       ${jsonParam(sql, ['issuer'])}, FALSE, NULL, 'platform'),
      (${IDENTITY_PROVIDER_ENTITY_TYPE}, NULL, 'status',
       ${jsonParam(sql, ['status'])}, FALSE, NULL, 'platform'),
      (${IDENTITY_PROVIDER_ENTITY_TYPE}, NULL, 'kind',
       ${jsonParam(sql, ['kind'])}, FALSE, NULL, 'platform')
    ON CONFLICT (entity_type, tenant_id, index_name) DO NOTHING
  `;
}
