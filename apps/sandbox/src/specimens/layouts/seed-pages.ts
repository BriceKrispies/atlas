import { S } from '../_register.ts';
import { mountContentPage, type SeedPageDoc } from '../_shared.ts';
import { seedPages } from '@atlas/bundle-standard/seed-pages';

// ── Pages ───────────────────────────────────────────────────────
//
// Content-page specimens mount real <content-page> elements backed by a
// session-shared InMemoryPageStore. The store is seeded once with the
// three bundle seed pages at module load — edits made in edit-mode
// specimens persist across specimen switches (but reset on page reload).
//
// Each page gets two config variants: View (read-only) and Edit (with
// the widget palette + drag/drop). Switching between them re-mounts the
// <content-page>, which re-reads from the store, so edits flush through
// immediately on a re-render.

for (const doc of seedPages as SeedPageDoc[]) {
  S({
    id: `page.${doc.pageId}`,
    name: doc.meta?.title ?? doc.pageId,
    tag: 'content-page',
    mount: mountContentPage,
    configVariants: [
      { name: 'View', config: { pageId: doc.pageId, edit: false } },
      { name: 'Edit', config: { pageId: doc.pageId, edit: true } },
    ],
  });
}
