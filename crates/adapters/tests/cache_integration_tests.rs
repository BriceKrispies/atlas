use atlas_core::cache::{build_cache_key, render_tags, validate_cache_artifact};
use atlas_core::types::{CacheArtifact, EventEnvelope, PrivacyLevel, VaryDimension};
use atlas_platform_adapters::{InMemoryCache, InMemoryEventStore};
use atlas_platform_runtime::ports::{Cache, EventStore, SetOptions};
use atlas_platform_runtime::CachedRead;
///! Comprehensive cache integration tests demonstrating:
///! 1. Deterministic key building with tenant scoping
///! 2. Tag-based invalidation
///! 3. TTL expiration
///! 4. Event-driven invalidation
///! 5. Single-flight stampede protection
use chrono::Utc;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;

/// Test 1: Build cache key is deterministic and tenant-scoped
#[tokio::test]
async fn test_build_cache_key_deterministic_and_tenant_scoped() {
    let artifact = CacheArtifact {
        artifact_id: "RenderPageModel".to_string(),
        vary_by: vec![VaryDimension::Locale],
        ttl_seconds: 300,
        tags: vec!["tenant:{tenantId}".to_string(), "page:{pageId}".to_string()],
        privacy: PrivacyLevel::Tenant,
    };

    // Validate artifact configuration
    assert!(validate_cache_artifact(&artifact).is_ok());

    let mut key_values = HashMap::new();
    key_values.insert("tenantId".to_string(), "acme-corp".to_string());
    key_values.insert("pageId".to_string(), "home-123".to_string());

    let mut vary_values = HashMap::new();
    vary_values.insert("locale".to_string(), "en-US".to_string());

    // Build key multiple times
    let key1 = build_cache_key(&artifact, &key_values, Some(&vary_values)).unwrap();
    let key2 = build_cache_key(&artifact, &key_values, Some(&vary_values)).unwrap();

    // Keys should be identical (deterministic)
    assert_eq!(key1, key2);

    // Key should contain tenant ID (tenant-scoped)
    assert!(key1.contains("acme-corp"));

    // Key should start with cache prefix
    assert!(key1.starts_with("cache:"));

    println!("Generated cache key: {}", key1);
}

/// Test 2: Missing required key parts fails validation
#[tokio::test]
async fn test_missing_key_parts_fails_validation() {
    let artifact = CacheArtifact {
        artifact_id: "RenderPageModel".to_string(),
        vary_by: vec![],
        ttl_seconds: 300,
        tags: vec!["tenant:{tenantId}".to_string(), "page:{pageId}".to_string()],
        privacy: PrivacyLevel::Tenant,
    };

    let mut key_values = HashMap::new();
    key_values.insert("tenantId".to_string(), "acme-corp".to_string());
    // Missing pageId

    // Should fail to build key
    let result = build_cache_key(&artifact, &key_values, None);
    assert!(result.is_err());

    // Should fail to render tags
    let result = render_tags(&artifact, &key_values, None);
    assert!(result.is_err());
}

/// Test 3: Set/get respects TTL expiration
#[tokio::test]
async fn test_cache_ttl_expiration() {
    let cache = InMemoryCache::new();

    // Set value with 1 second TTL
    cache
        .set(
            "expiring-key",
            b"will-expire".to_vec(),
            SetOptions::new(1, vec!["test-tag".to_string()]),
        )
        .await
        .unwrap();

    // Immediately readable
    let value = cache.get("expiring-key").await.unwrap();
    assert_eq!(value, Some(b"will-expire".to_vec()));

    // Wait for expiration
    sleep(Duration::from_millis(1100)).await;

    // Should return None (expired)
    let value = cache.get("expiring-key").await.unwrap();
    assert_eq!(value, None);
}

/// Test 4: Invalidate by tags removes all matching keys and cleans index
#[tokio::test]
async fn test_invalidate_by_tags_removes_keys_and_cleans_index() {
    let cache = InMemoryCache::new();

    // Set multiple keys with overlapping tags
    cache
        .set(
            "key1",
            b"value1".to_vec(),
            SetOptions::new(
                300,
                vec!["tenant:acme".to_string(), "page:home".to_string()],
            ),
        )
        .await
        .unwrap();

    cache
        .set(
            "key2",
            b"value2".to_vec(),
            SetOptions::new(
                300,
                vec!["tenant:acme".to_string(), "page:about".to_string()],
            ),
        )
        .await
        .unwrap();

    cache
        .set(
            "key3",
            b"value3".to_vec(),
            SetOptions::new(300, vec!["tenant:other".to_string()]),
        )
        .await
        .unwrap();

    // Invalidate by tenant:acme tag
    let count = cache
        .invalidate_by_tags(&["tenant:acme".to_string()])
        .await
        .unwrap();

    // Should remove 2 keys
    assert_eq!(count, 2);

    // key1 and key2 should be gone
    assert_eq!(cache.get("key1").await.unwrap(), None);
    assert_eq!(cache.get("key2").await.unwrap(), None);

    // key3 should still exist
    assert_eq!(cache.get("key3").await.unwrap(), Some(b"value3".to_vec()));
}

/// Test 5: CachedRead uses single-flight (only 1 compute for N concurrent requests)
#[tokio::test]
async fn test_cached_read_single_flight_stampede_protection() {
    let cache = Arc::new(InMemoryCache::new()) as Arc<dyn Cache>;
    let cached_read = CachedRead::new(cache.clone());
    let compute_count = Arc::new(AtomicU32::new(0));

    // Spawn 20 concurrent reads for the same key
    let mut handles = vec![];
    for _ in 0..20 {
        let cached_read_clone = cached_read.clone();
        let count_clone = compute_count.clone();

        let handle = tokio::spawn(async move {
            let opts = SetOptions::new(60, vec!["test-tag".to_string()]);

            cached_read_clone
                .get("hot-key", opts, || async move {
                    count_clone.fetch_add(1, Ordering::SeqCst);
                    sleep(Duration::from_millis(100)).await; // Simulate slow computation
                    Ok(b"expensive-computation-result".to_vec())
                })
                .await
        });
        handles.push(handle);
    }

    // Wait for all to complete
    let results: Vec<_> = futures::future::join_all(handles)
        .await
        .into_iter()
        .map(|r| r.unwrap())
        .collect();

    // CRITICAL: Only ONE computation should have happened (stampede protection)
    assert_eq!(
        compute_count.load(Ordering::SeqCst),
        1,
        "Single-flight should ensure only 1 computation"
    );

    // All results should be the same
    assert!(results.iter().all(|r| r.is_ok()));
    assert!(results
        .iter()
        .all(|r| r.as_ref().unwrap() == b"expensive-computation-result"));

    // Value should be cached for subsequent reads
    let cached = cache.get("hot-key").await.unwrap();
    assert_eq!(cached, Some(b"expensive-computation-result".to_vec()));
}

/// Test 6: Event-driven invalidation workflow
#[tokio::test]
async fn test_event_driven_cache_invalidation() {
    let event_store = Arc::new(InMemoryEventStore::new()) as Arc<dyn EventStore>;
    let cache = Arc::new(InMemoryCache::new()) as Arc<dyn Cache>;

    // Step 1: Populate cache with page render
    let artifact = CacheArtifact {
        artifact_id: "RenderPageModel".to_string(),
        vary_by: vec![],
        ttl_seconds: 300,
        tags: vec!["tenant:{tenantId}".to_string(), "page:{pageId}".to_string()],
        privacy: PrivacyLevel::Tenant,
    };

    let mut key_values = HashMap::new();
    key_values.insert("tenantId".to_string(), "acme".to_string());
    key_values.insert("pageId".to_string(), "home".to_string());

    let cache_key = build_cache_key(&artifact, &key_values, None).unwrap();
    let tags = render_tags(&artifact, &key_values, None).unwrap();

    cache
        .set(
            &cache_key,
            b"<html>rendered page</html>".to_vec(),
            SetOptions::new(300, tags.clone()),
        )
        .await
        .unwrap();

    // Verify cache hit
    let cached = cache.get(&cache_key).await.unwrap();
    assert!(cached.is_some());

    // Step 2: Emit domain event with cache invalidation tags
    let event = EventEnvelope {
        event_id: "evt-001".to_string(),
        event_type: "PageContentUpdated".to_string(),
        schema_id: "page.content.updated.v1".to_string(),
        schema_version: 1,
        occurred_at: Utc::now(),
        tenant_id: "acme".to_string(),
        correlation_id: "corr-001".to_string(),
        idempotency_key: "idem-001".to_string(),
        causation_id: None,
        principal_id: None,
        user_id: None,
        cache_invalidation_tags: Some(tags), // Event carries invalidation tags
        payload: serde_json::json!({
            "pageId": "home",
            "content": "New content"
        }),
    };

    event_store.append(&event).await.unwrap();

    // Step 3: Worker processes event and invalidates cache
    let events = event_store.read_events("acme").await.unwrap();
    for event in events {
        if let Some(invalidation_tags) = &event.cache_invalidation_tags {
            let invalidated_count = cache.invalidate_by_tags(invalidation_tags).await.unwrap();
            assert_eq!(invalidated_count, 1, "Should invalidate 1 cache entry");
        }
    }

    // Step 4: Verify cache is cleared
    let cached_after = cache.get(&cache_key).await.unwrap();
    assert_eq!(
        cached_after, None,
        "Cache should be invalidated after event processing"
    );
}

/// Test 7: Privacy validation - Tenant privacy requires tenant tag
#[tokio::test]
async fn test_privacy_validation_tenant_requires_tenant_tag() {
    let mut artifact = CacheArtifact {
        artifact_id: "TenantSettings".to_string(),
        vary_by: vec![],
        ttl_seconds: 300,
        tags: vec!["setting:{settingId}".to_string()], // Missing tenant tag
        privacy: PrivacyLevel::Tenant,
    };

    // Should fail validation
    assert!(validate_cache_artifact(&artifact).is_err());

    // Add tenant tag
    artifact.tags.insert(0, "tenant:{tenantId}".to_string());

    // Now should pass
    assert!(validate_cache_artifact(&artifact).is_ok());
}

/// Test 8: Privacy validation - User privacy requires principal in varyBy
#[tokio::test]
async fn test_privacy_validation_user_requires_principal() {
    let mut artifact = CacheArtifact {
        artifact_id: "UserProfile".to_string(),
        vary_by: vec![VaryDimension::Locale], // Missing User dimension
        ttl_seconds: 300,
        tags: vec!["tenant:{tenantId}".to_string(), "user:{userId}".to_string()],
        privacy: PrivacyLevel::User,
    };

    // Should fail validation
    assert!(validate_cache_artifact(&artifact).is_err());

    // Add User to varyBy
    artifact.vary_by.push(VaryDimension::User);

    // Now should pass
    assert!(validate_cache_artifact(&artifact).is_ok());
}

/// Test 9: Public privacy allows cache without tenant tag
#[tokio::test]
async fn test_privacy_validation_public_no_tenant_required() {
    let artifact = CacheArtifact {
        artifact_id: "GlobalConfig".to_string(),
        vary_by: vec![],
        ttl_seconds: 300,
        tags: vec!["config:global".to_string()], // No tenant tag
        privacy: PrivacyLevel::Public,
    };

    // Should pass validation (public doesn't require tenant)
    assert!(validate_cache_artifact(&artifact).is_ok());
}

/// Test 10: Concurrent invalidations are safe
#[tokio::test]
async fn test_concurrent_invalidations_are_safe() {
    let cache = Arc::new(InMemoryCache::new());

    // Set 100 keys with different tags
    for i in 0..100 {
        cache
            .set(
                &format!("key-{}", i),
                format!("value-{}", i).into_bytes(),
                SetOptions::new(
                    300,
                    vec![
                        format!("tenant:acme"),
                        format!("resource-{}", i % 10), // 10 different resource tags
                    ],
                ),
            )
            .await
            .unwrap();
    }

    // Spawn 10 concurrent invalidation tasks
    let mut handles = vec![];
    for i in 0..10 {
        let cache_clone = cache.clone();
        let handle = tokio::spawn(async move {
            cache_clone
                .invalidate_by_tags(&[format!("resource-{}", i)])
                .await
                .unwrap()
        });
        handles.push(handle);
    }

    // Wait for all invalidations
    let results = futures::future::join_all(handles).await;

    // All should succeed
    assert!(results.iter().all(|r| r.is_ok()));

    // Total invalidated should be 100 (each resource tag had 10 keys)
    let total: u32 = results.iter().map(|r| r.as_ref().unwrap()).sum();
    assert_eq!(total, 100);
}
