/**
 * Entity-store builder for the Cedar adapter.
 *
 * Cedar's `isAuthorized` call expects three EntityUid references (principal,
 * action, resource) plus an `entities` array describing each entity's
 * attributes and parents. The `PolicyEvaluationRequest` envelope already
 * carries pre-resolved attribute snapshots (option (b) from the plan — see
 * `packages/adapters-policy-cedar/README` once that lands), so this module
 * is mostly shape-shuffling rather than fetching.
 *
 * Shape contract Cedar wants (see
 * `cedar-policy/src/ffi/utils.rs::Entities`):
 *
 *   [
 *     { uid: { type: "User", id: "alice" }, attrs: {...}, parents: [] },
 *     { uid: { type: "Family", id: "fam-1" }, attrs: {...}, parents: [] },
 *   ]
 *
 * The two `EntityUid` references inside `AuthorizationCall` use the same
 * `{ type, id }` shape (the explicit form; we deliberately avoid the
 * `__entity` escape so the JSON is human-readable).
 *
 * Tenant scoping: Cedar has no native concept of tenant — we project it
 * into a top-level attribute `tenantId` on principal + resource so policies
 * can reference `principal.tenantId == resource.tenantId`. The defensive
 * tenant-mismatch reject in the engine fires *before* this builder runs,
 * but having `tenantId` on the entities lets policy authors write explicit
 * cross-tenant guards if they want belt-and-braces.
 */

import type { PolicyEvaluationRequest } from '@atlas/ports';

export interface CedarEntityUid {
  type: string;
  id: string;
}

export interface CedarEntity {
  uid: CedarEntityUid;
  attrs: Record<string, unknown>;
  parents: CedarEntityUid[];
}

export interface CedarRequestRefs {
  principal: CedarEntityUid;
  action: CedarEntityUid;
  resource: CedarEntityUid;
  context: Record<string, unknown>;
  entities: CedarEntity[];
}

/** Default principal entity type used when callers don't override it. */
export const DEFAULT_PRINCIPAL_TYPE = 'User';

/**
 * Map an action string (e.g. `Catalog.Family.Publish`) into Cedar's
 * `Action::"Catalog.Family.Publish"` shape. We keep the action id verbatim;
 * Cedar's parser tolerates dots in entity ids.
 */
export const ACTION_ENTITY_TYPE = 'Action';

/**
 * Build the Cedar request triple + entities array from a Platform-shaped
 * `PolicyEvaluationRequest`. Pure function — does no I/O.
 */
export function buildCedarRequest(req: PolicyEvaluationRequest): CedarRequestRefs {
  const principalType = DEFAULT_PRINCIPAL_TYPE;
  const principalUid: CedarEntityUid = { type: principalType, id: req.principal.id };
  const resourceUid: CedarEntityUid = { type: req.resource.type, id: req.resource.id };
  const actionUid: CedarEntityUid = { type: ACTION_ENTITY_TYPE, id: req.action };

  // Snapshot the attribute maps onto the entities. We add `tenantId` last so
  // a caller-supplied attribute named `tenantId` can't override the
  // platform-provided one. (Belt-and-braces; tenant isolation is enforced
  // upstream too.)
  const principalAttrs: Record<string, unknown> = {
    ...req.principal.attributes,
    tenantId: req.principal.tenantId,
  };
  const resourceAttrs: Record<string, unknown> = {
    ...req.resource.attributes,
    tenantId: req.resource.tenantId,
  };

  // Cedar Schema validation (Chunk 6c) requires every entity referenced by
  // an `AuthorizationCall` to appear in the `entities` array — including
  // the Action. We emit it with empty attrs/parents (Cedar's actions don't
  // carry attributes in v1 of our schema). Without this, schema-aware
  // `isAuthorized` calls would surface "action not found in entities"
  // diagnostics even for permitted requests.
  const entities: CedarEntity[] = [
    { uid: principalUid, attrs: principalAttrs, parents: [] },
    { uid: actionUid, attrs: {}, parents: [] },
    { uid: resourceUid, attrs: resourceAttrs, parents: [] },
  ];

  return {
    principal: principalUid,
    action: actionUid,
    resource: resourceUid,
    context: req.context ?? {},
    entities,
  };
}
