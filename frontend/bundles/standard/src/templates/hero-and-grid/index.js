/**
 * template.hero-and-grid — public template entry.
 */

export const manifest = {
  templateId: 'template.hero-and-grid',
  version: '0.1.0',
  displayName: 'Hero + Grid',
  description:
    'A single hero widget at the top, followed by an auto-flowing two-up grid of content cards.',
  regions: [
    { name: 'hero', required: false, maxWidgets: 1 },
    { name: 'grid', required: true },
  ],
};

export { HeroAndGridTemplate as element } from './template.element.js';
