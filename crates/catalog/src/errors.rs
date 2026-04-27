use thiserror::Error;

#[derive(Debug, Error)]
pub enum CatalogError {
    #[error("INVALID_SEED_PAYLOAD: {0}")]
    InvalidSeedPayload(String),

    #[error("FAMILY_NOT_FOUND: {0}")]
    FamilyNotFound(String),

    #[error("FAMILY_REVISION_NOT_FOUND: family={family}, revision={revision}")]
    FamilyRevisionNotFound { family: String, revision: i32 },

    #[error("ATTRIBUTE_NOT_FOUND: {0}")]
    AttributeNotFound(String),

    #[error("TENANT_DB_UNAVAILABLE: {0}")]
    TenantDbUnavailable(String),

    #[error("STORAGE_FAILED: {0}")]
    StorageFailed(String),

    #[error("EVENT_APPEND_FAILED: {0}")]
    EventAppendFailed(String),
}

pub type CatalogResult<T> = Result<T, CatalogError>;
