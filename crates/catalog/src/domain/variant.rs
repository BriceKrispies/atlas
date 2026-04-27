use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Variant {
    pub id: Uuid,
    pub family_id: Uuid,
    pub key: String,
    pub name: String,
    pub revision_number: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantAttributeValue {
    pub variant_id: Uuid,
    pub attribute_id: Uuid,
    pub raw_value: serde_json::Value,
    pub normalized_value: Option<serde_json::Value>,
    pub display_value: Option<String>,
}
