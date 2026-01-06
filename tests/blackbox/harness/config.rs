use std::env;
use std::time::Duration;

/// Test configuration loaded from environment variables
#[derive(Debug, Clone)]
pub struct TestConfig {
    pub ingress_base_url: String,
    pub control_plane_base_url: String,
    pub prometheus_base_url: String,
    pub test_tenant_id: String,
    pub http_timeout: Duration,
    pub retry_attempts: u32,
}

impl TestConfig {
    /// Load configuration from environment variables
    pub fn load() -> Self {
        // Load .env file based on AWS_ENV flag
        let env_file = if env::var("AWS_ENV").is_ok() {
            ".env.aws"
        } else {
            ".env.local"
        };

        // Attempt to load env file (OK if it doesn't exist)
        dotenvy::from_filename(env_file).ok();

        Self {
            ingress_base_url: env::var("INGRESS_BASE_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
            control_plane_base_url: env::var("CONTROL_PLANE_BASE_URL")
                .unwrap_or_else(|_| "http://localhost:8000".to_string()),
            prometheus_base_url: env::var("PROMETHEUS_BASE_URL")
                .unwrap_or_else(|_| "http://localhost:9090".to_string()),
            test_tenant_id: env::var("TEST_TENANT_ID")
                .unwrap_or_else(|_| "tenant-itest-001".to_string()),
            http_timeout: Duration::from_secs(
                env::var("HTTP_TIMEOUT_SECONDS")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(5),
            ),
            retry_attempts: env::var("RETRY_ATTEMPTS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(3),
        }
    }
}

impl Default for TestConfig {
    fn default() -> Self {
        Self::load()
    }
}
