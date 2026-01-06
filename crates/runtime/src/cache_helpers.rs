///! Cache helper utilities combining single-flight and cache operations
use crate::ports::{Cache, PortResult, SetOptions};
use crate::singleflight::SingleFlight;
use std::future::Future;
use std::sync::Arc;

/// Helper for cached reads with single-flight protection
pub struct CachedRead {
    cache: Arc<dyn Cache>,
    single_flight: SingleFlight<String, Vec<u8>>,
}

impl CachedRead {
    /// Create a new cached read helper
    pub fn new(cache: Arc<dyn Cache>) -> Self {
        Self {
            cache,
            single_flight: SingleFlight::new(),
        }
    }

    /// Perform a cached read with single-flight protection
    ///
    /// Flow:
    /// 1. Check cache for hit
    /// 2. If miss, use single-flight to ensure only one computation
    /// 3. Compute value, store in cache with TTL and tags
    /// 4. Return value
    ///
    /// # Arguments
    /// * `key` - Cache key
    /// * `opts` - Set options (TTL and tags) for cache storage
    /// * `compute` - Async function to compute the value on cache miss
    ///
    /// # Returns
    /// The cached or computed value
    pub async fn get<F, Fut>(&self, key: &str, opts: SetOptions, compute: F) -> PortResult<Vec<u8>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = PortResult<Vec<u8>>>,
    {
        // Try cache first
        if let Some(cached) = self.cache.get(key).await? {
            return Ok(cached);
        }

        // Cache miss - use single-flight to compute
        let cache = self.cache.clone();
        let key_owned = key.to_string();
        let opts_clone = opts.clone();

        self.single_flight
            .execute(key.to_string(), || async move {
                // Compute the value
                let value = compute().await.map_err(|e| format!("{:?}", e))?;

                // Store in cache
                cache
                    .set(&key_owned, value.clone(), opts_clone)
                    .await
                    .map_err(|e| format!("{:?}", e))?;

                Ok(value)
            })
            .await
            .map_err(|e| crate::ports::PortError::CacheError(e))
    }
}

// NOTE: Integration tests for CachedRead are in the adapters crate tests
// because they require a concrete Cache implementation (InMemoryCache).

// Implement Clone for CachedRead
impl Clone for CachedRead {
    fn clone(&self) -> Self {
        Self {
            cache: self.cache.clone(),
            single_flight: self.single_flight.clone(),
        }
    }
}
