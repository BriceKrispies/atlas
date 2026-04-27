use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Family {
    pub id: Uuid,
    pub key: String,
    pub family_type: String,
    pub name: String,
    pub canonical_slug: String,
    pub default_taxonomy_node_id: Option<Uuid>,
    pub current_revision_number: i32,
    pub published_revision_number: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyRevision {
    pub id: Uuid,
    pub family_id: Uuid,
    pub revision_number: i32,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyAttribute {
    pub family_id: Uuid,
    pub attribute_id: Uuid,
    pub role: String,
    pub required: bool,
    pub filterable: bool,
    pub sortable: bool,
    pub is_variant_axis: bool,
    pub display_order: i32,
}
