use std::net::SocketAddr;
use std::sync::Once;

static INIT: Once = Once::new();

pub fn init_observability() {
    INIT.call_once(|| {
        tracing_subscriber::fmt()
            .json()
            .with_target(false)
            .with_current_span(false)
            .init();

        if let Ok(addr_str) = std::env::var("METRICS_ADDR") {
            if let Ok(addr) = addr_str.parse::<SocketAddr>() {
                std::thread::spawn(move || {
                    let builder = metrics_exporter_prometheus::PrometheusBuilder::new();
                    match builder.with_http_listener(addr).install() {
                        Ok(_) => tracing::info!("Metrics endpoint listening on {}", addr),
                        Err(e) => tracing::warn!("Failed to start metrics endpoint: {}", e),
                    }
                });
            }
        }
    });
}

#[doc(hidden)]
pub fn record_guardrail_metric(kind: &str, id: &str, component: &str) {
    let kind = kind.to_string();
    let id = id.to_string();
    let component = component.to_string();
    metrics::counter!(
        "guardrail_hits_total",
        "kind" => kind,
        "id" => id,
        "component" => component
    ).increment(1);
}

/// Records a guardrail event with structured logging and metrics.
///
/// This macro logs a warning-level event with guardrail metadata and increments
/// a corresponding Prometheus counter metric. Guardrails are used to track
/// intentional deviations from best practices, technical debt, or temporary shortcuts.
///
/// # Parameters
///
/// * `kind` - The type of guardrail (e.g., "tech_debt", "mvp_shortcut", "perf_workaround")
/// * `id` - A unique identifier for this specific guardrail
/// * `component` - The component or module where this guardrail is located
/// * `message` - A human-readable description of the guardrail
/// * `invariant` (optional) - A condition that must hold true for this guardrail to remain valid
/// * `expires` (optional) - An expiration date or milestone when this should be addressed
/// * `ticket` (optional) - A ticket/issue reference for tracking this guardrail
///
/// # Examples
///
/// Recording a performance workaround before using the workaround:
///
/// ```
/// use diagnostics::guardrail;
///
/// fn invalidate_user_cache(user_id: &str) {
///     guardrail!(
///         kind: "perf_workaround",
///         id: "cache_invalidation_001",
///         component: "user_service",
///         message: "Using global cache clear instead of selective invalidation"
///     );
///
///     // TODO: Replace with selective cache invalidation
///     CACHE.clear_all();
/// }
/// ```
///
/// Recording technical debt with tracking metadata:
///
/// ```
/// use diagnostics::guardrail;
///
/// async fn create_user(data: UserData) -> Result<User, Error> {
///     let user = User::new(data);
///
///     guardrail!(
///         kind: "tech_debt",
///         id: "db_schema_migration_002",
///         component: "database",
///         message: "Skipping foreign key constraint for legacy compatibility",
///         invariant: "Only affects tables created before v2.0",
///         expires: "2026-06-01",
///         ticket: "JIRA-1234"
///     );
///
///     // Insert without FK constraint check
///     db.insert_user_legacy(user).await
/// }
/// ```
#[macro_export]
macro_rules! guardrail {
    (
        kind: $kind:expr,
        id: $id:expr,
        component: $component:expr,
        message: $message:expr
        $(, invariant: $invariant:expr)?
        $(, expires: $expires:expr)?
        $(, ticket: $ticket:expr)?
        $(,)?
    ) => {{
        tracing::warn!(
            event = "guardrail",
            kind = $kind,
            id = $id,
            component = $component,
            message = $message
            $(, invariant = $invariant)?
            $(, expires = $expires)?
            $(, ticket = $ticket)?
        );

        $crate::record_guardrail_metric($kind, $id, $component);
    }};
}

/// Records a technical debt guardrail.
///
/// This is a convenience macro that wraps [`guardrail!`] with `kind: "tech_debt"`.
/// Use this to mark areas of the codebase that need refactoring, improvement, or
/// cleanup. Technical debt should be tracked and addressed over time to maintain
/// code quality and maintainability.
///
/// # Parameters
///
/// * `id` - A unique identifier for this technical debt item
/// * `component` - The component or module where this debt exists
/// * `message` - A description of what needs to be improved or refactored
/// * `invariant` (optional) - Conditions under which this debt is acceptable
/// * `expires` (optional) - When this debt should be addressed
/// * `ticket` (optional) - Issue tracker reference for this debt
///
/// # Examples
///
/// Marking error handling that needs improvement:
///
/// ```
/// use diagnostics::tech_debt;
///
/// fn authenticate(credentials: &Credentials) -> Result<Session, AuthError> {
///     match validate_credentials(credentials) {
///         Err(e) => {
///             tech_debt!(
///                 id: "auth_error_handling_001",
///                 component: "auth",
///                 message: "Error messages expose internal details, need sanitization"
///             );
///             // Returning raw internal error - should sanitize before exposing to client
///             Err(e)
///         }
///         Ok(user) => Ok(Session::new(user))
///     }
/// }
/// ```
///
/// Marking a known N+1 query problem with tracking:
///
/// ```
/// use diagnostics::tech_debt;
///
/// async fn get_users_with_permissions(ids: &[UserId]) -> Result<Vec<UserWithPermissions>> {
///     tech_debt!(
///         id: "n_plus_one_query_users",
///         component: "user_service",
///         message: "N+1 query when loading users with their permissions",
///         expires: "v2.0.0",
///         ticket: "PERF-456"
///     );
///
///     let mut results = Vec::new();
///     for id in ids {
///         let user = db.get_user(id).await?;
///         // This creates N+1 queries - should use a join or batch load
///         let permissions = db.get_permissions(id).await?;
///         results.push(UserWithPermissions { user, permissions });
///     }
///     Ok(results)
/// }
/// ```
#[macro_export]
macro_rules! tech_debt {
    (
        id: $id:expr,
        component: $component:expr,
        message: $message:expr
        $(, invariant: $invariant:expr)?
        $(, expires: $expires:expr)?
        $(, ticket: $ticket:expr)?
        $(,)?
    ) => {
        $crate::guardrail!(
            kind: "tech_debt",
            id: $id,
            component: $component,
            message: $message
            $(, invariant: $invariant)?
            $(, expires: $expires)?
            $(, ticket: $ticket)?
        );
    };
}

/// Records an MVP shortcut that should not exist in production code.
///
/// This macro wraps [`guardrail!`] with `kind: "mvp_shortcut"` and enforces
/// that shortcuts are only allowed in debug builds. In release builds, this
/// macro will cause a compile error unless the `allow_mvp_shortcuts` feature
/// is explicitly enabled.
///
/// MVP shortcuts are temporary implementations used to ship features quickly
/// but are not suitable for production use (e.g., hardcoded values, disabled
/// validation, mock implementations).
///
/// # Build Behavior
///
/// * **Debug builds**: Logs the shortcut as a guardrail warning
/// * **Release builds**: Compilation fails with an error
/// * **Release with `allow_mvp_shortcuts` feature**: Logs the shortcut (not recommended)
///
/// # Parameters
///
/// * `id` - A unique identifier for this MVP shortcut
/// * `component` - The component or module containing the shortcut
/// * `message` - Description of the shortcut and what it bypasses
/// * `invariant` (optional) - Conditions under which this shortcut is safe
/// * `expires` (optional) - Deadline for replacing this shortcut
/// * `ticket` (optional) - Tracking ticket for the proper implementation
///
/// # Examples
///
/// Marking a hardcoded API key that must be replaced before production:
///
/// ```
/// use diagnostics::mvp_shortcut;
///
/// async fn fetch_weather_data(location: &str) -> Result<WeatherData> {
///     mvp_shortcut!(
///         id: "hardcoded_api_key",
///         component: "external_service",
///         message: "Using hardcoded API key instead of config/secrets management"
///     );
///
///     // FIXME: Load from secure config/vault
///     let api_key = "demo_key_12345";
///
///     let client = WeatherClient::new(api_key);
///     client.get_weather(location).await
/// }
/// ```
///
/// Marking skipped security validation for MVP:
///
/// ```
/// use diagnostics::mvp_shortcut;
///
/// async fn register_user(email: &str, password: &str) -> Result<User> {
///     mvp_shortcut!(
///         id: "skip_email_verification",
///         component: "user_registration",
///         message: "Email verification disabled for MVP launch",
///         expires: "2026-03-01",
///         ticket: "SEC-789",
///         invariant: "Only acceptable for beta users"
///     );
///
///     let user = User::create(email, password);
///     // Skipping email verification step - must add before public launch
///     db.save_user(user).await
/// }
/// ```
#[macro_export]
#[cfg(debug_assertions)]
macro_rules! mvp_shortcut {
    (
        id: $id:expr,
        component: $component:expr,
        message: $message:expr
        $(, invariant: $invariant:expr)?
        $(, expires: $expires:expr)?
        $(, ticket: $ticket:expr)?
        $(,)?
    ) => {
        $crate::guardrail!(
            kind: "mvp_shortcut",
            id: $id,
            component: $component,
            message: $message
            $(, invariant: $invariant)?
            $(, expires: $expires)?
            $(, ticket: $ticket)?
        );
    };
}

#[macro_export]
#[cfg(all(not(debug_assertions), not(feature = "allow_mvp_shortcuts")))]
macro_rules! mvp_shortcut {
    (
        id: $id:expr,
        component: $component:expr,
        message: $message:expr
        $(, invariant: $invariant:expr)?
        $(, expires: $expires:expr)?
        $(, ticket: $ticket:expr)?
        $(,)?
    ) => {
        compile_error!("mvp_shortcut! used in release build without allow_mvp_shortcuts feature");
    };
}

#[macro_export]
#[cfg(all(not(debug_assertions), feature = "allow_mvp_shortcuts"))]
macro_rules! mvp_shortcut {
    (
        id: $id:expr,
        component: $component:expr,
        message: $message:expr
        $(, invariant: $invariant:expr)?
        $(, expires: $expires:expr)?
        $(, ticket: $ticket:expr)?
        $(,)?
    ) => {
        $crate::guardrail!(
            kind: "mvp_shortcut",
            id: $id,
            component: $component,
            message: $message
            $(, invariant: $invariant)?
            $(, expires: $expires)?
            $(, ticket: $ticket)?
        );
    };
}
