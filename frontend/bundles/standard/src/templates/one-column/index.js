/**
 * template.one-column — public template entry.
 *
 * Importing this module registers the <template-one-column> custom
 * element (see template.element.js) as a side effect.
 */

export const manifest = {
  templateId: 'template.one-column',
  version: '0.1.0',
  displayName: 'One Column',
  description: 'Single stacked region. Simplest layout.',
  regions: [
    { name: 'main', required: true },
  ],
};

export { OneColumnTemplate as element } from './template.element.js';
