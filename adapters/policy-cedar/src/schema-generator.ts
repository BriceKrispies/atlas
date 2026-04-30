/**
 * Cedar Schema generator — pure function producing a deployment-wide Cedar
 * Schema from bundled module manifests.
 *
 * Per-deployment, NOT per-tenant: every tenant on the same deployment shares
 * the same *types* of resources/actions, but each tenant has their own
 * *policies*. This matches how Atlas is laid out today (manifests live in
 * `@atlas/schemas`, policies live in `control_plane.policies`).
 *
 * Output is Cedar's JSON schema form (`Record<namespace, NamespaceDefinition>`).
 * See cedar-wasm's `SchemaJson<string>`. We emit a single namespace
 * (`Atlas`) for now — sub-namespacing per module is a future refinement.
 *
 * Each manifest contributes:
 *   - One `User` entity type (stable across all modules; id, tenantId,
 *     attributes record).
 *   - One entity type per declared `resource` (with `tenantId` + an
 *     open-ended `additionalAttributes: true` shape so existing handler
 *     code that snapshots arbitrary attributes onto the resource doesn't
 *     trip strict validation).
 *   - One Cedar action per declared `action`, with
 *     `appliesTo: { principalTypes: ["User"], resourceTypes: ["<ResourceType>"] }`.
 *
 * The generator is deterministic — running it twice on the same manifests
 * yields the same schema (object key order is preserved via plain
 * `Record` literals; downstream consumers that hash the JSON should
 * stringify with stable ordering themselves if they care).
 */

// Subset of the manifest shape the generator depends on. Mirrors
// `adapters/node/src/control-plane-registry.ts`'s reads — keep in
// sync if the manifest gains required fields the generator should pull in.
export interface ManifestAction {
  actionId: string;
  resourceType: string;
}

export interface ManifestResource {
  resourceType: string;
}

export interface ModuleManifest {
  moduleId?: string;
  actions?: ManifestAction[];
  resources?: ManifestResource[];
}

/**
 * Re-declared from cedar-wasm's `.d.ts` to avoid pulling the WASM artefact
 * into the schema-generator typecheck path. Shape MUST match cedar-wasm's
 * `SchemaJson<string>`.
 */
export type CedarSchemaJson = Record<string, NamespaceDefinition>;

export interface NamespaceDefinition {
  entityTypes: Record<string, EntityType>;
  actions: Record<string, ActionType>;
  commonTypes?: Record<string, unknown>;
}

export interface EntityType {
  memberOfTypes?: string[];
  shape?: TypeRef;
}

export interface ActionType {
  appliesTo?: ApplySpec;
}

export interface ApplySpec {
  principalTypes: string[];
  resourceTypes: string[];
  context?: TypeRef;
}

export type TypeRef =
  | { type: 'String' }
  | { type: 'Long' }
  | { type: 'Boolean' }
  | { type: 'Set'; element: TypeRef }
  | { type: 'Record'; attributes: Record<string, TypeRefAttr>; additionalAttributes?: boolean }
  | { type: 'Entity'; name: string };

export type TypeRefAttr = TypeRef & { required?: boolean };

/**
 * The namespace this generator emits into.
 *
 * Atlas's policies today use unqualified entity / action references
 * (`Action::"Catalog.Family.Read"`, `resource is Family`). Cedar's
 * validator only matches those against the EMPTY namespace (the
 * top-level namespace) — anything under a named namespace would require
 * policies to be qualified (`Atlas::Action::"..."`). To keep policies
 * un-namespaced (matching how the existing fixtures + `entity-store.ts`
 * encode them), we emit into the empty namespace key.
 *
 * If/when policies become namespaced (admin UI v2), this constant flips
 * to `'Atlas'` and policies grow `Atlas::` prefixes; the entity-store
 * builder learns to qualify action ids the same way.
 */
export const ATLAS_NAMESPACE = '';

/** Stable principal entity type — matches `entity-store.ts`'s default. */
export const USER_ENTITY_TYPE = 'User';

/**
 * Generate a Cedar Schema from one or more module manifests.
 *
 * Pure: no IO, no time, no randomness. Identical input → identical output.
 *
 * Conflict semantics: if two manifests declare the same `resourceType`
 * or the same `actionId` they are merged silently — Atlas does not allow
 * duplicate registrations at the manifest layer, so this should never
 * happen at runtime. If it does, last-write-wins (the second manifest
 * overwrites the first). Bumping this to a hard error is a one-line
 * change if a duplicate ever sneaks in.
 */
export function generateCedarSchema(manifests: ModuleManifest[]): CedarSchemaJson {
  const entityTypes: Record<string, EntityType> = {
    [USER_ENTITY_TYPE]: userEntityType(),
  };
  const actions: Record<string, ActionType> = {};

  // Track every resource type referenced by an action so we can emit a
  // matching entity type even if the manifest forgot to list it under
  // `resources`. Defensive — Atlas's manifests do declare resources, but
  // this lets the generator produce a *valid* schema for partial
  // manifests in tests.
  const referencedResources = new Set<string>();

  for (const manifest of manifests) {
    for (const r of manifest.resources ?? []) {
      // Empty resource type would emit `entityTypes['']`, which Cedar
      // rejects. Manifest validation upstream should catch this; the
      // skip here is defensive so a malformed manifest doesn't poison
      // the schema with an unparseable entry.
      if (r.resourceType.trim().length === 0) continue;
      entityTypes[r.resourceType] = resourceEntityType();
    }
    for (const a of manifest.actions ?? []) {
      // Same defensive skip for action declarations.
      if (a.actionId.trim().length === 0) continue;
      if (a.resourceType.trim().length === 0) continue;
      referencedResources.add(a.resourceType);
      actions[a.actionId] = {
        appliesTo: {
          principalTypes: [USER_ENTITY_TYPE],
          resourceTypes: [a.resourceType],
        },
      };
    }
  }

  for (const rt of referencedResources) {
    if (!(rt in entityTypes)) {
      entityTypes[rt] = resourceEntityType();
    }
  }

  return {
    [ATLAS_NAMESPACE]: {
      entityTypes,
      actions,
    },
  };
}

/**
 * The User entity is intentionally shape-less in this chunk.
 *
 * Cedar's strict validator REJECTS `additionalAttributes: true` outside
 * the experimental `partial-validate` feature, and our policies legitimately
 * reach for arbitrary attributes (`principal.role`, `principal.department`,
 * `resource.protected`, ...) that no module manifest declares today. Until
 * the manifest grows a structured attribute schema (Chunk 6c+1 — the
 * authoring UI's autocomplete needs this anyway), we omit `shape` so the
 * validator only checks action/entity-type conformance, not attribute
 * presence/typing.
 *
 * `tenantId` etc. still flow through the request envelope — Cedar simply
 * doesn't typecheck the attribute access. That's a known gap; the
 * deny-overrides-allow guarantee survives because Cedar still evaluates
 * the policy at request time against real attributes.
 */
function userEntityType(): EntityType {
  return {};
}

/**
 * Resource entity types share the same shape-less form — see
 * `userEntityType` for the rationale. Future closure (per-resource-type
 * declared attributes) is gated on module manifests that don't exist yet.
 */
function resourceEntityType(): EntityType {
  return {};
}

/**
 * Convenience: fully-qualified Cedar entity reference name for a type
 * within the Atlas namespace. Today the namespace is empty, so the
 * unqualified name IS the qualified name; the helper exists so callers
 * don't have to know that.
 */
export function qualifyType(unqualified: string): string {
  return ATLAS_NAMESPACE.length === 0 ? unqualified : `${ATLAS_NAMESPACE}::${unqualified}`;
}
