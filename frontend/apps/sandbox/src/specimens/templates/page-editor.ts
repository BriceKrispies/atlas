import { S } from '../_register.ts';
import {
  sandboxCapabilities,
  sandboxLayoutRegistry,
} from '../_shared.ts';
import {
  InMemoryPageStore,
  ValidatingPageStore,
} from '@atlas/page-templates';
import { createMountPageEditor, editorSeedPages } from '../../page-editor/index.ts';

// ── Page Editor ─────────────────────────────────────────────────
//
// <sandbox-page-editor> specimens. A dedicated PageStore keeps editor
// edits isolated from the Pages / Layout Gallery groups so each group
// starts from a known baseline. Phase A mounts the shell in its full
// chrome (toolbar, palette, canvas, inspector, preview-toggle) with
// stubbed toolbar handlers; later phases wire real behaviour behind the
// same surface.

const sandboxPageEditorStore = new ValidatingPageStore(new InMemoryPageStore());
for (const doc of editorSeedPages) {
  void sandboxPageEditorStore.save(doc.pageId, doc);
}

const mountPageEditor = createMountPageEditor({
  pageStore: sandboxPageEditorStore,
  layoutRegistry: sandboxLayoutRegistry,
  tenantId: 'acme',
  capabilities: sandboxCapabilities,
  principal: { id: 'u_sandbox', roles: [] },
});

for (const doc of editorSeedPages) {
  const meta = doc['meta'] as { title?: string } | undefined;
  S({
    id: `page-editor.${doc.pageId}`,
    name: meta?.title ?? doc.pageId,
    tag: 'sandbox-page-editor',
    mount: mountPageEditor,
    configVariants: [
      { name: 'Edit', config: { pageId: doc.pageId } },
    ],
  });
}
