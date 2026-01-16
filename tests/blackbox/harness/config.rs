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
    /// Debug principal header value for test auth mode (e.g., "user:test-user")
    /// When set, this is sent as X-Debug-Principal header for authenticated requests.
    pub test_principal: Option<String>,
    /// Keycloak configuration for OIDC authentication tests
    pub keycloak: Option<KeycloakConfig>,
}

/// Keycloak OIDC configuration for authentication tests
#[derive(Debug, Clone)]
pub struct KeycloakConfig {
    pub base_url: String,
    pub realm: String,
    pub client_id: String,
    pub client_secret: String,
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

        // Load Keycloak config if client secret is provided
        let keycloak = env::var("KEYCLOAK_CLIENT_SECRET").ok().map(|secret| {
            KeycloakConfig {
                base_url: env::var("KEYCLOAK_BASE_URL")
                    .unwrap_or_else(|_| "http://localhost:8081".to_string()),
                realm: env::var("KEYCLOAK_REALM")
                    .unwrap_or_else(|_| "atlas".to_string()),
                client_id: env::var("KEYCLOAK_CLIENT_ID")
                    .unwrap_or_else(|_| "atlas-s2s".to_string()),
                client_secret: secret,
            }
        });

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
            // Default to a test principal for authenticated requests
            // Format: "type:id:tenant_id" (e.g., "user:test-user:tenant-itest-001")
            // The tenant must match the payload's tenant_id for tenant isolation
            test_principal: env::var("TEST_PRINCIPAL").ok().or_else(|| {
                // Default to a test user with the test tenant
                Some("user:integration-test-user:tenant-itest-001".to_string())
            }),
            keycloak,
        }
    }
}

impl Default for TestConfig {
    fn default() -> Self {
        Self::load()
    }
}
