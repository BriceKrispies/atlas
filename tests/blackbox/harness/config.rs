use atlas_config::{atlas_env, get_env_or_dev, get_env_optional};
use std::time::Duration;

/// Test configuration loaded from environment variables.
///
/// The test harness does NOT load .env files. All configuration must be provided
/// explicitly by the test runner (CLI, CI script, or shell environment).
///
/// In dev mode (ATLAS_ENV=dev), sensible defaults are used for local testing.
/// In strict mode, all required variables must be set explicitly.
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
    /// Load configuration from environment variables.
    ///
    /// # Environment Variables
    ///
    /// Required in strict mode (have dev defaults):
    /// - `INGRESS_BASE_URL` - Base URL for ingress service (dev: http://localhost:3000)
    /// - `CONTROL_PLANE_BASE_URL` - Base URL for control plane (dev: http://localhost:8000)
    /// - `PROMETHEUS_BASE_URL` - Base URL for Prometheus (dev: http://localhost:9090)
    /// - `TEST_TENANT_ID` - Tenant ID for test requests (dev: tenant-itest-001)
    ///
    /// Optional:
    /// - `HTTP_TIMEOUT_SECONDS` - Request timeout in seconds (default: 5)
    /// - `RETRY_ATTEMPTS` - Number of retry attempts (default: 3)
    /// - `TEST_PRINCIPAL` - Debug principal for authenticated requests
    /// - `KEYCLOAK_CLIENT_SECRET` - If set, enables Keycloak auth tests
    /// - `KEYCLOAK_BASE_URL` - Keycloak URL (dev: http://localhost:8081)
    /// - `KEYCLOAK_REALM` - Keycloak realm (dev: atlas)
    /// - `KEYCLOAK_CLIENT_ID` - Keycloak client ID (dev: atlas-s2s)
    ///
    /// # Panics
    ///
    /// Panics in strict mode if required environment variables are not set.
    /// Tests should be run with ATLAS_ENV=dev or with all variables explicitly set.
    pub fn load() -> Self {
        let env_mode = atlas_env();

        // In strict mode for tests, we still want to be helpful
        if env_mode.is_strict() {
            eprintln!("WARNING: Running tests in STRICT mode (ATLAS_ENV != 'dev').");
            eprintln!("All test configuration must be explicitly set.");
            eprintln!("For local testing, set ATLAS_ENV=dev or provide all required vars.");
        }

        // Load Keycloak config if client secret is provided
        let keycloak = get_env_optional("KEYCLOAK_CLIENT_SECRET").map(|secret| {
            KeycloakConfig {
                base_url: get_env_or_dev("KEYCLOAK_BASE_URL", "http://localhost:8081")
                    .expect("KEYCLOAK_BASE_URL required in strict mode when KEYCLOAK_CLIENT_SECRET is set"),
                realm: get_env_or_dev("KEYCLOAK_REALM", "atlas")
                    .expect("KEYCLOAK_REALM required in strict mode when KEYCLOAK_CLIENT_SECRET is set"),
                client_id: get_env_or_dev("KEYCLOAK_CLIENT_ID", "atlas-s2s")
                    .expect("KEYCLOAK_CLIENT_ID required in strict mode when KEYCLOAK_CLIENT_SECRET is set"),
                client_secret: secret,
            }
        });

        let test_tenant_id = get_env_or_dev("TEST_TENANT_ID", "tenant-itest-001")
            .expect("TEST_TENANT_ID required in strict mode");

        // Build default test principal using the tenant ID
        let default_principal = format!("user:integration-test-user:{}", test_tenant_id);

        Self {
            ingress_base_url: get_env_or_dev("INGRESS_BASE_URL", "http://localhost:3000")
                .expect("INGRESS_BASE_URL required in strict mode"),
            control_plane_base_url: get_env_or_dev("CONTROL_PLANE_BASE_URL", "http://localhost:8000")
                .expect("CONTROL_PLANE_BASE_URL required in strict mode"),
            prometheus_base_url: get_env_or_dev("PROMETHEUS_BASE_URL", "http://localhost:9090")
                .expect("PROMETHEUS_BASE_URL required in strict mode"),
            test_tenant_id,
            http_timeout: Duration::from_secs(
                get_env_optional("HTTP_TIMEOUT_SECONDS")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(5),
            ),
            retry_attempts: get_env_optional("RETRY_ATTEMPTS")
                .and_then(|s| s.parse().ok())
                .unwrap_or(3),
            test_principal: get_env_optional("TEST_PRINCIPAL")
                .or_else(|| {
                    if env_mode.is_dev() {
                        Some(default_principal)
                    } else {
                        None
                    }
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
