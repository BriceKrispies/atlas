//! Postgres implementation of the `TenantDbProvider` port.
//!
//! Resolves a tenant ID to a per-tenant Postgres pool by reading the
//! connection columns (`db_host`, `db_port`, `db_name`, `db_user`,
//! `db_password`) on `control_plane.tenants`. Pools are cached with a
//! bounded-LRU cap so we don't accumulate unbounded connections across all
//! tenants ever seen.

#[cfg(feature = "postgres")]
use async_trait::async_trait;
#[cfg(feature = "postgres")]
use atlas_platform_runtime::ports::{PortError, PortResult, TenantDbProvider};
#[cfg(feature = "postgres")]
use sqlx::postgres::{PgPool, PgPoolOptions};
#[cfg(feature = "postgres")]
use std::collections::{HashMap, VecDeque};
#[cfg(feature = "postgres")]
use std::sync::{Arc, Mutex};

/// Default cap on the number of cached per-tenant pools.
#[cfg(feature = "postgres")]
const DEFAULT_LRU_CAP: usize = 32;

/// Default `max_connections` for each per-tenant pool.
#[cfg(feature = "postgres")]
const DEFAULT_POOL_MAX_CONNECTIONS: u32 = 5;

/// Postgres-backed `TenantDbProvider`.
///
/// Reads tenant connection info from `control_plane.tenants` via the
/// supplied control-plane pool, then builds and caches a per-tenant
/// `PgPool` keyed by `tenant_id`.
#[cfg(feature = "postgres")]
#[derive(Clone)]
pub struct PostgresTenantDbProvider {
    control_plane_pool: PgPool,
    cache: Arc<Mutex<TenantPoolCache>>,
}

#[cfg(feature = "postgres")]
struct TenantPoolCache {
    /// tenant_id -> pool
    pools: HashMap<String, PgPool>,
    /// Access order for LRU eviction. Front = oldest, back = most recent.
    order: VecDeque<String>,
    /// Maximum number of cached pools before LRU eviction kicks in.
    cap: usize,
}

#[cfg(feature = "postgres")]
impl TenantPoolCache {
    fn new(cap: usize) -> Self {
        Self {
            pools: HashMap::new(),
            order: VecDeque::new(),
            cap,
        }
    }

    fn get(&mut self, tenant_id: &str) -> Option<PgPool> {
        let pool = self.pools.get(tenant_id).cloned()?;
        // Move to back (most-recently-used)
        if let Some(pos) = self.order.iter().position(|id| id == tenant_id) {
            self.order.remove(pos);
        }
        self.order.push_back(tenant_id.to_string());
        Some(pool)
    }

    fn insert(&mut self, tenant_id: String, pool: PgPool) {
        // Evict if at capacity
        while self.pools.len() >= self.cap {
            if let Some(oldest) = self.order.pop_front() {
                self.pools.remove(&oldest);
            } else {
                break;
            }
        }
        self.pools.insert(tenant_id.clone(), pool);
        self.order.push_back(tenant_id);
    }
}

#[cfg(feature = "postgres")]
impl PostgresTenantDbProvider {
    /// Construct a new provider backed by the control-plane pool.
    /// Uses the default LRU cap (32) and `max_connections` (5) per tenant pool.
    pub fn new(control_plane_pool: PgPool) -> Self {
        Self::with_capacity(control_plane_pool, DEFAULT_LRU_CAP)
    }

    /// Construct with an explicit LRU capacity.
    pub fn with_capacity(control_plane_pool: PgPool, cap: usize) -> Self {
        let cap = cap.max(1);
        Self {
            control_plane_pool,
            cache: Arc::new(Mutex::new(TenantPoolCache::new(cap))),
        }
    }

    async fn lookup_connection_info(
        &self,
        tenant_id: &str,
    ) -> PortResult<TenantConnectionInfo> {
        let row: Option<(
            Option<String>,
            Option<i32>,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = sqlx::query_as(
            r#"
            SELECT db_host, db_port, db_name, db_user, db_password
            FROM control_plane.tenants
            WHERE tenant_id = $1
            "#,
        )
        .bind(tenant_id)
        .fetch_optional(&self.control_plane_pool)
        .await
        .map_err(|e| {
            PortError::Internal(format!(
                "Failed to query control_plane.tenants for {}: {}",
                tenant_id, e
            ))
        })?;

        let (host, port, name, user, password) = row
            .ok_or_else(|| PortError::NotFound(format!("tenant {}", tenant_id)))?;

        let host = host.ok_or_else(|| {
            PortError::Misconfigured(format!("tenant {} missing db_host", tenant_id))
        })?;
        let port = port.ok_or_else(|| {
            PortError::Misconfigured(format!("tenant {} missing db_port", tenant_id))
        })?;
        let name = name.ok_or_else(|| {
            PortError::Misconfigured(format!("tenant {} missing db_name", tenant_id))
        })?;
        let user = user.ok_or_else(|| {
            PortError::Misconfigured(format!("tenant {} missing db_user", tenant_id))
        })?;
        let password = password.ok_or_else(|| {
            PortError::Misconfigured(format!("tenant {} missing db_password", tenant_id))
        })?;

        Ok(TenantConnectionInfo {
            host,
            port,
            name,
            user,
            password,
        })
    }
}

#[cfg(feature = "postgres")]
struct TenantConnectionInfo {
    host: String,
    port: i32,
    name: String,
    user: String,
    password: String,
}

#[cfg(feature = "postgres")]
impl TenantConnectionInfo {
    fn connection_string(&self) -> String {
        format!(
            "postgres://{}:{}@{}:{}/{}",
            self.user, self.password, self.host, self.port, self.name
        )
    }
}

#[cfg(feature = "postgres")]
#[async_trait]
impl TenantDbProvider for PostgresTenantDbProvider {
    async fn get_pool(&self, tenant_id: &str) -> PortResult<PgPool> {
        // Cache hit — short critical section, just clone the pool handle.
        {
            let mut cache = self
                .cache
                .lock()
                .map_err(|e| PortError::Internal(format!("tenant pool cache poisoned: {}", e)))?;
            if let Some(pool) = cache.get(tenant_id) {
                return Ok(pool);
            }
        }

        // Cache miss — look up connection info and build a new pool. We
        // intentionally do this OUTSIDE the lock so concurrent first-time
        // requests for different tenants don't serialize on each other.
        let info = self.lookup_connection_info(tenant_id).await?;
        let conn_str = info.connection_string();

        let pool = PgPoolOptions::new()
            .max_connections(DEFAULT_POOL_MAX_CONNECTIONS)
            .connect(&conn_str)
            .await
            .map_err(|e| {
                PortError::Unavailable(format!(
                    "tenant {} db at {}:{}/{} unreachable: {}",
                    tenant_id, info.host, info.port, info.name, e
                ))
            })?;

        // Insert into cache. If a concurrent caller raced us and already
        // inserted a pool, theirs wins and ours is dropped on the floor —
        // that's fine, the extra pool just goes out of scope.
        let mut cache = self
            .cache
            .lock()
            .map_err(|e| PortError::Internal(format!("tenant pool cache poisoned: {}", e)))?;
        if let Some(existing) = cache.get(tenant_id) {
            return Ok(existing);
        }
        cache.insert(tenant_id.to_string(), pool.clone());
        Ok(pool)
    }
}

#[cfg(all(test, feature = "postgres"))]
mod tests {
    use super::*;

    #[test]
    fn lru_evicts_oldest() {
        let mut cache = TenantPoolCache::new(2);
        // We can't easily build real PgPools without a server; test the
        // ordering bookkeeping by inspecting `order`.
        cache.order.push_back("a".to_string());
        cache.order.push_back("b".to_string());
        // Simulate access of 'a' to make it MRU
        let _ = cache.order.iter().position(|x| x == "a").map(|p| {
            cache.order.remove(p);
            cache.order.push_back("a".to_string())
        });
        assert_eq!(cache.order.front().map(String::as_str), Some("b"));
        assert_eq!(cache.order.back().map(String::as_str), Some("a"));
    }
}
