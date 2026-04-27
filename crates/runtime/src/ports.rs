//! Port trait definitions (hexagonal architecture).

use async_trait::async_trait;
use atlas_core::types::{AnalyticsEvent, EventEnvelope, SearchDocument};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PortError {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Duplicate: {0}")]
    Duplicate(String),
    #[error("Cache error: {0}")]
    CacheError(String),
    #[error("Internal error: {0}")]
    Internal(String),
    #[error("Unavailable: {0}")]
    Unavailable(String),
    #[error("Misconfigured: {0}")]
    Misconfigured(String),
}

pub type PortResult<T> = Result<T, PortError>;

/// Event store port (append-only event log)
#[async_trait]
pub trait EventStore: Send + Sync {
    /// Append event to stream (enforces idempotency via idempotency_key).
    ///
    /// Returns the event_id associated with the idempotency_key:
    /// - If this is a new idempotency_key: stores the event and returns envelope.event_id
    /// - If the idempotency_key already exists: returns the ORIGINAL event_id (idempotent replay)
    ///
    /// This enables proper idempotency semantics where duplicate requests return
    /// the cached result rather than failing.
    async fn append(&self, envelope: &EventEnvelope) -> PortResult<String>;

    /// Get event by ID
    async fn get_event(&self, event_id: &str) -> PortResult<EventEnvelope>;

    /// Read events for a tenant (for projection rebuild)
    async fn read_events(&self, tenant_id: &str) -> PortResult<Vec<EventEnvelope>>;
}

/// Options for setting a cache value
#[derive(Debug, Clone)]
pub struct SetOptions {
    /// Time-to-live in seconds (0 = no expiration)
    pub ttl_seconds: u32,
    /// Tags for invalidation (MUST include tenant_id per Invariant I9)
    pub tags: Vec<String>,
}

impl SetOptions {
    /// Create new set options with TTL and tags
    pub fn new(ttl_seconds: u32, tags: Vec<String>) -> Self {
        Self { ttl_seconds, tags }
    }
}

/// Cache port with tag-based invalidation (Invariant I9, I10)
#[async_trait]
pub trait Cache: Send + Sync {
    /// Get cached value by key
    /// Returns None if key doesn't exist or has expired
    async fn get(&self, key: &str) -> PortResult<Option<Vec<u8>>>;

    /// Set cached value with TTL and tags
    async fn set(&self, key: &str, value: Vec<u8>, opts: SetOptions) -> PortResult<()>;

    /// Invalidate a single cache entry by key
    /// Returns true if the key existed and was removed
    async fn invalidate_by_key(&self, key: &str) -> PortResult<bool>;

    /// Invalidate all cache entries matching any of the given tags
    /// Returns count of keys invalidated
    async fn invalidate_by_tags(&self, tags: &[String]) -> PortResult<u32>;
}

/// Search engine port (Invariant I7, I8)
#[async_trait]
pub trait SearchEngine: Send + Sync {
    /// Index a document
    async fn index(&self, document: &SearchDocument) -> PortResult<()>;

    /// Search with tenant isolation and permission filtering
    async fn search(
        &self,
        query: &str,
        tenant_id: &str,
        principal_id: &str,
    ) -> PortResult<Vec<SearchDocument>>;
}

/// Projection-side capability for rebuilding search documents.
///
/// Sibling to `SearchEngine` — adds the `delete_by_document` capability
/// the projection builder needs to scrub stale rows before re-indexing
/// a family. Kept separate so the read-side `SearchEngine` trait stays
/// minimal (the query handler never needs to delete).
#[async_trait]
pub trait SearchProjectionTarget: Send + Sync {
    async fn delete_by_document(
        &self,
        tenant_id: &str,
        document_type: &str,
        document_id: &str,
    ) -> PortResult<()>;

    async fn index(&self, document: &SearchDocument) -> PortResult<()>;
}

/// Analytics store port (Invariant I11)
#[async_trait]
pub trait AnalyticsStore: Send + Sync {
    /// Record analytics event
    async fn record(&self, event: &AnalyticsEvent) -> PortResult<()>;

    /// Query with time bucketing and dimension grouping
    async fn query(
        &self,
        event_type: &str,
        tenant_id: &str,
        time_range: (i64, i64),
        bucket_size_secs: u64,
        dimensions: &[String],
    ) -> PortResult<Vec<TimeBucket>>;
}

#[derive(Debug, Clone)]
pub struct TimeBucket {
    pub timestamp: i64,
    pub dimensions: HashMap<String, String>,
    pub value: f64,
}

/// Projection store port — persists read-model projections built from events
#[async_trait]
pub trait ProjectionStore: Send + Sync {
    /// Get a projection by key (e.g. "RenderPageModel:{tenantId}:{pageId}")
    async fn get(&self, key: &str) -> PortResult<Option<serde_json::Value>>;

    /// Set (upsert) a projection by key
    async fn set(&self, key: &str, value: serde_json::Value) -> PortResult<()>;

    /// Delete a projection by key. Returns true if the key existed.
    async fn delete(&self, key: &str) -> PortResult<bool>;
}

/// Control Plane Registry port - provides module manifests, schemas, and policies
#[async_trait]
pub trait ControlPlaneRegistry: Send + Sync {
    /// Get tenant information
    async fn get_tenant(&self, tenant_id: &str) -> PortResult<TenantInfo>;

    /// List enabled modules for a tenant with their versions and config
    async fn list_enabled_modules(&self, tenant_id: &str) -> PortResult<Vec<EnabledModuleInfo>>;

    /// Get module manifest for a specific version
    async fn get_module_manifest(
        &self,
        module_id: &str,
        version: &str,
    ) -> PortResult<atlas_core::types::ModuleManifest>;

    /// Get JSON schema from registry
    async fn get_schema(&self, schema_id: &str, version: i32) -> PortResult<serde_json::Value>;

    /// Get active policy bundle for tenant (latest active version)
    async fn get_active_policy_bundle(
        &self,
        tenant_id: &str,
    ) -> PortResult<Vec<atlas_core::types::Policy>>;
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct TenantInfo {
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub region: Option<String>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct EnabledModuleInfo {
    pub module_id: String,
    pub enabled_version: String,
    pub config_json: Option<serde_json::Value>,
}

/// Per-tenant database provider port.
///
/// Resolves a tenant ID to a Postgres connection pool for that tenant's
/// dedicated database. Implementations are expected to cache pools across
/// calls (per-tenant pool reuse) since pool construction is expensive.
///
/// Each tenant has its own physical database — see migration
/// `20250101000003_add_tenant_db_info.sql` for the per-tenant connection
/// columns on `control_plane.tenants`.
///
/// Only available with the `postgres` feature; the in-memory / non-postgres
/// build path uses an `InMemoryTenantDbProvider` (in adapters) that returns
/// `PortError::Misconfigured` for any call.
#[cfg(feature = "postgres")]
#[async_trait]
pub trait TenantDbProvider: Send + Sync {
    /// Get (or create + cache) a pool for the given tenant's database.
    ///
    /// Errors:
    /// - `PortError::NotFound`: tenant_id does not exist in the registry
    /// - `PortError::Misconfigured`: tenant row is missing connection columns
    /// - `PortError::Unavailable`: failed to connect to the tenant database
    async fn get_pool(&self, tenant_id: &str) -> PortResult<sqlx::PgPool>;
}
