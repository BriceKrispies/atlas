/**
 * template.header-main-footer — public template entry.
 */

import type { TemplateManifest } from '@atlas/page-templates';

export const manifest: TemplateManifest = {
  templateId: 'template.header-main-footer',
  version: '0.1.0',
  displayName: 'Header / Main / Footer',
  description:
    'Full-width header band, a main region, and a full-width footer band. Each region is a single slot.',
  regions: [
    { name: 'header', required: false },
    { name: 'main', required: false },
    { name: 'footer', required: false },
  ],
};

export { HeaderMainFooterTemplate as element } from './template.element.ts';
