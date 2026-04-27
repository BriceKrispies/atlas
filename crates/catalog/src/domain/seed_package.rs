use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedPackagePayload {
    #[serde(default, rename = "taxonomyTrees")]
    pub taxonomy_trees: Vec<SeedTaxonomyTree>,
    #[serde(default, rename = "unitDimensions")]
    pub unit_dimensions: Vec<SeedUnitDimension>,
    #[serde(default)]
    pub units: Vec<SeedUnit>,
    #[serde(default, rename = "attributeDefinitions")]
    pub attribute_definitions: Vec<SeedAttributeDefinition>,
    #[serde(default)]
    pub families: Vec<SeedFamily>,
    #[serde(default)]
    pub assets: Vec<SeedAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedTaxonomyTree {
    pub key: String,
    pub name: String,
    pub purpose: String,
    pub nodes: Vec<SeedTaxonomyNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedTaxonomyNode {
    pub key: String,
    pub path: String,
    pub name: String,
    pub parent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedUnitDimension {
    pub key: String,
    #[serde(rename = "baseUnit")]
    pub base_unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedUnit {
    pub key: String,
    pub dimension: String,
    pub name: String,
    pub symbol: String,
    #[serde(rename = "toBaseMultiplier")]
    pub to_base_multiplier: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedAttributeDefinition {
    pub key: String,
    #[serde(rename = "dataType")]
    pub data_type: String,
    #[serde(default, rename = "unitDimension")]
    pub unit_dimension: Option<String>,
    #[serde(default, rename = "filterableDefault")]
    pub filterable_default: bool,
    #[serde(default, rename = "sortableDefault")]
    pub sortable_default: bool,
    #[serde(default)]
    pub options: Vec<SeedAttributeOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedAttributeOption {
    pub key: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedFamily {
    pub key: String,
    #[serde(rename = "type")]
    pub family_type: String,
    pub name: String,
    #[serde(rename = "defaultTaxonomyNode")]
    pub default_taxonomy_node: String,
    #[serde(rename = "canonicalSlug")]
    pub canonical_slug: String,
    pub attributes: Vec<SeedFamilyAttribute>,
    #[serde(default, rename = "filterPolicies")]
    pub filter_policies: Vec<SeedFilterPolicy>,
    #[serde(default, rename = "sortPolicies")]
    pub sort_policies: Vec<SeedSortPolicy>,
    #[serde(default, rename = "displayPolicies")]
    pub display_policies: Vec<SeedDisplayPolicy>,
    pub variants: Vec<SeedVariant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedFamilyAttribute {
    #[serde(rename = "attributeKey")]
    pub attribute_key: String,
    pub role: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub filterable: bool,
    #[serde(default)]
    pub sortable: bool,
    #[serde(default, rename = "isVariantAxis")]
    pub is_variant_axis: bool,
    #[serde(default, rename = "displayOrder")]
    pub display_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedFilterPolicy {
    #[serde(rename = "attributeKey")]
    pub attribute_key: String,
    #[serde(rename = "filterType")]
    pub filter_type: String,
    #[serde(rename = "operatorSet")]
    pub operator_set: String,
    #[serde(default, rename = "displayOrder")]
    pub display_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedSortPolicy {
    #[serde(rename = "sortKey")]
    pub sort_key: String,
    #[serde(rename = "attributeKey")]
    pub attribute_key: String,
    pub direction: String,
    #[serde(default, rename = "isDefault")]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedDisplayPolicy {
    pub surface: String,
    #[serde(rename = "attributeKey")]
    pub attribute_key: String,
    pub role: String,
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedVariant {
    pub key: String,
    pub name: String,
    pub values: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedAsset {
    #[serde(rename = "assetKey")]
    pub asset_key: String,
    #[serde(default, rename = "mediaType")]
    pub media_type: Option<String>,
    #[serde(default)]
    pub uri: Option<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}
