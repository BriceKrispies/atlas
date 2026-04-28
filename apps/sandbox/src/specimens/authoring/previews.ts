import { S } from '../_register.ts';

// ── Authoring previews ──────────────────────────────────────────
//
// Static visual smoke checks for the editor host elements. These do
// NOT mount the full authoring routes — for interactive editing, run
// the authoring app (`pnpm authoring`). These specimens exist so the
// sandbox still surfaces the editor primitives in its catalog.

S({
  id: 'authoring-previews.layout-editor',
  name: 'Layout editor (host)',
  tag: 'atlas-layout-editor',
  variants: [
    {
      name: 'Default',
      html: '<atlas-layout-editor></atlas-layout-editor>',
    },
  ],
});

S({
  id: 'authoring-previews.block-editor',
  name: 'Block editor (host)',
  tag: 'atlas-block-editor',
  variants: [
    {
      name: 'Default',
      html: '<atlas-block-editor></atlas-block-editor>',
    },
  ],
});
