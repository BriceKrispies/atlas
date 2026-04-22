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
    'Left rail, main content, right rail. Each region is a single slot.',
  regions: [
    { name: 'left', required: false },
    { name: 'main', required: false },
    { name: 'right', required: false },
  ],
};

export { ThreeColumnTemplate as element } from './template.element.js';
