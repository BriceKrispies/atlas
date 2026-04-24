/**
 * template.two-column — public template entry.
 *
 * Importing this module registers the <template-two-column> custom
 * element (see template.element.ts) as a side effect.
 */

import type { TemplateManifest } from '@atlas/page-templates';

export const manifest: TemplateManifest = {
  templateId: 'template.two-column',
  version: '0.1.0',
  displayName: 'Two Column',
  description:
    'Primary main region with a sidebar beside it. Each region is a single slot.',
  regions: [
    { name: 'main', required: false },
    { name: 'sidebar', required: false },
  ],
};

export { TwoColumnTemplate as element } from './template.element.ts';
