use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttributeDefinition {
    pub id: Uuid,
    pub key: String,
    pub data_type: String,
    pub unit_dimension_id: Option<Uuid>,
    pub filterable_default: bool,
    pub sortable_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttributeOption {
    pub id: Uuid,
    pub attribute_id: Uuid,
    pub key: String,
    pub label: String,
}
