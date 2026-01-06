///! Single-flight pattern for cache stampede protection
///!
///! Ensures that only one computation happens per key, even with concurrent requests.
///! All concurrent callers await the same result.
use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};

/// Single-flight coordinator for preventing duplicate computations
pub struct SingleFlight<K, V>
where
    K: Eq + Hash + Clone,
    V: Clone,
{
    /// In-flight computations: key -> (result_slot, notifier)
    in_flight: Arc<Mutex<HashMap<K, Arc<InFlightEntry<V>>>>>,
}

struct InFlightEntry<V: Clone> {
    /// Notifier for waiting callers
    notify: Notify,
    /// Result slot (None = still computing, Some = done)
    result: Mutex<Option<Result<V, String>>>,
}

impl<K, V> SingleFlight<K, V>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Clone + Send + 'static,
{
    /// Create a new single-flight coordinator
    pub fn new() -> Self {
        Self {
            in_flight: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Execute a computation with single-flight protection
    ///
    /// If another caller is already computing the same key, this will wait
    /// for that computation to complete and return the same result.
    ///
    /// # Arguments
    /// * `key` - The deduplication key
    /// * `compute` - Async function to compute the value if needed
    ///
    /// # Returns
    /// The computed value (or error if computation failed)
    pub async fn execute<F, Fut>(&self, key: K, compute: F) -> Result<V, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, String>>,
    {
        // Check if someone is already computing this key
        let (entry, is_first) = {
            let mut in_flight = self.in_flight.lock().await;

            if let Some(existing) = in_flight.get(&key) {
                // Someone is already computing, we'll wait
                (existing.clone(), false)
            } else {
                // No one is computing, we're the first - create entry
                let entry = Arc::new(InFlightEntry {
                    notify: Notify::new(),
                    result: Mutex::new(None),
                });
                in_flight.insert(key.clone(), entry.clone());
                (entry, true)
            }
        };

        if is_first {
            // We're the first one here, do the computation
            let computed_result = compute().await;

            // Store the result
            {
                let mut result = entry.result.lock().await;
                *result = Some(computed_result.clone());
            }

            // Clean up in_flight map
            {
                let mut in_flight = self.in_flight.lock().await;
                in_flight.remove(&key);
            }

            // Notify all waiters
            entry.notify.notify_waiters();

            computed_result
        } else {
            // Someone else is computing, wait for notification
            entry.notify.notified().await;

            // Get the result
            let result = entry.result.lock().await;
            result
                .as_ref()
                .expect("Result should be available after notification")
                .clone()
        }
    }
}

impl<K, V> Default for SingleFlight<K, V>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Clone + Send + 'static,
{
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;
    use tokio::time::sleep;

    #[tokio::test]
    async fn test_single_flight_deduplication() {
        let sf = SingleFlight::<String, String>::new();
        let compute_count = Arc::new(AtomicU32::new(0));

        // Spawn 10 concurrent calls for the same key
        let mut handles = vec![];
        for i in 0..10 {
            let sf_clone = sf.clone();
            let count_clone = compute_count.clone();

            let handle = tokio::spawn(async move {
                let result = sf_clone
                    .execute("key1".to_string(), || async {
                        count_clone.fetch_add(1, Ordering::SeqCst);
                        sleep(Duration::from_millis(100)).await;
                        Ok(format!("value-{}", i))
                    })
                    .await;
                result
            });
            handles.push(handle);
        }

        // Wait for all to complete
        let results: Vec<_> = futures::future::join_all(handles)
            .await
            .into_iter()
            .map(|r| r.unwrap())
            .collect();

        // Only one computation should have happened
        assert_eq!(compute_count.load(Ordering::SeqCst), 1);

        // All results should be the same (first computation wins)
        assert!(results.iter().all(|r| r.is_ok()));
        let first = results[0].as_ref().unwrap();
        assert!(results.iter().all(|r| r.as_ref().unwrap() == first));
    }

    #[tokio::test]
    async fn test_single_flight_different_keys() {
        let sf = SingleFlight::<String, String>::new();
        let compute_count = Arc::new(AtomicU32::new(0));

        // Spawn calls for different keys
        let mut handles = vec![];
        for i in 0..5 {
            let sf_clone = sf.clone();
            let count_clone = compute_count.clone();

            let handle = tokio::spawn(async move {
                let key = format!("key-{}", i);
                sf_clone
                    .execute(key.clone(), || async move {
                        count_clone.fetch_add(1, Ordering::SeqCst);
                        sleep(Duration::from_millis(50)).await;
                        Ok(format!("value-{}", i))
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

        // Each key should compute independently (5 computations)
        assert_eq!(compute_count.load(Ordering::SeqCst), 5);

        // All results should be different
        assert!(results.iter().all(|r| r.is_ok()));
    }

    #[tokio::test]
    async fn test_single_flight_error_propagation() {
        let sf = SingleFlight::<String, String>::new();

        // Spawn multiple calls that will fail
        let mut handles = vec![];
        for _ in 0..5 {
            let sf_clone = sf.clone();

            let handle = tokio::spawn(async move {
                sf_clone
                    .execute("error-key".to_string(), || async {
                        sleep(Duration::from_millis(50)).await;
                        Err("computation failed".to_string())
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

        // All should receive the same error
        assert!(results.iter().all(|r| r.is_err()));
        assert!(results
            .iter()
            .all(|r| r.as_ref().unwrap_err() == "computation failed"));
    }
}

// Need to implement Clone for SingleFlight
impl<K, V> Clone for SingleFlight<K, V>
where
    K: Eq + Hash + Clone,
    V: Clone,
{
    fn clone(&self) -> Self {
        Self {
            in_flight: self.in_flight.clone(),
        }
    }
}
