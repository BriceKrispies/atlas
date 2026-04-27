use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxonomyTree {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxonomyNode {
    pub id: Uuid,
    pub tree_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub key: String,
    pub path: String,
    pub name: String,
}
