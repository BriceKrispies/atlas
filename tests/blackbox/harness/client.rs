use crate::config::TestConfig;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// HTTP client for interacting with the Atlas Platform ingress service
#[derive(Clone)]
pub struct TestClient {
    config: TestConfig,
    http_client: reqwest::Client,
}

/// Request payload for submitting an intent to the ingress
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentPayload {
    pub event_id: String,
    pub event_type: String,
    pub schema_id: String,
    pub schema_version: u32,
    pub occurred_at: String,
    pub tenant_id: String,
    pub correlation_id: String,
    pub idempotency_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub principal_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    pub payload: Value,
}

/// Response from ingress after submitting an intent
#[derive(Debug, Clone, Deserialize)]
pub struct IntentResponse {
    pub event_id: String,
    pub tenant_id: String,
}

/// Raw HTTP response with status and body
#[derive(Debug)]
pub struct RawResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Parsed Prometheus metrics
#[derive(Debug, Clone)]
pub struct PrometheusMetrics {
    pub raw: String,
    pub metrics: HashMap<String, Vec<MetricSample>>,
}

#[derive(Debug, Clone)]
pub struct MetricSample {
    pub labels: HashMap<String, String>,
    pub value: f64,
}

impl TestClient {
    /// Create a new test client from environment configuration
    pub fn from_env() -> Self {
        Self::new(TestConfig::load())
    }

    /// Create a new test client with the given configuration
    pub fn new(config: TestConfig) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(config.http_timeout)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            config,
            http_client,
        }
    }

    /// Submit an intent to the ingress service
    pub async fn submit_intent(&self, payload: IntentPayload) -> Result<IntentResponse> {
        let url = format!("{}/api/v1/intents", self.config.ingress_base_url);

        let mut request = self.http_client.post(&url).json(&payload);

        // Add test auth header if configured
        if let Some(ref test_principal) = self.config.test_principal {
            request = request.header("X-Debug-Principal", test_principal);
        }

        let response = request.send().await.context("Failed to send intent request")?;

        let status = response.status();
        let body = response
            .text()
            .await
            .context("Failed to read response body")?;

        if !status.is_success() {
            anyhow::bail!("Intent submission failed with status {}: {}", status, body);
        }

        serde_json::from_str(&body).context("Failed to parse intent response")
    }

    /// Submit an intent and return the raw response (for testing error cases)
    pub async fn submit_intent_raw(&self, payload: IntentPayload) -> Result<RawResponse> {
        let url = format!("{}/api/v1/intents", self.config.ingress_base_url);

        let mut request = self.http_client.post(&url).json(&payload);

        // Add test auth header if configured
        if let Some(ref test_principal) = self.config.test_principal {
            request = request.header("X-Debug-Principal", test_principal);
        }

        let response = request.send().await.context("Failed to send intent request")?;

        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let body = response
            .text()
            .await
            .context("Failed to read response body")?;

        Ok(RawResponse {
            status,
            headers,
            body,
        })
    }

    /// Check the health of the ingress service
    pub async fn health_check(&self) -> Result<()> {
        let url = format!("{}/", self.config.ingress_base_url);

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .context("Failed to send health check request")?;

        if !response.status().is_success() {
            anyhow::bail!("Health check failed with status {}", response.status());
        }

        Ok(())
    }

    /// Liveness probe endpoint - GET /healthz
    ///
    /// Returns 200 OK if the process is running and can serve HTTP.
    /// Does NOT check external dependencies.
    pub async fn liveness_check(&self) -> Result<RawResponse> {
        let url = format!("{}/healthz", self.config.ingress_base_url);

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .context("Failed to send liveness check request")?;

        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let body = response
            .text()
            .await
            .context("Failed to read response body")?;

        Ok(RawResponse {
            status,
            headers,
            body,
        })
    }

    /// Readiness probe endpoint - GET /readyz
    ///
    /// Returns 200 OK when the service is ready to receive traffic.
    /// Checks schema registry and policy availability.
    /// Returns 503 Service Unavailable if dependencies are not ready.
    pub async fn readiness_check(&self) -> Result<RawResponse> {
        let url = format!("{}/readyz", self.config.ingress_base_url);

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .context("Failed to send readiness check request")?;

        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let body = response
            .text()
            .await
            .context("Failed to read response body")?;

        Ok(RawResponse {
            status,
            headers,
            body,
        })
    }

    /// Get Prometheus metrics from the ingress service
    pub async fn get_metrics(&self) -> Result<PrometheusMetrics> {
        let url = format!("{}/metrics", self.config.ingress_base_url);

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .context("Failed to fetch metrics")?;

        let raw = response
            .text()
            .await
            .context("Failed to read metrics body")?;

        Ok(PrometheusMetrics::parse(&raw))
    }

    /// Get the test configuration
    pub fn config(&self) -> &TestConfig {
        &self.config
    }

    /// Call the /debug/whoami endpoint with an optional Bearer token.
    ///
    /// This is used for authentication testing:
    /// - No token: Should return 401
    /// - Invalid token: Should return 401
    /// - Valid token: Should return 200 with principal info
    pub async fn whoami(&self, bearer_token: Option<&str>) -> Result<RawResponse> {
        let url = format!("{}/debug/whoami", self.config.ingress_base_url);

        let mut request = self.http_client.get(&url);

        if let Some(token) = bearer_token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let response = request
            .send()
            .await
            .context("Failed to send whoami request")?;

        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let body = response
            .text()
            .await
            .context("Failed to read response body")?;

        Ok(RawResponse {
            status,
            headers,
            body,
        })
    }

    /// Call the /debug/whoami endpoint with X-Debug-Principal header.
    ///
    /// This is used for testing the test-auth mode.
    pub async fn whoami_with_debug_principal(&self, principal: &str) -> Result<RawResponse> {
        let url = format!("{}/debug/whoami", self.config.ingress_base_url);

        let response = self
            .http_client
            .get(&url)
            .header("X-Debug-Principal", principal)
            .send()
            .await
            .context("Failed to send whoami request")?;

        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let body = response
            .text()
            .await
            .context("Failed to read response body")?;

        Ok(RawResponse {
            status,
            headers,
            body,
        })
    }
}

impl PrometheusMetrics {
    /// Parse Prometheus text format metrics
    pub fn parse(raw: &str) -> Self {
        let mut metrics: HashMap<String, Vec<MetricSample>> = HashMap::new();

        for line in raw.lines() {
            // Skip comments and empty lines
            if line.starts_with('#') || line.trim().is_empty() {
                continue;
            }

            // Parse metric line: metric_name{label="value"} 123.45
            if let Some((name_with_labels, value_str)) = line.rsplit_once(' ') {
                if let Ok(value) = value_str.parse::<f64>() {
                    let (name, labels) = if let Some(pos) = name_with_labels.find('{') {
                        let name = &name_with_labels[..pos];
                        let labels_str = &name_with_labels[pos + 1..name_with_labels.len() - 1];
                        let labels = Self::parse_labels(labels_str);
                        (name, labels)
                    } else {
                        (name_with_labels, HashMap::new())
                    };

                    metrics
                        .entry(name.to_string())
                        .or_insert_with(Vec::new)
                        .push(MetricSample { labels, value });
                }
            }
        }

        Self {
            raw: raw.to_string(),
            metrics,
        }
    }

    fn parse_labels(labels_str: &str) -> HashMap<String, String> {
        let mut labels = HashMap::new();

        for part in labels_str.split(',') {
            if let Some((key, value)) = part.split_once('=') {
                let key = key.trim();
                let value = value.trim().trim_matches('"');
                labels.insert(key.to_string(), value.to_string());
            }
        }

        labels
    }

    /// Get the value of a metric with the given name and labels
    pub fn get_metric_value(&self, name: &str, labels: &HashMap<String, String>) -> Option<f64> {
        self.metrics.get(name)?.iter().find_map(|sample| {
            if sample.labels == *labels {
                Some(sample.value)
            } else {
                None
            }
        })
    }

    /// Get all samples for a metric
    pub fn get_metric_samples(&self, name: &str) -> Option<&Vec<MetricSample>> {
        self.metrics.get(name)
    }
}
