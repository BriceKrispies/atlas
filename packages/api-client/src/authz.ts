/**
 * Typed wrappers for the authz HTTP surface.
 *
 * Reads (`listPolicies`, `getPolicy`) hit dedicated GET endpoints under
 * `/api/v1/policies`. Writes go through the standard intent pipeline
 * (`POST /api/v1/intents`) so the policy engine evaluates the request
 * just like any other side-effecting action — authz dogfoods itself.
 *
 * This module is the only place the admin app constructs intent payloads
 * for `Authz.Policy.*` actions; the surfaces import these helpers
 * instead of stamping envelope fields by hand.
 */

import { backend } from './runtime.ts';

export type PolicyStatus = 'draft' | 'active' | 'archived';

export interface PolicySummary {
  tenantId: string;
  version: number;
  status: PolicyStatus;
  description: string | null;
  lastModifiedAt: string;
  lastModifiedBy: string | null;
}

export interface PolicyDetail extends PolicySummary {
  cedarText: string;
}

export async function listPolicies(): Promise<readonly PolicySummary[]> {
  const result = await backend.query('/policies');
  if (result === null || result === undefined) return [];
  if (!Array.isArray(result)) {
    throw new Error('listPolicies: expected array response from /policies');
  }
  // The contract is checked against the wire schema upstream; here we
  // only guarantee the array shape and let TS infer the element type
  // through the declared return type. Each element is opaque to us.
  return result.filter(isPolicySummary);
}

export async function getPolicy(version: number): Promise<PolicyDetail | null> {
  const result = await backend.query(`/policies/${version}`);
  if (result === null || result === undefined) return null;
  if (!isPolicyDetail(result)) {
    throw new Error(`getPolicy: response for /policies/${version} is not a PolicyDetail`);
  }
  return result;
}

function isPolicySummary(v: unknown): v is PolicySummary {
  if (typeof v !== 'object' || v === null) return false;
  // After the null/object narrowing, indexing with `in` + Reflect.get
  // gives a typed `unknown` read for each field without a structural
  // downcast on `v`.
  return (
    'tenantId' in v && typeof Reflect.get(v, 'tenantId') === 'string' &&
    'version' in v && typeof Reflect.get(v, 'version') === 'number' &&
    'status' in v && typeof Reflect.get(v, 'status') === 'string'
  );
}

function isPolicyDetail(v: unknown): v is PolicyDetail {
  return (
    isPolicySummary(v) &&
    'cedarText' in v &&
    typeof Reflect.get(v, 'cedarText') === 'string'
  );
}

export async function createPolicy(input: {
  cedarText: string;
  description?: string;
}): Promise<unknown> {
  const payload: Record<string, unknown> = {
    actionId: 'Authz.Policy.Create',
    resourceType: 'Policy',
    resourceId: null,
    cedarText: input.cedarText,
    schemaVersion: 1,
  };
  if (input.description !== undefined) payload['description'] = input.description;
  return backend.mutate('/intents', payload);
}

export async function activatePolicy(version: number): Promise<unknown> {
  return backend.mutate('/intents', {
    actionId: 'Authz.Policy.Activate',
    resourceType: 'Policy',
    resourceId: String(version),
    version,
  });
}

export async function archivePolicy(version: number): Promise<unknown> {
  return backend.mutate('/intents', {
    actionId: 'Authz.Policy.Archive',
    resourceType: 'Policy',
    resourceId: String(version),
    version,
  });
}
