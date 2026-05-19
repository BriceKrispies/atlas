/**
 * Platform-default role packs.
 *
 * Atlas ships four canonical role names that Phase A1's `Membership.roles`
 * resolves into Cedar permits:
 *
 *   - `TenantAdmin`     — full access within the tenant scope
 *   - `Author`          — content/catalog write + every read
 *   - `Viewer`          — read-only across every domain
 *   - `ServicePrincipal`— ships empty; tenants extend per-API-key scope
 *
 * The Cedar text is *generated from the bundled module manifests* rather
 * than hardcoded — verb classification (write vs read) maps every action
 * onto a role's allow-list. This lets a new module add actions without
 * touching the role packs; the manifest's `verb` field is the contract.
 *
 * Tenants can OVERRIDE by activating their own bundle. Cedar's
 * deny-overrides-allow gives them a clean way to subtract permissions
 * (Invariant I4).
 *
 * The seed runner installs these as `version=1, status='active'` for
 * every tenant on creation. Re-runs are idempotent via the seed's
 * "highest version wins + don't downgrade" semantics.
 */
import type { ActionDeclaration } from '@atlas/platform-core';
/**
 * Verbs treated as MUTATING. Anything not in this set is treated as a
 * read.
 */
const WRITE_VERBS = new Set<string>([
    'create',
    'update',
    'delete',
    'publish',
    'archive',
    'activate',
    'revoke',
    'set',
    'enable',
    'disable',
    'rotate',
    'invite',
    'accept',
    'reject',
    'apply',
    'seed',
]);
function isWriteVerb(verb: string | undefined): boolean {
    return verb !== undefined && WRITE_VERBS.has(verb.toLowerCase());
}
/**
 * Cedar action-set literal `[Action::"id", Action::"id", ...]`. Empty
 * sets are written as `[]` — Cedar evaluates `action in []` to false,
 * which means a permit gated on an empty set never fires (the role gets
 * no permissions). That's the right shape when there are no
 * write-shaped or read-shaped actions yet.
 */
function actionSetLiteral(ids: ReadonlyArray<string>): string {
    if (ids.length === 0)
        return '[]';
    return `[${ids.map(function (id) {
        return `Action::"${id}"`;
    }).join(', ')}]`;
}
/**
 * Classify every manifest action into write / read buckets and emit
 * the four-role Cedar policy bundle.
 */
export function buildRolePacksCedar(actions: ReadonlyArray<ActionDeclaration>): string {
    const writeActions: string[] = [];
    const readActions: string[] = [];
    for (const a of actions) {
        if (a.actionId.length === 0)
            continue;
        if (isWriteVerb(a.verb)) {
            writeActions.push(a.actionId);
        }
        else {
            readActions.push(a.actionId);
        }
    }
    // Stable order so the Cedar text is reproducible across seed runs
    // (the bundle hash matters for downstream cache invalidation).
    writeActions.sort();
    readActions.sort();
    const allActions = [...writeActions, ...readActions].sort();
    return [
        `// Atlas platform-default role packs (v1).`,
        `// Generated from module manifests; do not edit by hand.`,
        ``,
        `// TenantAdmin — full access within the tenant scope.`,
        `@id("role-tenant-admin")`,
        `permit (principal, action in ${actionSetLiteral(allActions)}, resource)`,
        `when {`,
        `  principal has roles && principal.roles.contains("TenantAdmin")`,
        `};`,
        ``,
        `// Author — every write + every read. Identity / Authz / admin-only`,
        `// surfaces are NOT in the action lists today; when they get manifest`,
        `// entries they fall into the write bucket and the next regen excludes`,
        `// them via a separate denylist (TODO: Phase A2 — split admin-only`,
        `// actions into a "tenantAdminOnly" annotation).`,
        `@id("role-author-write")`,
        `permit (principal, action in ${actionSetLiteral(writeActions)}, resource)`,
        `when {`,
        `  principal has roles && principal.roles.contains("Author")`,
        `};`,
        ``,
        `@id("role-author-read")`,
        `permit (principal, action in ${actionSetLiteral(readActions)}, resource)`,
        `when {`,
        `  principal has roles && principal.roles.contains("Author")`,
        `};`,
        ``,
        `// Viewer — read-only.`,
        `@id("role-viewer")`,
        `permit (principal, action in ${actionSetLiteral(readActions)}, resource)`,
        `when {`,
        `  principal has roles && principal.roles.contains("Viewer")`,
        `};`,
        ``,
        `// ServicePrincipal — ships with an empty action set. Tenants extend`,
        `// via their own bundle layered on top (Phase A2 wires the scope-`,
        `// constrained API-key path).`,
        `@id("role-service-principal")`,
        `permit (principal, action in [], resource)`,
        `when {`,
        `  principal has roles && principal.roles.contains("ServicePrincipal")`,
        `};`,
        ``,
    ].join('\n');
}
/**
 * Wrapper shape the bundle loader expects (see
 * `@atlas/adapter-policy-cedar/src/bundle-loader.ts`).
 */
export interface PolicyBundleWrapper {
    format: 'cedar-text';
    policies: string;
    schemaVersion: 1;
    description?: string;
}
export function buildRolePackBundle(actions: ReadonlyArray<ActionDeclaration>): PolicyBundleWrapper {
    return {
        format: 'cedar-text',
        policies: buildRolePacksCedar(actions),
        schemaVersion: 1,
        description: 'Atlas platform-default role packs',
    };
}
