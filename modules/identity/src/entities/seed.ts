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
       ${sql.json(INVITE_TOKEN_JSON_SCHEMA as never)},  'platform')
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
}
