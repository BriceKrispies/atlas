import '@atlas/design';
import '@atlas/widgets';
import { AtlasSurface } from '@atlas/core';
import { backend } from '@atlas/api-client';
import './shell/AdminShell.ts';
import './features/content/pages-list/PagesListPage.ts';
import './features/authz/policies-list/PoliciesListPage.ts';
import './features/authz/policy-editor/PolicyEditorPage.ts';
import './features/authz/policy-diff/PolicyDiffDialog.ts';
import './features/identity/users-surface.ts';
import './features/identity/invite-form-surface.ts';
import './features/identity/login-surface.ts';
import './features/identity/accept-invite-surface.ts';
import './features/identity/set-password-surface.ts';
// Wire the AtlasSurface ↔ backend bridge for tag-filtered SSE refetch
// (see worker.md phase 5). Surfaces declare `subscribesTo(): string[]`
// and the bound adapter opens a pooled `EventSource` keyed by the tag
// signature. Done at boot so it lands before any surface upgrades.
AtlasSurface.bindBackend({
    subscribeTags: function (tags, cb): (() => void) {
        return backend.subscribeTags(tags, cb);
    },
});
