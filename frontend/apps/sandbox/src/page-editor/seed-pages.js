/**
 * Seed page documents for the Page Editor specimens.
 *
 * Two starters are shipped:
 *   editor-starter — a lightly populated dashboard showing the editor
 *                    works against existing widgets end-to-end.
 *   editor-blank   — a page with empty regions so the drop-zone empty
 *                    state is the hero; good for exercising the palette.
 *
 * Both documents use `template.two-column`, which is registered by
 * `@atlas/bundle-standard/templates` at app boot. When we have more
 * templates registered and wired to the switcher (Phase G), we can add
 * starters that use them.
 */

export const editorStarterPage = {
  pageId: 'editor-starter',
  tenantId: 'acme',
  templateId: 'template.two-column',
  templateVersion: '0.1.0',
  regions: {
    main: [
      {
        widgetId: 'sandbox.heading',
        instanceId: 'w-editor-starter-main-heading',
        config: { level: 2, text: 'Atlas page editor' },
      },
      {
        widgetId: 'sandbox.text',
        instanceId: 'w-editor-starter-main-text',
        config: {
          variant: 'body',
          content:
            'Drag widgets from the palette. Click a widget to edit its properties. Press cmd/ctrl+Z to undo.',
        },
      },
      {
        widgetId: 'sandbox.kpi-tile',
        instanceId: 'w-editor-starter-main-kpi',
        config: {
          label: 'Active tenants',
          value: '42',
          unit: '',
          trend: 'up',
          trendLabel: '+3 this week',
          sparklineValues: '10,12,11,14,18,22,24,28,34,38,42',
        },
      },
    ],
    sidebar: [
      {
        widgetId: 'sandbox.sparkline',
        instanceId: 'w-editor-starter-sidebar-spark',
        config: {
          values: '1,3,2,5,4,6,8,7,9,11,10',
          label: 'Signups (last 11 days)',
          showLastPoint: true,
        },
      },
    ],
  },
  status: 'draft',
  meta: {
    title: 'Editor starter',
    slug: '/editor-starter',
  },
};

export const editorBlankPage = {
  pageId: 'editor-blank',
  tenantId: 'acme',
  templateId: 'template.two-column',
  templateVersion: '0.1.0',
  regions: {
    main: [],
    sidebar: [],
  },
  status: 'draft',
  meta: {
    title: 'Blank page',
    slug: '/editor-blank',
  },
};

export const editorSeedPages = [editorStarterPage, editorBlankPage];
