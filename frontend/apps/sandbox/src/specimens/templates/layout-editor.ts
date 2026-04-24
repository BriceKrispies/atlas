import { S } from '../_register.ts';
import { sandboxLayoutRegistry, sandboxLayoutStore } from '../_shared.ts';
import {
  presetLayouts,
  emptyLayoutDocument,
  type LayoutDocument,
} from '@atlas/page-templates';

// ── Layout Editor ───────────────────────────────────────────────
//
// Live editor specimens. Each mounts <atlas-layout-editor> seeded either
// with a preset (so you can tweak one) or with a blank canvas. Saves go
// through the sandboxLayoutStore and are immediately observable by other
// specimens that read from it.

function mountLayoutEditor(
  demoEl: HTMLElement,
  ctx: { config: Record<string, unknown>; onLog: (kind: string, payload: unknown) => void },
): () => void {
  const { config, onLog } = ctx;
  const seedId = (config as { layoutId?: string }).layoutId ?? null;
  const seedDoc = seedId
    ? null
    : emptyLayoutDocument({
        layoutId: `sandbox.${Date.now().toString(36)}`,
        displayName: 'Untitled layout',
      });

  const editor = document.createElement('atlas-layout-editor') as HTMLElement & {
    layout: unknown;
    onChange: (doc: LayoutDocument) => void;
    onSave: (doc: LayoutDocument) => Promise<void>;
  };
  editor.onChange = (doc: LayoutDocument) => onLog('layout-editor.change', {
    layoutId: doc.layoutId,
    slotCount: doc.slots.length,
  });
  editor.onSave = async (doc: LayoutDocument) => {
    await sandboxLayoutStore.save(doc.layoutId, doc);
    // Mirror saved layouts into the registry so preview / content-page
    // specimens pick them up without extra plumbing.
    try {
      sandboxLayoutRegistry.register(doc);
    } catch {
      /* duplicate name with different shape — registry throws; ignore */
    }
    onLog('layout-editor.save', { layoutId: doc.layoutId });
  };

  void (async () => {
    if (seedId) {
      const stored = await sandboxLayoutStore.get(seedId);
      editor.layout = stored ?? sandboxLayoutRegistry.get(seedId);
    } else {
      editor.layout = seedDoc;
    }
  })();

  demoEl.appendChild(editor);
  return () => {
    try { editor.remove(); } catch { /* already detached */ }
  };
}

S({
  id: 'layout-editor.blank',
  name: 'Blank canvas',
  tag: 'atlas-layout-editor',
  mount: mountLayoutEditor,
  configVariants: [{ name: 'New layout', config: {} }],
});

for (const layout of presetLayouts as LayoutDocument[]) {
  S({
    id: `layout-editor.${layout.layoutId}`,
    name: layout.displayName ?? layout.layoutId,
    tag: 'atlas-layout-editor',
    mount: mountLayoutEditor,
    configVariants: [
      { name: 'Edit preset', config: { layoutId: layout.layoutId } },
    ],
  });
}
