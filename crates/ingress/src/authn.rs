//! Canonical Authentication (Authn) Middleware for Ingress.
//!
//! This module provides the single canonical point where every incoming request
//! is converted into an authenticated `Principal` (or rejected).
//!
//! # Architecture
//!
//! 1. **Principal Extraction**: Every request goes through `authn_middleware` which:
//!    - Attempts to authenticate the request (via bearer token, API key, etc.)
//!    - On success: stores the `Principal` in request extensions
//!    - On failure: returns 401 Unauthorized (request never reaches handlers)
//!
//! 2. **Principal Storage**: The authenticated `Principal` is stored in Axum's
//!    request extensions and can be extracted in handlers via `Extension<Principal>`.
//!
//! 3. **Test Auth Mode**: In dev/test builds (feature `test-auth`), a controlled
//!    mechanism allows deterministic principal injection via `X-Debug-Principal`
//!    header. This is compile-time gated AND runtime config guarded.
//!
//! # Usage in Handlers
//!
//! ```rust,ignore
//! async fn my_handler(
//!     Extension(principal): Extension<Principal>,
//!     // ... other extractors
//! ) -> impl IntoResponse {
//!     // principal.id, principal.principal_type, principal.claims available
//! }
//! ```
//!
//! # Security
//!
//! - Test auth mode is ONLY available when compiled with `test-auth` feature
//! - Even with the feature, runtime config `auth.test_auth_enabled` must be true
//! - If `X-Debug-Principal` header is present but test auth is disabled, it is ignored
//! - Production builds should NEVER enable the `test-auth` feature

use axum::{
    body::Body,
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

/// The type of authenticated principal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PrincipalType {
    /// A human user interacting with the system.
    User,
    /// A service/machine identity (e.g., internal microservice, external integration).
    Service,
    /// Anonymous/unauthenticated principal (only valid in specific contexts).
    Anonymous,
}

impl std::fmt::Display for PrincipalType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PrincipalType::User => write!(f, "user"),
            PrincipalType::Service => write!(f, "service"),
            PrincipalType::Anonymous => write!(f, "anonymous"),
        }
    }
}

/// Represents an authenticated principal (user or service) for a request.
///
/// This is the canonical identity type that flows through the request pipeline
/// after authentication. Handlers should use this to make authorization decisions
/// and for audit logging.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Principal {
    /// Unique identifier for the principal (e.g., user ID, service account ID).
    pub id: String,

    /// The type of principal (user, service, etc.).
    pub principal_type: PrincipalType,

    /// The tenant this principal belongs to.
    /// All operations should be scoped to this tenant.
    pub tenant_id: String,

    /// Additional claims/attributes about the principal.
    /// Populated from JWT claims, API key metadata, etc.
    /// Used for attribute-based access control (ABAC) decisions.
    pub claims: HashMap<String, serde_json::Value>,
}

impl Principal {
    /// Create a new Principal with minimal required fields.
    pub fn new(id: impl Into<String>, principal_type: PrincipalType, tenant_id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            principal_type,
            tenant_id: tenant_id.into(),
            claims: HashMap::new(),
        }
    }

    /// Create a new user principal.
    pub fn user(id: impl Into<String>, tenant_id: impl Into<String>) -> Self {
        Self::new(id, PrincipalType::User, tenant_id)
    }

    /// Create a new service principal.
    pub fn service(id: impl Into<String>, tenant_id: impl Into<String>) -> Self {
        Self::new(id, PrincipalType::Service, tenant_id)
    }

    /// Add a claim to this principal.
    pub fn with_claim(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.claims.insert(key.into(), value);
        self
    }

    /// Convert principal to attributes for policy evaluation.
    pub fn to_policy_attributes(&self) -> HashMap<String, serde_json::Value> {
        let mut attrs = self.claims.clone();
        attrs.insert("id".to_string(), serde_json::Value::String(self.id.clone()));
        attrs.insert(
            "type".to_string(),
            serde_json::Value::String(self.principal_type.to_string()),
        );
        attrs.insert(
            "tenant_id".to_string(),
            serde_json::Value::String(self.tenant_id.clone()),
        );
        attrs
    }
}

/// OIDC/JWT authentication configuration.
#[derive(Debug, Clone)]
pub struct OidcConfig {
    /// The expected issuer URL (must match the `iss` claim in tokens).
    /// Example: "http://localhost:8081/realms/atlas"
    pub issuer_url: String,

    /// URL to fetch JWKS from (can differ from issuer for Docker networking).
    /// If not set, JWKS URL is derived from issuer's .well-known/openid-configuration.
    /// Example: "http://keycloak:8080/realms/atlas/protocol/openid-connect/certs"
    pub jwks_url: Option<String>,

    /// The expected audience (must match the `aud` claim in tokens).
    /// Can be the client_id or "account" (Keycloak default).
    pub audience: String,
}

impl OidcConfig {
    /// Create new OIDC config with required fields.
    pub fn new(issuer_url: impl Into<String>, audience: impl Into<String>) -> Self {
        Self {
            issuer_url: issuer_url.into(),
            jwks_url: None,
            audience: audience.into(),
        }
    }

    /// Set explicit JWKS URL (for Docker internal networking).
    pub fn with_jwks_url(mut self, jwks_url: impl Into<String>) -> Self {
        self.jwks_url = Some(jwks_url.into());
        self
    }
}

/// Configuration for authentication behavior.
#[derive(Debug, Clone)]
pub struct AuthConfig {
    /// Whether test auth mode is enabled (allows X-Debug-Principal header).
    /// Only effective when compiled with `test-auth` feature.
    #[cfg(feature = "test-auth")]
    pub test_auth_enabled: bool,

    /// Whether the /debug/whoami endpoint is enabled.
    /// Only effective when compiled with `test-auth` feature.
    /// This endpoint returns the authenticated principal for debugging OAuth2/OIDC.
    #[cfg(feature = "test-auth")]
    pub debug_endpoint_enabled: bool,

    /// OIDC configuration for JWT validation.
    pub oidc: Option<OidcConfig>,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            #[cfg(feature = "test-auth")]
            test_auth_enabled: false,
            #[cfg(feature = "test-auth")]
            debug_endpoint_enabled: false,
            oidc: None,
        }
    }
}

impl AuthConfig {
    /// Create a new AuthConfig with default settings.
    pub fn new() -> Self {
        Self::default()
    }

    /// Enable test auth mode (only available with `test-auth` feature).
    #[cfg(feature = "test-auth")]
    pub fn with_test_auth(mut self, enabled: bool) -> Self {
        self.test_auth_enabled = enabled;
        self
    }

    /// Enable debug endpoint (only available with `test-auth` feature).
    #[cfg(feature = "test-auth")]
    pub fn with_debug_endpoint(mut self, enabled: bool) -> Self {
        self.debug_endpoint_enabled = enabled;
        self
    }

    /// Check if test auth mode is enabled.
    /// Always returns false when `test-auth` feature is not enabled.
    pub fn is_test_auth_enabled(&self) -> bool {
        #[cfg(feature = "test-auth")]
        {
            self.test_auth_enabled
        }
        #[cfg(not(feature = "test-auth"))]
        {
            false
        }
    }

    /// Check if debug endpoint is enabled.
    /// Always returns false when `test-auth` feature is not enabled.
    pub fn is_debug_endpoint_enabled(&self) -> bool {
        #[cfg(feature = "test-auth")]
        {
            self.debug_endpoint_enabled
        }
        #[cfg(not(feature = "test-auth"))]
        {
            false
        }
    }

    /// Set OIDC configuration for JWT validation.
    pub fn with_oidc(mut self, oidc: OidcConfig) -> Self {
        self.oidc = Some(oidc);
        self
    }
}

/// Header name for debug principal injection (test mode only).
pub const DEBUG_PRINCIPAL_HEADER: &str = "X-Debug-Principal";

/// Header name for explicit tenant ID specification.
pub const TENANT_ID_HEADER: &str = "X-Tenant-ID";

/// Authentication middleware that extracts or rejects principals.
///
/// This is the canonical authentication point for all ingress requests.
/// It runs before any handler and ensures every request has a valid Principal.
///
/// # Tenant Resolution
///
/// Tenant ID is resolved using the following precedence:
/// 1. X-Debug-Principal header tenant segment (test mode only)
/// 2. X-Tenant-ID header
/// 3. Default tenant from configuration
pub async fn authn_middleware(
    auth_config: Arc<AuthConfig>,
    default_tenant_id: String,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    // Extract correlation/request ID for logging if available
    let correlation_id = request
        .headers()
        .get("X-Correlation-ID")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Resolve tenant ID first (needed for authentication)
    let tenant_id = match resolve_tenant_id(&request, &default_tenant_id, &auth_config) {
        Ok(tid) => tid,
        Err(tenant_error) => {
            warn!(
                reason = %tenant_error.reason,
                correlation_id = ?correlation_id,
                "Tenant resolution failed"
            );
            return tenant_error.into_response();
        }
    };

    // Extract auth headers upfront (to avoid Send/Sync issues with async middleware)
    let auth_headers = AuthHeaders::from_request(&request);

    // Try to authenticate the request
    match authenticate_request(auth_headers, &auth_config, &tenant_id).await {
        Ok(principal) => {
            info!(
                principal_id = %principal.id,
                principal_type = %principal.principal_type,
                tenant_id = %principal.tenant_id,
                correlation_id = ?correlation_id,
                "Request authenticated"
            );

            // Store principal in request extensions for handlers
            request.extensions_mut().insert(principal);

            // Continue to next middleware/handler
            next.run(request).await
        }
        Err(authn_error) => {
            warn!(
                reason = %authn_error.reason,
                correlation_id = ?correlation_id,
                "Authentication failed"
            );

            // Return 401 Unauthorized
            authn_error.into_response()
        }
    }
}

/// Error returned when authentication fails.
#[derive(Debug)]
pub struct AuthnError {
    /// Human-readable reason for the failure (for logging, NOT for response body).
    pub reason: String,
    /// Error code for the response.
    pub status: StatusCode,
}

impl AuthnError {
    fn missing_auth() -> Self {
        Self {
            reason: "missing authentication credentials".to_string(),
            status: StatusCode::UNAUTHORIZED,
        }
    }

    fn invalid_credentials(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            status: StatusCode::UNAUTHORIZED,
        }
    }

    #[allow(dead_code)]
    fn malformed(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            status: StatusCode::BAD_REQUEST,
        }
    }
}

impl IntoResponse for AuthnError {
    fn into_response(self) -> Response {
        // Return a minimal error response - do not leak internal details
        let body = serde_json::json!({
            "error": "unauthorized",
            "message": "Authentication required"
        });

        (
            self.status,
            [(header::CONTENT_TYPE, "application/json")],
            serde_json::to_string(&body).unwrap_or_else(|_| r#"{"error":"unauthorized"}"#.to_string()),
        )
            .into_response()
    }
}

/// Extracted headers needed for authentication (to avoid holding &Request across await).
struct AuthHeaders {
    authorization: Option<String>,
    api_key: Option<String>,
    #[cfg(feature = "test-auth")]
    debug_principal: Option<String>,
}

impl AuthHeaders {
    fn from_request(request: &Request<Body>) -> Self {
        Self {
            authorization: request
                .headers()
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string()),
            api_key: request
                .headers()
                .get("X-API-Key")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string()),
            #[cfg(feature = "test-auth")]
            debug_principal: request
                .headers()
                .get(DEBUG_PRINCIPAL_HEADER)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string()),
        }
    }
}

/// Authenticate a request and return a Principal.
/// Takes pre-extracted headers to avoid Send/Sync issues with async middleware.
async fn authenticate_request(
    headers: AuthHeaders,
    auth_config: &AuthConfig,
    default_tenant_id: &str,
) -> Result<Principal, AuthnError> {
    // 1. Check for test auth mode (dev/test only)
    #[cfg(feature = "test-auth")]
    if auth_config.is_test_auth_enabled() {
        if let Some(ref debug_header) = headers.debug_principal {
            if let Some(principal) = parse_debug_principal(debug_header, default_tenant_id) {
                info!("Using debug principal from X-Debug-Principal header");
                return Ok(principal);
            }
        }
    }

    // 2. Try Bearer token authentication (JWT validation via OIDC)
    if let Some(principal) = try_bearer_token(headers.authorization.as_deref(), default_tenant_id, auth_config.oidc.as_ref()).await? {
        return Ok(principal);
    }

    // 3. Try API key authentication
    if let Some(principal) = try_api_key_from_header(headers.api_key.as_deref(), default_tenant_id)? {
        return Ok(principal);
    }

    // No valid authentication found
    Err(AuthnError::missing_auth())
}

/// Try to extract a debug principal from the X-Debug-Principal header.
///
/// Format: `type:id` or `type:id:tenant_id`
/// Examples:
///   - `user:123` -> User with id "123", default tenant
///   - `service:batch-worker` -> Service with id "batch-worker", default tenant
///   - `user:456:tenant-xyz` -> User with id "456", tenant "tenant-xyz"
///
/// This is ONLY available when:
/// 1. Compiled with `test-auth` feature
/// 2. Runtime `auth_config.test_auth_enabled` is true
#[cfg(feature = "test-auth")]
fn try_debug_principal(request: &Request<Body>, default_tenant_id: &str) -> Option<Principal> {
    let header_value = request
        .headers()
        .get(DEBUG_PRINCIPAL_HEADER)?
        .to_str()
        .ok()?;

    parse_debug_principal(header_value, default_tenant_id)
}

/// Parse a debug principal string into a Principal.
#[cfg(feature = "test-auth")]
fn parse_debug_principal(value: &str, default_tenant_id: &str) -> Option<Principal> {
    let parts: Vec<&str> = value.split(':').collect();

    match parts.as_slice() {
        [type_str, id] => {
            let principal_type = parse_principal_type(type_str)?;
            Some(Principal::new(*id, principal_type, default_tenant_id))
        }
        [type_str, id, tenant_id] => {
            let principal_type = parse_principal_type(type_str)?;
            Some(Principal::new(*id, principal_type, *tenant_id))
        }
        _ => None,
    }
}

/// Parse a principal type string.
#[cfg(feature = "test-auth")]
fn parse_principal_type(s: &str) -> Option<PrincipalType> {
    match s.to_lowercase().as_str() {
        "user" => Some(PrincipalType::User),
        "service" => Some(PrincipalType::Service),
        "anonymous" => Some(PrincipalType::Anonymous),
        _ => None,
    }
}

// ===========================================================================
// JWKS and JWT Validation
// ===========================================================================

/// JWKS (JSON Web Key Set) response from OIDC provider.
#[derive(Debug, Deserialize)]
struct JwksResponse {
    keys: Vec<Jwk>,
}

/// Individual JWK (JSON Web Key).
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct Jwk {
    kid: Option<String>,
    kty: String,
    alg: Option<String>,
    #[serde(rename = "use")]
    key_use: Option<String>,
    n: Option<String>,
    e: Option<String>,
}

/// Standard JWT claims we validate.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct JwtClaims {
    /// Subject (principal ID)
    sub: String,
    /// Issuer
    iss: String,
    /// Audience (can be string or array)
    #[serde(default)]
    aud: AudienceClaim,
    /// Expiration time
    exp: i64,
    /// Issued at
    #[serde(default)]
    iat: Option<i64>,
    /// Authorized party (client_id in Keycloak)
    #[serde(default)]
    azp: Option<String>,
    /// Preferred username
    #[serde(default)]
    preferred_username: Option<String>,
    /// Email
    #[serde(default)]
    email: Option<String>,
    /// Keycloak client_id claim (for service accounts)
    /// Note: Keycloak uses snake_case "client_id", not camelCase "clientId"
    #[serde(default)]
    client_id: Option<String>,
    /// Realm roles (Keycloak specific)
    #[serde(default)]
    realm_access: Option<RealmAccess>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(untagged)]
#[allow(dead_code)]
enum AudienceClaim {
    #[default]
    Empty,
    Single(String),
    Multiple(Vec<String>),
}

#[derive(Debug, Deserialize)]
struct RealmAccess {
    #[serde(default)]
    roles: Vec<String>,
}

/// Global JWKS cache (fetched once per issuer).
static JWKS_CACHE: OnceCell<RwLock<HashMap<String, Vec<Jwk>>>> = OnceCell::new();

fn get_jwks_cache() -> &'static RwLock<HashMap<String, Vec<Jwk>>> {
    JWKS_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Fetch JWKS from the provider, with caching.
async fn fetch_jwks(jwks_url: &str) -> Result<Vec<Jwk>, AuthnError> {
    // Check cache first
    {
        let cache = get_jwks_cache().read().await;
        if let Some(keys) = cache.get(jwks_url) {
            debug!("Using cached JWKS for {}", jwks_url);
            return Ok(keys.clone());
        }
    }

    // Fetch from provider
    debug!("Fetching JWKS from {}", jwks_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| {
            error!("Failed to create HTTP client: {}", e);
            AuthnError::invalid_credentials("internal error fetching JWKS")
        })?;

    let response = client.get(jwks_url).send().await.map_err(|e| {
        error!("Failed to fetch JWKS from {}: {}", jwks_url, e);
        AuthnError::invalid_credentials("failed to fetch JWKS from identity provider")
    })?;

    if !response.status().is_success() {
        error!("JWKS fetch returned status {}", response.status());
        return Err(AuthnError::invalid_credentials(
            "identity provider returned error",
        ));
    }

    let jwks: JwksResponse = response.json().await.map_err(|e| {
        error!("Failed to parse JWKS response: {}", e);
        AuthnError::invalid_credentials("invalid JWKS response from identity provider")
    })?;

    // Cache the keys
    {
        let mut cache = get_jwks_cache().write().await;
        cache.insert(jwks_url.to_string(), jwks.keys.clone());
    }

    info!("Cached {} JWKS keys from {}", jwks.keys.len(), jwks_url);
    Ok(jwks.keys)
}

/// Find the appropriate key from JWKS for a given key ID.
fn find_key_for_kid<'a>(keys: &'a [Jwk], kid: Option<&str>) -> Option<&'a Jwk> {
    // If kid is provided, find exact match
    if let Some(kid) = kid {
        keys.iter().find(|k| k.kid.as_deref() == Some(kid))
    } else {
        // No kid, try first RSA key marked for signature use
        keys.iter()
            .find(|k| k.kty == "RSA" && k.key_use.as_deref() != Some("enc"))
    }
}

/// Create a DecodingKey from a JWK.
fn decoding_key_from_jwk(jwk: &Jwk) -> Result<DecodingKey, AuthnError> {
    if jwk.kty != "RSA" {
        return Err(AuthnError::invalid_credentials("unsupported key type"));
    }

    let n = jwk.n.as_ref().ok_or_else(|| {
        AuthnError::invalid_credentials("JWK missing 'n' component")
    })?;
    let e = jwk.e.as_ref().ok_or_else(|| {
        AuthnError::invalid_credentials("JWK missing 'e' component")
    })?;

    DecodingKey::from_rsa_components(n, e).map_err(|e| {
        error!("Failed to create decoding key from JWK: {}", e);
        AuthnError::invalid_credentials("invalid JWK")
    })
}

/// Validate a JWT token against the configured OIDC provider.
///
/// 1. Decode JWT header to get key ID (kid)
/// 2. Fetch JWKS from configured endpoint
/// 3. Validate signature using appropriate key
/// 4. Validate claims (exp, iss, aud)
/// 5. Extract principal info from claims
async fn validate_jwt_token(
    token: &str,
    default_tenant_id: &str,
    oidc_config: &OidcConfig,
) -> Result<Option<Principal>, AuthnError> {
    debug!("Validating Bearer token");

    // Decode header to get kid
    let header = decode_header(token).map_err(|e| {
        debug!("Failed to decode JWT header: {}", e);
        AuthnError::invalid_credentials("malformed JWT")
    })?;

    // Determine JWKS URL
    let jwks_url = match &oidc_config.jwks_url {
        Some(url) => url.clone(),
        None => format!(
            "{}/protocol/openid-connect/certs",
            oidc_config.issuer_url.trim_end_matches('/')
        ),
    };

    // Fetch JWKS
    let keys = fetch_jwks(&jwks_url).await?;

    // Find the right key
    let jwk = find_key_for_kid(&keys, header.kid.as_deref()).ok_or_else(|| {
        debug!("No matching key found for kid: {:?}", header.kid);
        AuthnError::invalid_credentials("no matching key found")
    })?;

    // Create decoding key
    let decoding_key = decoding_key_from_jwk(jwk)?;

    // Setup validation
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[&oidc_config.issuer_url]);
    // Keycloak puts audience in 'aud' claim - can be "account" or client_id
    // We accept the configured audience
    validation.set_audience(&[&oidc_config.audience]);

    // Decode and validate token
    let token_data = decode::<JwtClaims>(token, &decoding_key, &validation).map_err(|e| {
        debug!("JWT validation failed: {}", e);
        AuthnError::invalid_credentials(format!("invalid token: {}", e))
    })?;

    let claims = token_data.claims;

    // Determine principal type and ID
    // Service accounts (client_credentials) have client_id claim
    // Users have preferred_username or email
    let (principal_id, principal_type) = if let Some(client_id) = &claims.client_id {
        // Service account (client_credentials grant)
        (
            format!("service-account-{}", client_id),
            PrincipalType::Service,
        )
    } else if let Some(username) = &claims.preferred_username {
        // Human user
        (username.clone(), PrincipalType::User)
    } else {
        // Fallback to sub claim
        (claims.sub.clone(), PrincipalType::User)
    };

    // Build claims map for the principal
    let mut principal_claims = HashMap::new();
    principal_claims.insert("sub".to_string(), serde_json::json!(claims.sub));
    principal_claims.insert("iss".to_string(), serde_json::json!(claims.iss));

    if let Some(azp) = &claims.azp {
        principal_claims.insert("azp".to_string(), serde_json::json!(azp));
    }
    if let Some(email) = &claims.email {
        principal_claims.insert("email".to_string(), serde_json::json!(email));
    }
    if let Some(realm_access) = &claims.realm_access {
        principal_claims.insert("roles".to_string(), serde_json::json!(realm_access.roles));
    }

    info!(
        principal_id = %principal_id,
        principal_type = %principal_type,
        issuer = %claims.iss,
        "JWT validated successfully"
    );

    Ok(Some(Principal {
        id: principal_id,
        principal_type,
        tenant_id: default_tenant_id.to_string(),
        claims: principal_claims,
    }))
}

/// Try to authenticate via Bearer token (Authorization header).
/// Returns None if no Bearer token present, or Err if token is invalid.
async fn try_bearer_token(
    auth_header_value: Option<&str>,
    default_tenant_id: &str,
    oidc_config: Option<&OidcConfig>,
) -> Result<Option<Principal>, AuthnError> {
    // Quick check: if no Authorization header, skip
    let auth_str = match auth_header_value {
        Some(s) => s,
        None => return Ok(None),
    };

    // Quick check: if not Bearer token, skip
    if !auth_str.starts_with("Bearer ") {
        return Ok(None);
    }

    let token = &auth_str[7..];

    // We have a Bearer token - need OIDC config to validate
    let oidc = oidc_config.ok_or_else(|| {
        warn!("Bearer token provided but OIDC not configured");
        AuthnError::invalid_credentials("OIDC authentication not configured")
    })?;

    validate_jwt_token(token, default_tenant_id, oidc).await
}

/// Try to authenticate via API key (X-API-Key header).
///
/// TODO: Implement actual API key validation against a key store.
/// Currently returns None (no API key auth implemented yet).
fn try_api_key_from_header(
    api_key_value: Option<&str>,
    _default_tenant_id: &str,
) -> Result<Option<Principal>, AuthnError> {
    if let Some(_api_key) = api_key_value {
        // TODO: Validate API key
        // 1. Look up key in API key store
        // 2. Verify key is valid and not expired
        // 3. Extract principal info from key metadata
        //
        // For now, we don't have an API key store, so we cannot validate keys.
        // Return an error indicating this is not yet implemented.
        return Err(AuthnError::invalid_credentials(
            "API key validation not yet implemented",
        ));
    }

    Ok(None)
}

/// Resolve tenant ID from request with clear precedence.
///
/// Precedence order (first match wins):
/// 1. X-Debug-Principal header (test mode only) - if it includes tenant segment
/// 2. X-Tenant-ID header - explicit tenant specification
/// 3. Default tenant - from server configuration
///
/// Returns error if:
/// - No tenant could be resolved
/// - Tenant ID format is invalid
pub fn resolve_tenant_id(
    request: &Request<Body>,
    default_tenant_id: &str,
    #[allow(unused_variables)] auth_config: &AuthConfig,
) -> Result<String, AuthnError> {
    // 1. Check X-Debug-Principal header for tenant (test mode only)
    #[cfg(feature = "test-auth")]
    if auth_config.is_test_auth_enabled() {
        if let Some(header_value) = request
            .headers()
            .get(DEBUG_PRINCIPAL_HEADER)
            .and_then(|v| v.to_str().ok())
        {
            let parts: Vec<&str> = header_value.split(':').collect();
            if parts.len() >= 3 {
                // Has tenant segment: type:id:tenant
                let tenant_id = parts[2];
                validate_tenant_id(tenant_id)?;
                return Ok(tenant_id.to_string());
            }
        }
    }

    // 2. Check X-Tenant-ID header
    if let Some(tenant_header) = request.headers().get(TENANT_ID_HEADER) {
        let tenant_id = tenant_header
            .to_str()
            .map_err(|_| AuthnError::malformed("invalid X-Tenant-ID header encoding"))?;
        validate_tenant_id(tenant_id)?;
        return Ok(tenant_id.to_string());
    }

    // 3. Use default tenant
    if default_tenant_id.is_empty() {
        return Err(AuthnError {
            reason: "no tenant could be resolved".to_string(),
            status: StatusCode::BAD_REQUEST,
        });
    }

    validate_tenant_id(default_tenant_id)?;
    Ok(default_tenant_id.to_string())
}

/// Validate tenant ID format.
///
/// Valid tenant IDs:
/// - Start with alphanumeric character
/// - Contain only alphanumeric, hyphens, underscores
/// - 1-64 characters long
fn validate_tenant_id(tenant_id: &str) -> Result<(), AuthnError> {
    if tenant_id.is_empty() {
        return Err(AuthnError {
            reason: "tenant ID is empty".to_string(),
            status: StatusCode::BAD_REQUEST,
        });
    }

    if tenant_id.len() > 64 {
        return Err(AuthnError {
            reason: "tenant ID exceeds maximum length (64 characters)".to_string(),
            status: StatusCode::BAD_REQUEST,
        });
    }

    // Check first character is alphanumeric
    let first_char = tenant_id.chars().next().unwrap();
    if !first_char.is_ascii_alphanumeric() {
        return Err(AuthnError {
            reason: "tenant ID must start with alphanumeric character".to_string(),
            status: StatusCode::BAD_REQUEST,
        });
    }

    // Check all characters are valid (alphanumeric, hyphen, underscore)
    for c in tenant_id.chars() {
        if !c.is_ascii_alphanumeric() && c != '-' && c != '_' {
            return Err(AuthnError {
                reason: format!(
                    "tenant ID contains invalid character '{}' (only alphanumeric, hyphen, underscore allowed)",
                    c
                ),
                status: StatusCode::BAD_REQUEST,
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_principal_creation() {
        let p = Principal::user("user-123", "tenant-001");
        assert_eq!(p.id, "user-123");
        assert_eq!(p.principal_type, PrincipalType::User);
        assert_eq!(p.tenant_id, "tenant-001");
        assert!(p.claims.is_empty());
    }

    #[test]
    fn test_principal_with_claims() {
        let p = Principal::user("user-123", "tenant-001")
            .with_claim("role", serde_json::json!("admin"))
            .with_claim("department", serde_json::json!("engineering"));

        assert_eq!(p.claims.len(), 2);
        assert_eq!(p.claims.get("role"), Some(&serde_json::json!("admin")));
    }

    #[test]
    fn test_principal_to_policy_attributes() {
        let p = Principal::user("user-123", "tenant-001")
            .with_claim("role", serde_json::json!("admin"));

        let attrs = p.to_policy_attributes();

        assert_eq!(attrs.get("id"), Some(&serde_json::json!("user-123")));
        assert_eq!(attrs.get("type"), Some(&serde_json::json!("user")));
        assert_eq!(attrs.get("tenant_id"), Some(&serde_json::json!("tenant-001")));
        assert_eq!(attrs.get("role"), Some(&serde_json::json!("admin")));
    }

    #[test]
    fn test_auth_config_default() {
        let config = AuthConfig::default();
        // Without test-auth feature, test auth is always disabled
        assert!(!config.is_test_auth_enabled());
    }

    #[cfg(feature = "test-auth")]
    mod test_auth_tests {
        use super::*;

        #[test]
        fn test_parse_debug_principal_user() {
            let p = parse_debug_principal("user:123", "default-tenant").unwrap();
            assert_eq!(p.id, "123");
            assert_eq!(p.principal_type, PrincipalType::User);
            assert_eq!(p.tenant_id, "default-tenant");
        }

        #[test]
        fn test_parse_debug_principal_service() {
            let p = parse_debug_principal("service:batch-worker", "default-tenant").unwrap();
            assert_eq!(p.id, "batch-worker");
            assert_eq!(p.principal_type, PrincipalType::Service);
        }

        #[test]
        fn test_parse_debug_principal_with_tenant() {
            let p = parse_debug_principal("user:456:custom-tenant", "default-tenant").unwrap();
            assert_eq!(p.id, "456");
            assert_eq!(p.tenant_id, "custom-tenant");
        }

        #[test]
        fn test_parse_debug_principal_invalid() {
            assert!(parse_debug_principal("", "default").is_none());
            assert!(parse_debug_principal("invalid", "default").is_none());
            assert!(parse_debug_principal("unknown:123", "default").is_none());
        }

        #[test]
        fn test_auth_config_with_test_auth() {
            let config = AuthConfig::new().with_test_auth(true);
            assert!(config.is_test_auth_enabled());

            let config = AuthConfig::new().with_test_auth(false);
            assert!(!config.is_test_auth_enabled());
        }
    }

    mod tenant_validation_tests {
        use super::*;

        #[test]
        fn test_validate_tenant_id_valid() {
            assert!(validate_tenant_id("tenant-001").is_ok());
            assert!(validate_tenant_id("Tenant_123").is_ok());
            assert!(validate_tenant_id("a").is_ok());
            assert!(validate_tenant_id("A1-b2_c3").is_ok());
        }

        #[test]
        fn test_validate_tenant_id_empty() {
            let result = validate_tenant_id("");
            assert!(result.is_err());
            assert!(result.unwrap_err().reason.contains("empty"));
        }

        #[test]
        fn test_validate_tenant_id_too_long() {
            let long_id = "a".repeat(65);
            let result = validate_tenant_id(&long_id);
            assert!(result.is_err());
            assert!(result.unwrap_err().reason.contains("maximum length"));
        }

        #[test]
        fn test_validate_tenant_id_invalid_start() {
            assert!(validate_tenant_id("-tenant").is_err());
            assert!(validate_tenant_id("_tenant").is_err());
            assert!(validate_tenant_id("123").is_ok()); // numbers are alphanumeric
        }

        #[test]
        fn test_validate_tenant_id_invalid_chars() {
            assert!(validate_tenant_id("tenant.001").is_err()); // dot not allowed
            assert!(validate_tenant_id("tenant 001").is_err()); // space not allowed
            assert!(validate_tenant_id("tenant@001").is_err()); // @ not allowed
        }
    }
}
