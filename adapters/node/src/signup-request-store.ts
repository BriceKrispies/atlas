/**
 * PostgresSignupRequestStore — control-plane signup queue.
 *
 * Schema is installed by
 * `migrations/control-plane/00000004_tenancy_signup.sql`. The unique
 * `(email, tenant_slug)` index is what lets `create` collapse retries
 * onto the existing row instead of erroring or minting a duplicate.
 */

import type postgres from 'postgres';
import type {
  CreateSignupRequestInput,
  SignupRequest,
  SignupRequestStatus,
  SignupRequestStore,
} from '@atlas/ports';

interface SignupRequestRow {
  signup_id: string;
  email: string;
  tenant_slug: string;
  organization_name: string;
  status: SignupRequestStatus;
  approved_tenant_id: string | null;
  denied_reason: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

function rowToRequest(row: SignupRequestRow): SignupRequest {
  return {
    signupId: row.signup_id,
    email: row.email,
    tenantSlug: row.tenant_slug,
    organizationName: row.organization_name,
    status: row.status,
    approvedTenantId: row.approved_tenant_id,
    deniedReason: row.denied_reason,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresSignupRequestStore implements SignupRequestStore {
  constructor(private readonly sql: postgres.Sql) {}

  async create(input: CreateSignupRequestInput): Promise<SignupRequest> {
    const email = input.email.toLowerCase();
    // ON CONFLICT … DO UPDATE … RETURNING is how we get the existing row
    // back without a second SELECT. The `updated_at = updated_at` no-op
    // assignment is what forces the RETURNING clause to fire on conflict
    // — without it postgres returns nothing for the conflicting branch.
    const rows = await this.sql<SignupRequestRow[]>`
      INSERT INTO control_plane.signup_requests (
        signup_id, email, tenant_slug, organization_name,
        status, correlation_id
      ) VALUES (
        ${input.signupId},
        ${email},
        ${input.tenantSlug},
        ${input.organizationName},
        'pending',
        ${input.correlationId}
      )
      ON CONFLICT (email, tenant_slug) DO UPDATE SET updated_at = control_plane.signup_requests.updated_at
      RETURNING signup_id, email, tenant_slug, organization_name, status,
                approved_tenant_id, denied_reason, correlation_id,
                created_at, updated_at
    `;
    const r = rows[0];
    if (!r) throw new Error('signup_requests insert returned no row');
    return rowToRequest(r);
  }

  async get(signupId: string): Promise<SignupRequest | null> {
    const rows = await this.sql<SignupRequestRow[]>`
      SELECT signup_id, email, tenant_slug, organization_name, status,
             approved_tenant_id, denied_reason, correlation_id,
             created_at, updated_at
      FROM control_plane.signup_requests
      WHERE signup_id = ${signupId}
      LIMIT 1
    `;
    const r = rows[0];
    return r ? rowToRequest(r) : null;
  }

  async list(filter?: {
    status?: SignupRequestStatus;
    limit?: number;
  }): Promise<SignupRequest[]> {
    const limit = Math.max(1, Math.min(filter?.limit ?? 50, 200));
    const status = filter?.status;
    const rows = await this.sql<SignupRequestRow[]>`
      SELECT signup_id, email, tenant_slug, organization_name, status,
             approved_tenant_id, denied_reason, correlation_id,
             created_at, updated_at
      FROM control_plane.signup_requests
      WHERE TRUE
        ${status ? this.sql`AND status = ${status}` : this.sql``}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows.map(rowToRequest);
  }

  async markApproved(
    signupId: string,
    tenantId: string,
  ): Promise<SignupRequest> {
    const rows = await this.sql<SignupRequestRow[]>`
      UPDATE control_plane.signup_requests
      SET status = 'approved',
          approved_tenant_id = ${tenantId},
          updated_at = NOW()
      WHERE signup_id = ${signupId}
        AND status = 'pending'
      RETURNING signup_id, email, tenant_slug, organization_name, status,
                approved_tenant_id, denied_reason, correlation_id,
                created_at, updated_at
    `;
    const r = rows[0];
    if (!r) {
      throw new Error(
        `signup_requests.markApproved: ${signupId} not found or not pending`,
      );
    }
    return rowToRequest(r);
  }

  async markDenied(signupId: string, reason: string): Promise<SignupRequest> {
    const rows = await this.sql<SignupRequestRow[]>`
      UPDATE control_plane.signup_requests
      SET status = 'denied',
          denied_reason = ${reason},
          updated_at = NOW()
      WHERE signup_id = ${signupId}
        AND status = 'pending'
      RETURNING signup_id, email, tenant_slug, organization_name, status,
                approved_tenant_id, denied_reason, correlation_id,
                created_at, updated_at
    `;
    const r = rows[0];
    if (!r) {
      throw new Error(
        `signup_requests.markDenied: ${signupId} not found or not pending`,
      );
    }
    return rowToRequest(r);
  }
}
