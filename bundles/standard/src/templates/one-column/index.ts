/**
 * template.one-column — public template entry.
 *
 * Importing this module registers the <template-one-column> custom
 * element (see template.element.ts) as a side effect.
 */

import type { TemplateManifest } from '@atlas/page-templates';

export const manifest: TemplateManifest = {
  templateId: 'template.one-column',
  version: '0.1.0',
  displayName: 'One Column',
  description: 'Single stacked region. Simplest layout.',
  regions: [
    { name: 'main', required: false },
  ],
};

export { OneColumnTemplate as element } from './template.element.ts';
