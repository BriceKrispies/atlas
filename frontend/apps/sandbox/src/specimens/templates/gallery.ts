import { S } from '../_register.ts';
import { mountContentPage, type SeedPageDoc } from '../_shared.ts';
import { gallerySeedPages } from '@atlas/bundle-standard/seed-pages';

// ── Layout Gallery ──────────────────────────────────────────────
//
// Each gallery specimen mounts the same announcements widget set into a
// different page template so layouts can be compared side-by-side. The
// seed docs live in @atlas/bundle-standard/seed-pages and are saved into
// the shared sandboxPageStore above. Both View and Edit variants are
// wired so the drag/drop palette can be exercised against each template.

for (const doc of gallerySeedPages as SeedPageDoc[]) {
  const shortName =
    doc.meta?.title?.replace(/^Gallery\s*—\s*/i, '') ?? doc.templateId ?? doc.pageId;
  S({
    id: `gallery.${doc.pageId}`,
    name: shortName,
    tag: 'content-page',
    mount: mountContentPage,
    configVariants: [
      { name: 'View', config: { pageId: doc.pageId, edit: false } },
      { name: 'Edit', config: { pageId: doc.pageId, edit: true } },
    ],
  });
}
