/**
 * template.header-main-footer — public template entry.
 */

export const manifest = {
  templateId: 'template.header-main-footer',
  version: '0.1.0',
  displayName: 'Header / Main / Footer',
  description:
    'Full-width header band, a main region, and a full-width footer band. Header and footer are optional.',
  regions: [
    { name: 'header', required: false, maxWidgets: 3 },
    { name: 'main', required: true },
    { name: 'footer', required: false, maxWidgets: 3 },
  ],
};

export { HeaderMainFooterTemplate as element } from './template.element.js';
