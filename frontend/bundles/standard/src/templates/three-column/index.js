/**
 * template.three-column — public template entry.
 *
 * Importing this module registers the <template-three-column> custom
 * element (see template.element.js) as a side effect.
 */

export const manifest = {
  templateId: 'template.three-column',
  version: '0.1.0',
  displayName: 'Three Column',
  description:
    'Left rail, main content, right rail. Both rails are optional and capped at 4 widgets.',
  regions: [
    { name: 'left', required: false, maxWidgets: 4 },
    { name: 'main', required: true },
    { name: 'right', required: false, maxWidgets: 4 },
  ],
};

export { ThreeColumnTemplate as element } from './template.element.js';
