//! In-memory implementations of ports.

use async_trait::async_trait;
use atlas_core::types::{AnalyticsEvent, EventEnvelope, SearchDocument};
use atlas_platform_runtime::ports::*;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// In-memory event store (append-only, idempotent)
#[derive(Clone)]
pub struct InMemoryEventStore {
    events: Arc<RwLock<Vec<EventEnvelope>>>,
    idempotency_keys: Arc<RwLock<HashMap<String, String>>>,
}

impl InMemoryEventStore {
    pub fn new() -> Self {
        Self {
            events: Arc::new(RwLock::new(Vec::new())),
            idempotency_keys: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl Default for InMemoryEventStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl EventStore for InMemoryEventStore {
    async fn append(&self, envelope: &EventEnvelope) -> PortResult<String> {
        let mut keys = self.idempotency_keys.write().unwrap();

        // Invariant I3: Enforce idempotency
        // If idempotency_key already exists, return the ORIGINAL event_id (idempotent replay)
        if let Some(existing_id) = keys.get(&envelope.idempotency_key) {
            // Return the original event_id - this is proper idempotency semantics
            // The second request gets the same response as the first
            return Ok(existing_id.clone());
        }

        // New idempotency key - store the event
        keys.insert(envelope.idempotency_key.clone(), envelope.event_id.clone());
        self.events.write().unwrap().push(envelope.clone());
        Ok(envelope.event_id.clone())
    }

    async fn get_event(&self, event_id: &str) -> PortResult<EventEnvelope> {
        self.events
            .read()
            .unwrap()
            .iter()
            .find(|e| e.event_id == event_id)
            .cloned()
            .ok_or_else(|| PortError::NotFound(format!("event {}", event_id)))
    }

    async fn read_events(&self, tenant_id: &str) -> PortResult<Vec<EventEnvelope>> {
        Ok(self
            .events
            .read()
            .unwrap()
            .iter()
            .filter(|e| e.tenant_id == tenant_id)
            .cloned()
            .collect())
    }
}

/// Cache entry with value, tags, and expiration
#[derive(Debug, Clone)]
struct CacheEntry {
    value: Vec<u8>,
    tags: Vec<String>,
    /// Expiration timestamp in seconds since epoch (0 = no expiration)
    expires_at: u64,
}

impl CacheEntry {
    fn is_expired(&self, now: u64) -> bool {
        self.expires_at > 0 && now >= self.expires_at
    }
}

/// In-memory cache with tag-based invalidation and TTL support
#[derive(Clone)]
pub struct InMemoryCache {
    /// Cache entries with values, tags, and expiration
    entries: Arc<RwLock<HashMap<String, CacheEntry>>>,
    /// Tag index: tag -> Set of keys that have this tag
    tag_index: Arc<RwLock<HashMap<String, std::collections::HashSet<String>>>>,
}

impl InMemoryCache {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
            tag_index: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Get current timestamp in seconds since epoch
    fn now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }
}

impl Default for InMemoryCache {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Cache for InMemoryCache {
    async fn get(&self, key: &str) -> PortResult<Option<Vec<u8>>> {
        let now = Self::now();
        let entries = self.entries.read().unwrap();

        if let Some(entry) = entries.get(key) {
            if entry.is_expired(now) {
                // Entry expired, return miss
                return Ok(None);
            }
            Ok(Some(entry.value.clone()))
        } else {
            Ok(None)
        }
    }

    async fn set(&self, key: &str, value: Vec<u8>, opts: SetOptions) -> PortResult<()> {
        let now = Self::now();
        let expires_at = if opts.ttl_seconds > 0 {
            now + opts.ttl_seconds as u64
        } else {
            0 // No expiration
        };

        let entry = CacheEntry {
            value,
            tags: opts.tags.clone(),
            expires_at,
        };

        // Insert entry
        self.entries.write().unwrap().insert(key.to_string(), entry);

        // Update tag index
        let mut tag_index = self.tag_index.write().unwrap();
        for tag in opts.tags {
            tag_index
                .entry(tag)
                .or_insert_with(std::collections::HashSet::new)
                .insert(key.to_string());
        }

        Ok(())
    }

    async fn invalidate_by_key(&self, key: &str) -> PortResult<bool> {
        let mut entries = self.entries.write().unwrap();

        if let Some(entry) = entries.remove(key) {
            // Clean up tag index
            let mut tag_index = self.tag_index.write().unwrap();
            for tag in &entry.tags {
                if let Some(keys) = tag_index.get_mut(tag) {
                    keys.remove(key);
                    // Remove empty tag entries
                    if keys.is_empty() {
                        tag_index.remove(tag);
                    }
                }
            }
            Ok(true)
        } else {
            Ok(false)
        }
    }

    async fn invalidate_by_tags(&self, tags: &[String]) -> PortResult<u32> {
        // Collect all keys to remove (scope to drop lock before async operations)
        let keys_to_remove = {
            let tag_index = self.tag_index.read().unwrap();
            let mut keys = std::collections::HashSet::new();
            for tag in tags {
                if let Some(tag_keys) = tag_index.get(tag) {
                    keys.extend(tag_keys.iter().cloned());
                }
            }
            keys
        }; // Lock is dropped here

        let count = keys_to_remove.len() as u32;

        // Remove each key (now safe to await)
        for key in keys_to_remove {
            let _ = self.invalidate_by_key(&key).await;
        }

        Ok(count)
    }
}

/// In-memory search engine with tenant isolation and permission filtering
#[derive(Clone)]
pub struct InMemorySearchEngine {
    documents: Arc<RwLock<Vec<SearchDocument>>>,
}

impl InMemorySearchEngine {
    pub fn new() -> Self {
        Self {
            documents: Arc::new(RwLock::new(Vec::new())),
        }
    }
}

impl Default for InMemorySearchEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl SearchEngine for InMemorySearchEngine {
    async fn index(&self, document: &SearchDocument) -> PortResult<()> {
        let mut docs = self.documents.write().unwrap();
        // Remove existing document with same ID
        docs.retain(|d| d.document_id != document.document_id);
        docs.push(document.clone());
        Ok(())
    }

    async fn search(
        &self,
        query: &str,
        tenant_id: &str,
        principal_id: &str,
    ) -> PortResult<Vec<SearchDocument>> {
        let docs = self.documents.read().unwrap();
        Ok(docs
            .iter()
            .filter(|d| {
                // Invariant I7: Tenant isolation
                if d.tenant_id != tenant_id {
                    return false;
                }

                // Invariant I8: Permission filtering
                if let Some(perms) = &d.permission_attributes {
                    if !perms.allowed_principals.contains(&principal_id.to_string()) {
                        return false;
                    }
                }

                // Simple query matching (just check if query appears in fields)
                d.fields
                    .values()
                    .any(|v| v.to_string().to_lowercase().contains(&query.to_lowercase()))
            })
            .cloned()
            .collect())
    }
}

/// In-memory analytics store (no bucketing implementation yet, just storage)
#[derive(Clone)]
pub struct InMemoryAnalyticsStore {
    events: Arc<RwLock<Vec<AnalyticsEvent>>>,
}

impl InMemoryAnalyticsStore {
    pub fn new() -> Self {
        Self {
            events: Arc::new(RwLock::new(Vec::new())),
        }
    }
}

impl Default for InMemoryAnalyticsStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AnalyticsStore for InMemoryAnalyticsStore {
    async fn record(&self, event: &AnalyticsEvent) -> PortResult<()> {
        self.events.write().unwrap().push(event.clone());
        Ok(())
    }

    async fn query(
        &self,
        event_type: &str,
        tenant_id: &str,
        _time_range: (i64, i64),
        _bucket_size_secs: u64,
        _dimensions: &[String],
    ) -> PortResult<Vec<TimeBucket>> {
        // Simplified: just count events (full bucketing would be implemented here)
        let count = self
            .events
            .read()
            .unwrap()
            .iter()
            .filter(|e| e.event_type == event_type && e.tenant_id == tenant_id)
            .count();

        Ok(vec![TimeBucket {
            timestamp: 0,
            dimensions: HashMap::new(),
            value: count as f64,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[tokio::test]
    async fn test_event_store_idempotency() {
        let store = InMemoryEventStore::new();
        let envelope = EventEnvelope {
            event_id: "evt-123".to_string(),
            event_type: "Test.Event".to_string(),
            schema_id: "test.v1".to_string(),
            schema_version: 1,
            occurred_at: Utc::now(),
            tenant_id: "tenant-001".to_string(),
            correlation_id: "corr-123".to_string(),
            idempotency_key: "idem-123".to_string(),
            causation_id: None,
            principal_id: None,
            user_id: None,
            cache_invalidation_tags: None,
            payload: serde_json::json!({}),
        };

        // First append succeeds and returns the event_id
        let result1 = store.append(&envelope).await.unwrap();
        assert_eq!(result1, "evt-123");

        // Second append with same idempotency key succeeds (idempotent)
        // and returns the SAME event_id
        let result2 = store.append(&envelope).await.unwrap();
        assert_eq!(result2, "evt-123");

        // Different event with same idempotency key ALSO succeeds
        // but returns the ORIGINAL event_id (idempotent replay)
        let mut envelope2 = envelope.clone();
        envelope2.event_id = "evt-456".to_string();
        let result3 = store.append(&envelope2).await.unwrap();
        assert_eq!(result3, "evt-123"); // Returns original, not the new one
    }

    #[tokio::test]
    async fn test_cache_tag_invalidation() {
        let cache = InMemoryCache::new();

        cache
            .set(
                "key1",
                b"value1".to_vec(),
                SetOptions::new(300, vec!["tag1".to_string(), "tag2".to_string()]),
            )
            .await
            .unwrap();

        cache
            .set(
                "key2",
                b"value2".to_vec(),
                SetOptions::new(300, vec!["tag2".to_string()]),
            )
            .await
            .unwrap();

        cache
            .set(
                "key3",
                b"value3".to_vec(),
                SetOptions::new(300, vec!["tag3".to_string()]),
            )
            .await
            .unwrap();

        // Invalidate by tag2 should remove key1 and key2
        let count = cache
            .invalidate_by_tags(&["tag2".to_string()])
            .await
            .unwrap();
        assert_eq!(count, 2);

        assert!(cache.get("key1").await.unwrap().is_none());
        assert!(cache.get("key2").await.unwrap().is_none());
        assert!(cache.get("key3").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn test_search_tenant_isolation() {
        let engine = InMemorySearchEngine::new();

        let doc1 = SearchDocument {
            document_id: "doc1".to_string(),
            document_type: "Page".to_string(),
            tenant_id: "tenant-001".to_string(),
            fields: HashMap::from([("title".to_string(), serde_json::json!("Test Page"))]),
            permission_attributes: None,
        };

        let doc2 = SearchDocument {
            document_id: "doc2".to_string(),
            document_type: "Page".to_string(),
            tenant_id: "tenant-002".to_string(),
            fields: HashMap::from([("title".to_string(), serde_json::json!("Test Page"))]),
            permission_attributes: None,
        };

        engine.index(&doc1).await.unwrap();
        engine.index(&doc2).await.unwrap();

        // Search in tenant-001 should only return doc1
        let results = engine
            .search("Test", "tenant-001", "user-123")
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].document_id, "doc1");
    }
}
