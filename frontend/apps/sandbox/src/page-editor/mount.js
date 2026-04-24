/**
 * mountPageEditor — sandbox specimen mount helper for <sandbox-page-editor>.
 *
 * Matches the `spec.mount` contract used by sandbox-app.js:
 *   (demoEl, { config, onLog }) => cleanupFn
 *
 * Config shape:
 *   { pageId }                 — required; must resolve in the supplied pageStore
 *
 * Bound context (captured via a closure factory so the store + registries
 * can be shared across all editor specimens while staying isolated from
 * the Pages / Layout Gallery groups):
 *   { pageStore, layoutRegistry, templateRegistry, tenantId, capabilities,
 *     principal }
 *
 * Returns a cleanup that detaches the shell.
 */

import './page-editor-shell.js';

export function createMountPageEditor(ctx) {
  const {
    pageStore,
    layoutRegistry,
    templateRegistry,
    tenantId,
    capabilities,
    principal,
  } = ctx;

  return function mountPageEditor(demoEl, { config, onLog }) {
    const { pageId } = config ?? {};
    const shell = document.createElement('sandbox-page-editor');
    shell.pageId = pageId;
    shell.pageStore = pageStore;
    shell.layoutRegistry = layoutRegistry;
    shell.templateRegistry = templateRegistry;
    shell.principal = principal ?? { id: 'u_sandbox', roles: [] };
    shell.tenantId = tenantId ?? 'acme';
    shell.correlationId = `cid-editor-${pageId}-${Date.now()}`;
    shell.capabilities = capabilities ?? {};
    shell.onLog = onLog ?? (() => {});
    demoEl.appendChild(shell);
    onLog?.('editor-spec-mount', { pageId });
    return () => {
      try { shell.remove(); } catch { /* already detached */ }
    };
  };
}
