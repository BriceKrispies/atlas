use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterPolicy {
    pub family_id: Uuid,
    pub attribute_id: Uuid,
    pub filter_type: String,
    pub operator_set: String,
    pub display_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortPolicy {
    pub family_id: Uuid,
    pub sort_key: String,
    pub attribute_id: Uuid,
    pub direction: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayPolicy {
    pub family_id: Uuid,
    pub surface: String,
    pub attribute_id: Uuid,
    pub role: String,
    pub display_order: i32,
}
