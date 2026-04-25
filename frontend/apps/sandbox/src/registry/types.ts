export type Category =
  | 'foundations'
  | 'typography'
  | 'inputs'
  | 'identity'
  | 'feedback'
  | 'navigation'
  | 'overlays'
  | 'mobile'
  | 'data'
  | 'media'
  | 'agent'
  | 'patterns'
  | 'widgets'
  | 'layouts'
  | 'authoring-preview';

export type Status = 'stable' | 'wip' | 'review';

export const CATEGORIES: ReadonlyArray<{ id: Category; label: string }> = [
  { id: 'foundations',       label: 'Foundations' },
  { id: 'typography',        label: 'Typography' },
  { id: 'inputs',            label: 'Inputs' },
  { id: 'identity',          label: 'Identity' },
  { id: 'feedback',          label: 'Feedback' },
  { id: 'navigation',        label: 'Navigation' },
  { id: 'overlays',          label: 'Overlays' },
  { id: 'mobile',            label: 'Mobile' },
  { id: 'data',              label: 'Data' },
  { id: 'media',             label: 'Media' },
  { id: 'agent',             label: 'Agent' },
  { id: 'patterns',          label: 'Patterns' },
  { id: 'widgets',           label: 'Widgets' },
  { id: 'layouts',           label: 'Layouts' },
  { id: 'authoring-preview', label: 'Authoring (preview)' },
];

export interface TaxonomyEntry {
  category: Category;
  subcategory?: string;
  status?: Status;
  tags?: readonly string[];
  title?: string;
}
