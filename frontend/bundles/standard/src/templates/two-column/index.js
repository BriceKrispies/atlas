/**
 * template.two-column — public template entry.
 *
 * Importing this module registers the <template-two-column> custom
 * element (see template.element.js) as a side effect.
 */

export const manifest = {
  templateId: 'template.two-column',
  version: '0.1.0',
  displayName: 'Two Column',
  description:
    'Primary main region with a sidebar beside it. Sidebar is optional and capped at 4 widgets.',
  regions: [
    { name: 'main', required: true },
    { name: 'sidebar', required: false, maxWidgets: 4 },
  ],
};

export { TwoColumnTemplate as element } from './template.element.js';
