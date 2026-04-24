export type Category = 'primitives' | 'patterns' | 'pages' | 'templates';

export type Status = 'stable' | 'wip' | 'review';

export const CATEGORIES: ReadonlyArray<{ id: Category; label: string }> = [
  { id: 'primitives', label: 'Primitives' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'pages', label: 'Pages' },
  { id: 'templates', label: 'Templates' },
];

export interface TaxonomyEntry {
  category: Category;
  subcategory: string;
  status?: Status;
  tags?: readonly string[];
  title?: string;
}
