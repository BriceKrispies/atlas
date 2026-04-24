import { S } from '../_register.ts';

// ── Block editor ────────────────────────────────────────────────

const BLOCK_SEED_DOC = {
  blocks: [
    { blockId: 'seed-heading', type: 'heading', content: 'Welcome to the block editor' },
    { blockId: 'seed-text',    type: 'text',    content: 'Select a block and use the toolbar.' },
    { blockId: 'seed-list',    type: 'list',    content: ['Insert blocks', 'Move up/down', 'Apply B / I'] },
  ],
};

interface BlockEditorMountConfig {
  editorId?: string;
  document?: unknown;
}

function mountBlockEditor(
  demo: HTMLElement,
  ctx: { config: Record<string, unknown> },
): () => void {
  const config = ctx.config as unknown as BlockEditorMountConfig;
  const editor = document.createElement('atlas-block-editor') as HTMLElement & {
    document: unknown;
  };
  editor.setAttribute('editor-id', config.editorId ?? 'demo');
  editor.document = config.document ?? BLOCK_SEED_DOC;
  demo.appendChild(editor);
  return () => { editor.remove(); };
}

S({
  id: 'page-templates.block-editor',
  name: 'Block editor',
  tag: 'atlas-block-editor',
  mount: mountBlockEditor,
  configVariants: [
    { name: 'Seeded', config: { editorId: 'demo', document: BLOCK_SEED_DOC } },
    { name: 'Empty',  config: { editorId: 'empty', document: { blocks: [] } } },
  ],
});
