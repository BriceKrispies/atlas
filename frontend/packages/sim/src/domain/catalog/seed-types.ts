export interface SeedTaxonomyNode {
  key: string;
  path: string;
  name: string;
  parent: string | null;
}

export interface SeedTaxonomyTree {
  key: string;
  name: string;
  purpose: string;
  nodes: SeedTaxonomyNode[];
}

export interface SeedUnitDimension {
  key: string;
  baseUnit: string;
}

export interface SeedUnit {
  key: string;
  dimension: string;
  name: string;
  symbol: string;
  toBaseMultiplier: number;
}

export interface SeedAttributeOption {
  key: string;
  label: string;
}

export interface SeedAttributeDefinition {
  key: string;
  dataType: string;
  unitDimension?: string;
  filterableDefault?: boolean;
  sortableDefault?: boolean;
  options?: SeedAttributeOption[];
}

export interface SeedFamilyAttribute {
  attributeKey: string;
  role: string;
  required?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  isVariantAxis?: boolean;
  displayOrder: number;
}

export interface SeedFilterPolicy {
  attributeKey: string;
  filterType: string;
  operatorSet: string;
  displayOrder: number;
}

export interface SeedSortPolicy {
  sortKey: string;
  attributeKey: string;
  direction: string;
  isDefault: boolean;
}

export interface SeedDisplayPolicy {
  surface: string;
  attributeKey: string;
  role: string;
  order: number;
}

export interface SeedVariant {
  key: string;
  name: string;
  values: Record<string, unknown>;
}

export interface SeedFamily {
  key: string;
  type: string;
  name: string;
  defaultTaxonomyNode: string;
  canonicalSlug: string;
  attributes: SeedFamilyAttribute[];
  filterPolicies?: SeedFilterPolicy[];
  sortPolicies?: SeedSortPolicy[];
  displayPolicies?: SeedDisplayPolicy[];
  variants: SeedVariant[];
}

export interface SeedPayload {
  taxonomyTrees: SeedTaxonomyTree[];
  unitDimensions?: SeedUnitDimension[];
  units?: SeedUnit[];
  attributeDefinitions?: SeedAttributeDefinition[];
  families: SeedFamily[];
  assets?: Array<{ assetKey: string; mediaType?: string; uri?: string; metadata?: unknown }>;
}
