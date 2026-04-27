use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitDimension {
    pub id: Uuid,
    pub key: String,
    pub base_unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Unit {
    pub id: Uuid,
    pub dimension_id: Uuid,
    pub key: String,
    pub name: String,
    pub symbol: String,
    pub to_base_multiplier: f64,
}
