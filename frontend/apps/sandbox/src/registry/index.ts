import type { Category, Status, TaxonomyEntry } from './types.ts';

export type { Category, Status, TaxonomyEntry } from './types.ts';
export { CATEGORIES } from './types.ts';

// Fixed-id taxonomy. Id = key. Source of truth for where each specimen
// lives in the two-tier (category / subcategory) nav. Tags feed the
// sidebar search. Status drives the Badge on the preview header.
const STATIC: Record<string, TaxonomyEntry> = {
  // Primitives — Layout
  'box':            { category: 'primitives', subcategory: 'Layout',     tags: ['layout', 'container'] },
  'stack':          { category: 'primitives', subcategory: 'Layout',     tags: ['layout', 'flex', 'row', 'column'] },
  'card':           { category: 'primitives', subcategory: 'Layout',     tags: ['surface', 'container', 'bordered'] },
  'divider':        { category: 'primitives', subcategory: 'Layout',     tags: ['rule', 'separator', 'hr'] },
  'grid':           { category: 'primitives', subcategory: 'Layout',     tags: ['grid', 'columns', 'auto-fit'] },
  'scroll-area':    { category: 'primitives', subcategory: 'Layout',     tags: ['scroll', 'overflow', 'region'] },

  // Primitives — Typography
  'heading':        { category: 'primitives', subcategory: 'Typography', tags: ['typography', 'h1', 'h2', 'h3', 'title'] },
  'text':           { category: 'primitives', subcategory: 'Typography', tags: ['typography', 'paragraph', 'body'] },
  'label':          { category: 'primitives', subcategory: 'Typography', tags: ['caption', 'eyebrow', 'uppercase'] },
  'code':           { category: 'primitives', subcategory: 'Typography', tags: ['mono', 'inline', 'block', 'snippet'] },
  'code-editor':    { category: 'primitives', subcategory: 'Typography', tags: ['monaco', 'editor', 'code', 'lazy'] },
  'kbd':            { category: 'primitives', subcategory: 'Typography', tags: ['keyboard', 'shortcut', 'pill'] },
  'link':           { category: 'primitives', subcategory: 'Typography', tags: ['anchor', 'href', 'navigation'] },
  'icon':           { category: 'primitives', subcategory: 'Typography', tags: ['svg', 'visual', 'glyph'] },

  // Primitives — Controls
  'button':         { category: 'primitives', subcategory: 'Controls',   tags: ['action', 'cta', 'submit'] },
  'input':          { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'text', 'field'] },
  'textarea':       { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'multiline', 'field'] },
  'number-input':   { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'number', 'field'] },
  'search-input':   { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'search', 'field'] },
  'select':         { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'dropdown', 'choice'] },
  'multi-select':   { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'dropdown', 'multi', 'tags'] },
  'checkbox':       { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'boolean', 'choice'] },
  'radio-group':    { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'choice', 'radio'] },
  'switch':         { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'toggle', 'boolean'] },
  'slider':         { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'range'] },
  'date-picker':    { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'date', 'calendar'] },
  'file-upload':    { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'upload', 'file'] },
  'form-field':     { category: 'primitives', subcategory: 'Controls',   tags: ['form', 'label', 'wrapper'] },

  // Primitives — Feedback
  'badge':          { category: 'primitives', subcategory: 'Feedback',   tags: ['status', 'chip', 'pill'] },
  'skeleton':       { category: 'primitives', subcategory: 'Feedback',   tags: ['loading', 'placeholder'] },
  'spinner':        { category: 'primitives', subcategory: 'Feedback',   tags: ['loading', 'busy', 'indicator'] },
  'alert':          { category: 'primitives', subcategory: 'Feedback',   tags: ['banner', 'notice', 'info', 'warning', 'danger'] },
  'empty-state':    { category: 'primitives', subcategory: 'Feedback',   tags: ['empty', 'placeholder', 'zero'] },

  // Primitives — Navigation
  'nav':               { category: 'primitives', subcategory: 'Navigation', tags: ['navigation', 'links', 'sidebar'] },
  'tabs':              { category: 'primitives', subcategory: 'Navigation', tags: ['tabs', 'views', 'underline'] },
  'segmented-control': { category: 'primitives', subcategory: 'Navigation', tags: ['segmented', 'picker', 'radiogroup', 'toggle'] },
  'accordion':         { category: 'primitives', subcategory: 'Navigation', tags: ['expand', 'collapse', 'disclosure', 'details'] },

  // Primitives — Overlays
  'tooltip':           { category: 'primitives', subcategory: 'Overlays',   tags: ['hover', 'popover', 'hint'] },
  'dialog':            { category: 'primitives', subcategory: 'Overlays',   tags: ['modal', 'confirm', 'alert'] },
  'drawer':            { category: 'primitives', subcategory: 'Overlays',   tags: ['sheet', 'side-panel', 'slide'] },
  'toast':             { category: 'primitives', subcategory: 'Overlays',   tags: ['notification', 'ephemeral', 'snackbar'] },
  'command-palette':   { category: 'primitives', subcategory: 'Overlays',   tags: ['cmdk', 'search', 'palette', 'jump'] },

  // Primitives — Mobile
  'bottom-sheet':      { category: 'primitives', subcategory: 'Mobile',     tags: ['mobile', 'sheet', 'modal', 'drag', 'snap'] },
  'action-sheet':      { category: 'primitives', subcategory: 'Mobile',     tags: ['mobile', 'sheet', 'menu', 'ios', 'destructive'] },
  'fab':               { category: 'primitives', subcategory: 'Mobile',     tags: ['mobile', 'floating', 'action', 'button', 'cta'] },

  // Primitives — Data
  'table':          { category: 'primitives', subcategory: 'Data',       tags: ['table', 'grid', 'rows'] },

  // Primitives — Agent
  'diff':              { category: 'primitives', subcategory: 'Agent',     tags: ['agent', 'diff', 'lcs', 'unified', 'split', 'review'] },
  'json-view':         { category: 'primitives', subcategory: 'Agent',     tags: ['agent', 'json', 'tree', 'inspect', 'debug'] },
  'activity':          { category: 'primitives', subcategory: 'Agent',     tags: ['agent', 'status', 'run', 'tool-call', 'streaming'] },
  'consent-banner':    { category: 'primitives', subcategory: 'Agent',     tags: ['agent', 'consent', 'approve', 'deny', 'permission'] },
  'capability-grid':   { category: 'primitives', subcategory: 'Agent',     tags: ['agent', 'capability', 'permission', 'grant', 'tile'] },
  'resource-picker':   { category: 'primitives', subcategory: 'Agent',     tags: ['agent', 'picker', 'resource', 'page', 'media', 'user'] },

  // Patterns — Page / Forms / Shell
  'page-header':    { category: 'patterns',   subcategory: 'Page',       tags: ['header', 'title', 'actions'] },
  'form-group':     { category: 'patterns',   subcategory: 'Forms',      tags: ['form', 'group', 'layout'] },
  'shell-header':   { category: 'patterns',   subcategory: 'Shell',      tags: ['header', 'topbar', 'chrome'] },

  // Patterns — Surface states
  'surface-pages-list': { category: 'patterns', subcategory: 'Surfaces', tags: ['surface', 'pages', 'list'] },
  'surface-detail':     { category: 'patterns', subcategory: 'Surfaces', tags: ['surface', 'detail'] },

  // Patterns — Widgets
  'widget.content.announcements': { category: 'patterns', subcategory: 'Widgets', tags: ['widget', 'announcements', 'content'] },
  'widgets.data-table':           { category: 'patterns', subcategory: 'Widgets', tags: ['widget', 'table', 'data'] },
  'widgets.chart':                { category: 'patterns', subcategory: 'Widgets', tags: ['widget', 'chart', 'viz'] },
  'widgets.chart-card':           { category: 'patterns', subcategory: 'Widgets', tags: ['widget', 'chart', 'card', 'stateful'] },
  'widgets.sparkline':            { category: 'patterns', subcategory: 'Widgets', tags: ['widget', 'chart', 'sparkline'] },
  'widgets.kpi-tile':             { category: 'patterns', subcategory: 'Widgets', tags: ['widget', 'kpi', 'metric', 'tile'] },

  // Templates — editors
  'page-templates.block-editor':  { category: 'templates', subcategory: 'Editors',       tags: ['template', 'block', 'editor'] },
  'layout-editor.blank':          { category: 'templates', subcategory: 'Layout Editor', tags: ['layout', 'editor', 'blank'] },
};

// Patterned ids whose exact id is generated at load time (per-preset or
// per-seed-document). Ordered from most-specific to least-specific — first
// match wins.
const PATTERNS: Array<{ prefix: string; entry: TaxonomyEntry }> = [
  { prefix: 'page-editor.',    entry: { category: 'templates', subcategory: 'Page Editor',    tags: ['page', 'editor'] } },
  { prefix: 'layout-editor.',  entry: { category: 'templates', subcategory: 'Layout Editor',  tags: ['layout', 'editor'] } },
  { prefix: 'layout.',         entry: { category: 'templates', subcategory: 'Layouts',        tags: ['layout', 'preview', 'grid'] } },
  { prefix: 'gallery.',        entry: { category: 'templates', subcategory: 'Layout Gallery', tags: ['layout', 'gallery'] } },
  { prefix: 'page.',            entry: { category: 'pages',     subcategory: 'Content',        tags: ['page', 'content'] } },
];

// Warn-once cache so a specimen with a missing taxonomy entry logs a
// single console.warn instead of one per resolveTaxonomy() call (which
// happens every time the sandbox re-renders the sidebar).
const warnedUnknownIds = new Set<string>();

export function resolveTaxonomy(id: string): TaxonomyEntry {
  const fixed = STATIC[id];
  if (fixed) return fixed;
  for (const { prefix, entry } of PATTERNS) {
    if (id.startsWith(prefix)) return entry;
  }
  // Unknown id — put it under an explicit "Unsorted" bucket so missing
  // taxonomy is visible rather than silent.
  if (!warnedUnknownIds.has(id)) {
    warnedUnknownIds.add(id);
    console.warn(
      '[sandbox] specimen id "%s" has no taxonomy entry; using Unsorted fallback',
      id,
    );
  }
  return { category: 'primitives', subcategory: 'Unsorted', status: 'review', tags: [] };
}
