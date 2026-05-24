/**
 * Role-pack Cedar generator tests.
 *
 * The generator is a pure function over `ActionDeclaration[]` — no I/O,
 * no DB. We assert verb classification, action-set ordering (stable so
 * the bundle hash is reproducible), and the structural shape of the
 * emitted Cedar text.
 */
import { describe, it, expect } from '@atlas/test';
import type { ActionDeclaration } from '@atlas/platform-core';
import { moduleManifests } from '@atlas/schemas';
import { buildRolePacksCedar, buildRolePackBundle } from '../src/index.ts';
const ACTIONS: ActionDeclaration[] = [
    { actionId: 'ContentPages.Page.Create', resourceType: 'Page', verb: 'create', auditLevel: 'INFO' },
    { actionId: 'ContentPages.Page.Update', resourceType: 'Page', verb: 'update', auditLevel: 'INFO' },
    { actionId: 'ContentPages.Page.Delete', resourceType: 'Page', verb: 'delete', auditLevel: 'INFO' },
    { actionId: 'ContentPages.Page.Search', resourceType: 'Page', verb: 'search', auditLevel: 'INFO' },
    { actionId: 'Catalog.Family.Publish', resourceType: 'Family', verb: 'publish', auditLevel: 'INFO' },
    { actionId: 'Catalog.Family.Get', resourceType: 'Family', verb: 'get', auditLevel: 'INFO' },
    { actionId: 'Analytics.Query', resourceType: 'AnalyticsDashboard', verb: 'query', auditLevel: 'INFO' },
];
describe('buildRolePacksCedar', function () {
    it('emits four role permits', function () {
        const cedar = buildRolePacksCedar(ACTIONS);
        expect(cedar).toContain('@id("role-tenant-admin")');
        expect(cedar).toContain('@id("role-author-write")');
        expect(cedar).toContain('@id("role-author-read")');
        expect(cedar).toContain('@id("role-viewer")');
        expect(cedar).toContain('@id("role-service-principal")');
    });
    it('classifies write verbs into the write bucket', function () {
        const cedar = buildRolePacksCedar(ACTIONS);
        // write actions sorted alphabetically
        const writeBlock = cedar.split('@id("role-author-write")')[1]?.split('@id("role-author-read")')[0] ?? '';
        expect(writeBlock).toContain('Action::"Catalog.Family.Publish"');
        expect(writeBlock).toContain('Action::"ContentPages.Page.Create"');
        expect(writeBlock).toContain('Action::"ContentPages.Page.Delete"');
        expect(writeBlock).toContain('Action::"ContentPages.Page.Update"');
        // Reads are not in the write block
        expect(writeBlock).not.toContain('Action::"Analytics.Query"');
        expect(writeBlock).not.toContain('Action::"Catalog.Family.Get"');
    });
    it('classifies read verbs into the read bucket and grants Viewer ONLY reads', function () {
        const cedar = buildRolePacksCedar(ACTIONS);
        const viewerBlock = cedar.split('@id("role-viewer")')[1]?.split('@id("role-service-principal")')[0] ?? '';
        expect(viewerBlock).toContain('Action::"Analytics.Query"');
        expect(viewerBlock).toContain('Action::"Catalog.Family.Get"');
        expect(viewerBlock).toContain('Action::"ContentPages.Page.Search"');
        expect(viewerBlock).not.toContain('Action::"ContentPages.Page.Create"');
        expect(viewerBlock).not.toContain('Action::"Catalog.Family.Publish"');
    });
    it('TenantAdmin gets every action', function () {
        const cedar = buildRolePacksCedar(ACTIONS);
        const adminBlock = cedar.split('@id("role-tenant-admin")')[1]?.split('@id("role-author-write")')[0] ?? '';
        for (const a of ACTIONS) {
            expect(adminBlock).toContain(`Action::"${a.actionId}"`);
        }
    });
    it('ServicePrincipal ships with an empty action set', function () {
        const cedar = buildRolePacksCedar(ACTIONS);
        const spBlock = cedar.split('@id("role-service-principal")')[1] ?? '';
        expect(spBlock).toContain('action in [],');
    });
    it('is deterministic — running twice on the same input yields identical text', function () {
        const a = buildRolePacksCedar(ACTIONS);
        const b = buildRolePacksCedar(ACTIONS);
        expect(a).toBe(b);
    });
    it('order-independent — actions get sorted before emission', function () {
        const reversed = [...ACTIONS].reverse();
        expect(buildRolePacksCedar(ACTIONS)).toBe(buildRolePacksCedar(reversed));
    });
    it('handles an empty manifest set with empty action lists everywhere', function () {
        const cedar = buildRolePacksCedar([]);
        // Every role's action set is `[]`. The permits are still emitted —
        // they just match nothing — so adding actions later doesn't require
        // re-issuing the bundle wrapper.
        expect(cedar).toContain('@id("role-tenant-admin")');
        expect((cedar.match(/action in \[\]/g) ?? []).length).toBeGreaterThanOrEqual(4);
    });
    it('treats unknown verbs as reads (defensive)', function () {
        const odd: ActionDeclaration[] = [
            { actionId: 'Module.Mystery', resourceType: 'X', verb: 'mystery', auditLevel: 'INFO' },
        ];
        const cedar = buildRolePacksCedar(odd);
        const writeBlock = cedar.split('@id("role-author-write")')[1]?.split('@id("role-author-read")')[0] ?? '';
        const readBlock = cedar.split('@id("role-author-read")')[1]?.split('@id("role-viewer")')[0] ?? '';
        expect(writeBlock).not.toContain('Action::"Module.Mystery"');
        expect(readBlock).toContain('Action::"Module.Mystery"');
    });
});
// ----------------------------------------------------------------------
// SDET — end-to-end runtime-grant witness for the DSL read surface.
//
// `tickets/dsl/cedar-policy-actions.md` claims the live permit for the new
// `Dsl.Expression.{Read,List,Validate}` actions comes NOT from the .cedar
// fixture but from this generator auto-classifying the manifest verbs into
// the read bucket. The route tests prove the GATE exists; they DON'T prove a
// real admin gets a permit at runtime — they inject a stub policy engine.
//
// This is the missing link: drive the ACTUAL bundled DSL manifest through the
// ACTUAL classifier (the same path `adapters/node/src/migrations/seed.ts`
// runs via `moduleManifests()` → `collectManifestActions` →
// `buildRolePacksCedar`). If a future verb-classification change, a manifest
// edit (e.g. flipping `read`→`activate`), or a missing manifest registration
// would 403 admin at runtime, THIS fails — instead of silently shipping a
// dead read surface behind green route tests.
// ----------------------------------------------------------------------
describe('DSL read surface — runtime grant via real manifest classification', function () {
    // Mirror seed.ts's collectManifestActions shape coercion.
    function collectActions(): ActionDeclaration[] {
        const out: ActionDeclaration[] = [];
        for (const m of moduleManifests()) {
            const actions = (m as { actions?: unknown }).actions;
            if (!Array.isArray(actions)) continue;
            for (const a of actions) {
                const aid = (a as { actionId?: unknown }).actionId;
                const rt = (a as { resourceType?: unknown }).resourceType;
                const verb = (a as { verb?: unknown }).verb;
                if (typeof aid !== 'string' || typeof rt !== 'string') continue;
                out.push({
                    actionId: aid,
                    resourceType: rt,
                    verb: typeof verb === 'string' ? verb : '',
                    auditLevel: 'INFO',
                });
            }
        }
        return out;
    }

    const DSL_READ_ACTIONS = [
        'Dsl.Expression.Read',
        'Dsl.Expression.List',
        'Dsl.Expression.Validate',
    ];

    it('the bundled manifest set actually contains the three DSL read actions', function () {
        const ids = collectActions().map((a) => a.actionId);
        for (const id of DSL_READ_ACTIONS) {
            expect(ids).toContain(id);
        }
    });

    it('TenantAdmin is granted all three DSL read actions at runtime', function () {
        const cedar = buildRolePacksCedar(collectActions());
        const adminBlock =
            cedar.split('@id("role-tenant-admin")')[1]?.split('@id("role-author-write")')[0] ?? '';
        for (const id of DSL_READ_ACTIONS) {
            expect(adminBlock).toContain(`Action::"${id}"`);
        }
    });

    it('the three DSL read actions land in the READ bucket (Viewer + Author-read), NOT the write bucket', function () {
        const cedar = buildRolePacksCedar(collectActions());
        const writeBlock =
            cedar.split('@id("role-author-write")')[1]?.split('@id("role-author-read")')[0] ?? '';
        const viewerBlock =
            cedar.split('@id("role-viewer")')[1]?.split('@id("role-service-principal")')[0] ?? '';
        for (const id of DSL_READ_ACTIONS) {
            // If a manifest verb edit pushed these into WRITE_VERBS, Viewer
            // (read-only) would lose the read surface — caught here.
            expect(viewerBlock).toContain(`Action::"${id}"`);
            expect(writeBlock).not.toContain(`Action::"${id}"`);
        }
    });

    it('Dsl.Expression.Update (verb=update) stays in the WRITE bucket — Viewer must NOT get it', function () {
        const cedar = buildRolePacksCedar(collectActions());
        const writeBlock =
            cedar.split('@id("role-author-write")')[1]?.split('@id("role-author-read")')[0] ?? '';
        const viewerBlock =
            cedar.split('@id("role-viewer")')[1]?.split('@id("role-service-principal")')[0] ?? '';
        expect(writeBlock).toContain('Action::"Dsl.Expression.Update"');
        expect(viewerBlock).not.toContain('Action::"Dsl.Expression.Update"');
    });
});

describe('buildRolePackBundle', function () {
    it('wraps the cedar text in the policy_json wrapper shape', function () {
        const bundle = buildRolePackBundle(ACTIONS);
        expect(bundle.format).toBe('cedar-text');
        expect(bundle.schemaVersion).toBe(1);
        expect(bundle.policies).toContain('@id("role-tenant-admin")');
        expect(bundle.description).toBeTruthy();
    });
});
