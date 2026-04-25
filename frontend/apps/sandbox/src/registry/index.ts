import type { Category, Status, TaxonomyEntry } from './types.ts';

export type { Category, Status, TaxonomyEntry } from './types.ts';
export { CATEGORIES } from './types.ts';

// Fixed-id taxonomy. Id = key. Source of truth for where each specimen
// lives in the sidebar. Tags feed the sidebar search. Status drives the
// Badge on the preview header. Subcategory is optional — most categories
// list specimens flat; only `inputs` is large enough to warrant grouping.
const STATIC: Record<string, TaxonomyEntry> = {
  // Foundations (layout primitives)
  'box':            { category: 'foundations', tags: ['layout', 'container'] },
  'stack':          { category: 'foundations', tags: ['layout', 'flex', 'row', 'column'] },
  'card':           { category: 'foundations', tags: ['surface', 'container', 'bordered'] },
  'divider':        { category: 'foundations', tags: ['rule', 'separator', 'hr'] },
  'grid':           { category: 'foundations', tags: ['grid', 'columns', 'auto-fit'] },
  'scroll-area':    { category: 'foundations', tags: ['scroll', 'overflow', 'region'] },

  // Typography
  'heading':        { category: 'typography', tags: ['typography', 'h1', 'h2', 'h3', 'title'] },
  'text':           { category: 'typography', tags: ['typography', 'paragraph', 'body'] },
  'label':          { category: 'typography', tags: ['caption', 'eyebrow', 'uppercase'] },
  'code':           { category: 'typography', tags: ['mono', 'inline', 'block', 'snippet'] },
  'code-editor':    { category: 'typography', tags: ['monaco', 'editor', 'code', 'lazy'] },
  'kbd':            { category: 'typography', tags: ['keyboard', 'shortcut', 'pill'] },
  'link':           { category: 'typography', tags: ['anchor', 'href', 'navigation'] },
  'icon':           { category: 'typography', tags: ['svg', 'visual', 'glyph'] },

  // Inputs — Text
  'button':         { category: 'inputs', subcategory: 'Text',        tags: ['action', 'cta', 'submit'] },
  'input':          { category: 'inputs', subcategory: 'Text',        tags: ['form', 'text', 'field'] },
  'textarea':       { category: 'inputs', subcategory: 'Text',        tags: ['form', 'multiline', 'field'] },
  'number-input':   { category: 'inputs', subcategory: 'Text',        tags: ['form', 'number', 'field'] },
  'search-input':   { category: 'inputs', subcategory: 'Text',        tags: ['form', 'search', 'field'] },

  // Inputs — Selection
  'select':         { category: 'inputs', subcategory: 'Selection',   tags: ['form', 'dropdown', 'choice'] },
  'multi-select':   { category: 'inputs', subcategory: 'Selection',   tags: ['form', 'dropdown', 'multi', 'tags'] },
  'checkbox':       { category: 'inputs', subcategory: 'Selection',   tags: ['form', 'boolean', 'choice'] },
  'radio-group':    { category: 'inputs', subcategory: 'Selection',   tags: ['form', 'choice', 'radio'] },
  'switch':         { category: 'inputs', subcategory: 'Selection',   tags: ['form', 'toggle', 'boolean'] },
  'slider':         { category: 'inputs', subcategory: 'Selection',   tags: ['form', 'range'] },
  'toggle-group':   { category: 'inputs', subcategory: 'Selection',   tags: ['toggle', 'multi-select', 'segmented', 'pressed'] },

  // Inputs — Specialized
  'date-picker':    { category: 'inputs', subcategory: 'Specialized', tags: ['form', 'date', 'calendar'] },
  'file-upload':    { category: 'inputs', subcategory: 'Specialized', tags: ['form', 'upload', 'file'] },
  'color-picker':   { category: 'inputs', subcategory: 'Specialized', tags: ['form', 'color', 'hex', 'hsl', 'rgb'] },
  'form-field':     { category: 'inputs', subcategory: 'Specialized', tags: ['form', 'label', 'wrapper'] },
  'split-button':   { category: 'inputs', subcategory: 'Specialized', tags: ['button', 'dropdown', 'menu', 'composite'] },

  // Inputs — Chips
  'chip':           { category: 'inputs', subcategory: 'Chips',       tags: ['chip', 'filter', 'choice', 'tag'] },
  'chip-group':     { category: 'inputs', subcategory: 'Chips',       tags: ['chip', 'group', 'selection'] },
  'chip-input':     { category: 'inputs', subcategory: 'Chips',       tags: ['chip', 'input', 'tags', 'form'] },

  // Identity
  'avatar':         { category: 'identity', tags: ['avatar', 'user', 'profile', 'image'] },
  'avatar-group':   { category: 'identity', tags: ['avatar', 'group', 'cluster', 'overflow'] },
  'tag':            { category: 'identity', tags: ['tag', 'label', 'pill', 'metadata'] },

  // Media
  'media-picker':   { category: 'media', tags: ['media', 'image', 'video', 'library', 'picker'] },

  // Feedback
  'badge':          { category: 'feedback', tags: ['status', 'chip', 'pill'] },
  'skeleton':       { category: 'feedback', tags: ['loading', 'placeholder'] },
  'spinner':        { category: 'feedback', tags: ['loading', 'busy', 'indicator'] },
  'alert':          { category: 'feedback', tags: ['banner', 'notice', 'info', 'warning', 'danger'] },
  'empty-state':    { category: 'feedback', tags: ['empty', 'placeholder', 'zero'] },
  'progress':       { category: 'feedback', tags: ['progress', 'bar', 'determinate', 'indeterminate'] },

  // Navigation
  'nav':               { category: 'navigation', tags: ['navigation', 'links', 'sidebar'] },
  'tabs':              { category: 'navigation', tags: ['tabs', 'views', 'underline'] },
  'segmented-control': { category: 'navigation', tags: ['segmented', 'picker', 'radiogroup', 'toggle'] },
  'accordion':         { category: 'navigation', tags: ['expand', 'collapse', 'disclosure', 'details'] },
  'breadcrumbs':       { category: 'navigation', tags: ['breadcrumb', 'trail', 'navigation', 'path'] },
  'tree':              { category: 'navigation', tags: ['tree', 'hierarchy', 'treeview', 'expand'] },
  'stepper':           { category: 'navigation', tags: ['stepper', 'wizard', 'progress', 'steps'] },
  'pagination':        { category: 'navigation', tags: ['pagination', 'pager', 'pages', 'next', 'prev'] },

  // Overlays
  'tooltip':           { category: 'overlays', tags: ['hover', 'popover', 'hint'] },
  'dialog':            { category: 'overlays', tags: ['modal', 'confirm', 'alert'] },
  'drawer':            { category: 'overlays', tags: ['sheet', 'side-panel', 'slide'] },
  'toast':             { category: 'overlays', tags: ['notification', 'ephemeral', 'snackbar'] },
  'command-palette':   { category: 'overlays', tags: ['cmdk', 'search', 'palette', 'jump'] },
  'menu':              { category: 'overlays', tags: ['menu', 'dropdown', 'context', 'long-press'] },
  'menu-item':         { category: 'overlays', tags: ['menu', 'item', 'row'] },
  'popover':           { category: 'overlays', tags: ['popover', 'hover', 'click', 'positioned'] },

  // Mobile
  'app-bar':           { category: 'mobile', tags: ['mobile', 'chrome', 'topbar'] },
  'bottom-nav':        { category: 'mobile', tags: ['mobile', 'nav', 'tabbar'] },
  'bottom-sheet':      { category: 'mobile', tags: ['mobile', 'sheet', 'modal', 'drag', 'snap'] },
  'action-sheet':      { category: 'mobile', tags: ['mobile', 'sheet', 'menu', 'ios', 'destructive'] },
  'fab':               { category: 'mobile', tags: ['mobile', 'floating', 'action', 'button', 'cta'] },
  'pull-to-refresh':   { category: 'mobile', tags: ['mobile', 'gesture', 'touch', 'refresh'] },
  'swipe-actions':     { category: 'mobile', tags: ['mobile', 'gesture', 'swipe', 'row'] },

  // Data
  'table':          { category: 'data', tags: ['table', 'grid', 'rows'] },
  'timeline':       { category: 'data', tags: ['timeline', 'log', 'events', 'history'] },
  'stat':           { category: 'data', tags: ['metric', 'kpi', 'number', 'tile'] },

  // Agent
  'diff':              { category: 'agent', tags: ['agent', 'diff', 'lcs', 'unified', 'split', 'review'] },
  'json-view':         { category: 'agent', tags: ['agent', 'json', 'tree', 'inspect', 'debug'] },
  'activity':          { category: 'agent', tags: ['agent', 'status', 'run', 'tool-call', 'streaming'] },
  'consent-banner':    { category: 'agent', tags: ['agent', 'consent', 'approve', 'deny', 'permission'] },
  'capability-grid':   { category: 'agent', tags: ['agent', 'capability', 'permission', 'grant', 'tile'] },
  'resource-picker':   { category: 'agent', tags: ['agent', 'picker', 'resource', 'page', 'media', 'user'] },

  // Patterns — Page / Forms / Shell / Surfaces
  'page-header':        { category: 'patterns', subcategory: 'Page',     tags: ['header', 'title', 'actions'] },
  'form-group':         { category: 'patterns', subcategory: 'Forms',    tags: ['form', 'group', 'layout'] },
  'shell-header':       { category: 'patterns', subcategory: 'Shell',    tags: ['header', 'topbar', 'chrome'] },
  'surface-pages-list': { category: 'patterns', subcategory: 'Surfaces', tags: ['surface', 'pages', 'list'] },
  'surface-detail':     { category: 'patterns', subcategory: 'Surfaces', tags: ['surface', 'detail'] },

  // Widgets — CMS content widgets
  'widget.content.announcements': { category: 'widgets', tags: ['widget', 'announcements', 'content'] },
  'widgets.data-table':           { category: 'widgets', tags: ['widget', 'table', 'data'] },
  'widgets.chart':                { category: 'widgets', tags: ['widget', 'chart', 'viz'] },
  'widgets.chart-card':           { category: 'widgets', tags: ['widget', 'chart', 'card', 'stateful'] },
  'widgets.sparkline':            { category: 'widgets', tags: ['widget', 'chart', 'sparkline'] },
  'widgets.kpi-tile':             { category: 'widgets', tags: ['widget', 'kpi', 'metric', 'tile'] },

  // Authoring previews — static host elements; full editors live in the
  // authoring app.
  'authoring-previews.layout-editor': { category: 'authoring-preview', tags: ['authoring', 'layout', 'editor', 'preview'] },
  'authoring-previews.block-editor':  { category: 'authoring-preview', tags: ['authoring', 'block', 'editor', 'preview'] },
};

// Patterned ids whose exact id is generated at load time (per-preset or
// per-seed-document). Ordered from most-specific to least-specific — first
// match wins.
const PATTERNS: Array<{ prefix: string; entry: TaxonomyEntry }> = [
  { prefix: 'layout.', entry: { category: 'layouts', subcategory: 'Presets',     tags: ['layout', 'preview', 'grid'] } },
  { prefix: 'page.',   entry: { category: 'layouts', subcategory: 'Seed pages', tags: ['page', 'content'] } },
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
  return { category: 'foundations', subcategory: 'Unsorted', status: 'review', tags: [] };
}
