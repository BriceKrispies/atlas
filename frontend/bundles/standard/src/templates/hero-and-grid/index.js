/**
 * template.hero-and-grid — public template entry.
 */

export const manifest = {
  templateId: 'template.hero-and-grid',
  version: '0.1.0',
  displayName: 'Hero + Grid',
  description:
    'A single hero widget at the top, followed by a grid region below. Each region is a single slot.',
  regions: [
    { name: 'hero', required: false },
    { name: 'grid', required: false },
  ],
};

export { HeroAndGridTemplate as element } from './template.element.js';
