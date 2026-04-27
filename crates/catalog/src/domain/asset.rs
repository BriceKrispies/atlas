use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: Uuid,
    pub asset_key: String,
    pub media_type: Option<String>,
    pub uri: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetAttachment {
    pub id: Uuid,
    pub asset_id: Uuid,
    pub family_id: Option<Uuid>,
    pub variant_id: Option<Uuid>,
    pub role: String,
    pub display_order: i32,
}
