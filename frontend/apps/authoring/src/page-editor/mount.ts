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

import './page-editor-shell.ts';

import type { PageStore } from '@atlas/page-templates';

export interface MountPageEditorCtx {
  pageStore: PageStore;
  layoutRegistry?: unknown;
  templateRegistry?: unknown;
  tenantId?: string;
  capabilities?: Record<string, (args: unknown) => Promise<unknown>>;
  principal?: { id: string; roles: string[] } | null;
}

export type MountPageEditorFn = (
  demoEl: HTMLElement,
  ctx: {
    config: { pageId?: string } | Record<string, unknown>;
    onLog: (kind: string, payload: unknown) => void;
  },
) => () => void;

export function createMountPageEditor(ctx: MountPageEditorCtx): MountPageEditorFn {
  const {
    pageStore,
    layoutRegistry,
    templateRegistry,
    tenantId,
    capabilities,
    principal,
  } = ctx;

  return function mountPageEditor(demoEl, { config, onLog }): () => void {
    const { pageId } = (config ?? {}) as { pageId?: string };
    const shell = document.createElement('sandbox-page-editor') as HTMLElement &
      Record<string, unknown>;
    shell['pageId'] = pageId;
    shell['pageStore'] = pageStore;
    shell['layoutRegistry'] = layoutRegistry;
    shell['templateRegistry'] = templateRegistry;
    shell['principal'] = principal ?? { id: 'u_sandbox', roles: [] };
    shell['tenantId'] = tenantId ?? 'acme';
    shell['correlationId'] = `cid-editor-${pageId ?? ''}-${Date.now()}`;
    shell['capabilities'] = capabilities ?? {};
    shell['onLog'] = onLog ?? (() => {});
    demoEl.appendChild(shell);
    onLog?.('editor-spec-mount', { pageId });
    return () => {
      try { shell.remove(); } catch { /* already detached */ }
    };
  };
}
