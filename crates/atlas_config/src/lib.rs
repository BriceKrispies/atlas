//! Atlas environment configuration and strict mode handling.
//!
//! This crate provides a consistent way to handle environment variables across Atlas services.
//! It enforces strict-by-default behavior: all required configuration must be explicitly set
//! unless the service is running in dev mode (`ATLAS_ENV=dev`).
//!
//! # Environment Modes
//!
//! - **Strict (default)**: All required environment variables must be set. Missing variables
//!   cause immediate, clear errors. This is the production behavior.
//! - **Dev**: Allows fallback defaults for convenience during local development. Enabled only
//!   when `ATLAS_ENV=dev` is explicitly set.
//!
//! # Usage
//!
//! ```rust,ignore
//! use atlas_config::{atlas_env, AtlasEnv, require_env, get_env_or_dev};
//!
//! // Check current mode
//! match atlas_env() {
//!     AtlasEnv::Dev => println!("Running in dev mode"),
//!     AtlasEnv::Strict => println!("Running in strict/production mode"),
//! }
//!
//! // Required variable - fails in strict mode if not set
//! let db_url = require_env("DATABASE_URL")?;
//!
//! // Dev-only default - fails in strict mode if not set, uses default in dev
//! let port = get_env_or_dev("PORT", "8080");
//! ```

use std::env;
use thiserror::Error;
use tracing::{info, warn};

/// Errors that can occur when accessing configuration.
#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("Required environment variable '{key}' is not set. Running in strict mode (ATLAS_ENV != 'dev'). Set the variable or use ATLAS_ENV=dev for development.")]
    MissingRequired { key: String },

    #[error("Environment variable '{key}' is empty. A non-empty value is required.")]
    EmptyValue { key: String },

    #[error("Environment variable '{key}' is forbidden in strict mode. {reason}")]
    ForbiddenInStrict { key: String, reason: String },
}

/// The environment mode Atlas is running in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AtlasEnv {
    /// Development mode - allows fallback defaults, relaxed validation.
    /// Only active when `ATLAS_ENV=dev` is explicitly set.
    Dev,
    /// Strict/production mode - all required config must be explicitly set.
    /// This is the default when `ATLAS_ENV` is unset or has any value other than "dev".
    Strict,
}

impl AtlasEnv {
    /// Returns true if running in dev mode.
    pub fn is_dev(&self) -> bool {
        matches!(self, AtlasEnv::Dev)
    }

    /// Returns true if running in strict mode.
    pub fn is_strict(&self) -> bool {
        matches!(self, AtlasEnv::Strict)
    }
}

impl std::fmt::Display for AtlasEnv {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AtlasEnv::Dev => write!(f, "dev"),
            AtlasEnv::Strict => write!(f, "strict"),
        }
    }
}

/// Returns the current Atlas environment mode.
///
/// - Returns `AtlasEnv::Dev` only if `ATLAS_ENV` is set to exactly "dev"
/// - Returns `AtlasEnv::Strict` in all other cases (unset, empty, or any other value)
///
/// This ensures strict/production behavior is the default.
pub fn atlas_env() -> AtlasEnv {
    match env::var("ATLAS_ENV") {
        Ok(val) if val == "dev" => AtlasEnv::Dev,
        _ => AtlasEnv::Strict,
    }
}

/// Requires an environment variable to be set and non-empty.
///
/// In strict mode, this will return an error with a clear message if the variable
/// is missing or empty. In dev mode, this still requires the variable but the error
/// message notes that dev mode is active.
///
/// Use this for configuration that must always be explicitly provided.
pub fn require_env(key: &str) -> Result<String, ConfigError> {
    match env::var(key) {
        Ok(val) if val.is_empty() => Err(ConfigError::EmptyValue { key: key.to_string() }),
        Ok(val) => Ok(val),
        Err(_) => Err(ConfigError::MissingRequired { key: key.to_string() }),
    }
}

/// Gets an environment variable with a dev-only fallback default.
///
/// - In **dev mode**: Returns the env var if set, otherwise returns the default and logs a warning.
/// - In **strict mode**: Returns an error if the env var is not set (ignores the default).
///
/// Use this sparingly - prefer `require_env` for most configuration. This is intended
/// for values where a sensible default exists for local development only.
pub fn get_env_or_dev(key: &str, dev_default: &str) -> Result<String, ConfigError> {
    match env::var(key) {
        Ok(val) if !val.is_empty() => Ok(val),
        Ok(_) | Err(_) => {
            if atlas_env().is_dev() {
                warn!(
                    key = key,
                    default = dev_default,
                    "Using dev-only default for environment variable"
                );
                Ok(dev_default.to_string())
            } else {
                Err(ConfigError::MissingRequired { key: key.to_string() })
            }
        }
    }
}

/// Gets an optional environment variable.
///
/// Returns `Some(value)` if the variable is set and non-empty, `None` otherwise.
/// This is for truly optional configuration that doesn't require a value.
pub fn get_env_optional(key: &str) -> Option<String> {
    env::var(key).ok().filter(|v| !v.is_empty())
}

/// Checks if an environment variable is set to a truthy value.
///
/// Returns `true` if the variable is set to "true", "1", or "yes" (case-insensitive).
/// Returns `false` for any other value or if unset.
pub fn is_env_enabled(key: &str) -> bool {
    env::var(key)
        .map(|v| matches!(v.to_lowercase().as_str(), "true" | "1" | "yes"))
        .unwrap_or(false)
}

/// Asserts that a variable is NOT set in strict mode.
///
/// Use this for configuration that should only be used in dev/test mode and
/// must not be relied upon in production.
pub fn forbid_in_strict(key: &str, reason: &str) -> Result<(), ConfigError> {
    if atlas_env().is_strict() && env::var(key).is_ok() {
        Err(ConfigError::ForbiddenInStrict {
            key: key.to_string(),
            reason: reason.to_string(),
        })
    } else {
        Ok(())
    }
}

/// Logs the current environment mode at startup.
///
/// Call this once at service startup to make the mode visible in logs.
pub fn log_env_mode() {
    let mode = atlas_env();
    match mode {
        AtlasEnv::Dev => {
            warn!(
                mode = %mode,
                "Atlas running in DEV mode - using relaxed configuration. NOT for production!"
            );
        }
        AtlasEnv::Strict => {
            info!(
                mode = %mode,
                "Atlas running in STRICT mode - all configuration must be explicit"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn with_env<F, R>(key: &str, value: Option<&str>, f: F) -> R
    where
        F: FnOnce() -> R,
    {
        let original = env::var(key).ok();
        match value {
            Some(v) => env::set_var(key, v),
            None => env::remove_var(key),
        }
        let result = f();
        match original {
            Some(v) => env::set_var(key, v),
            None => env::remove_var(key),
        }
        result
    }

    #[test]
    fn test_atlas_env_strict_by_default() {
        with_env("ATLAS_ENV", None, || {
            assert_eq!(atlas_env(), AtlasEnv::Strict);
        });
    }

    #[test]
    fn test_atlas_env_strict_for_other_values() {
        with_env("ATLAS_ENV", Some("production"), || {
            assert_eq!(atlas_env(), AtlasEnv::Strict);
        });
        with_env("ATLAS_ENV", Some(""), || {
            assert_eq!(atlas_env(), AtlasEnv::Strict);
        });
    }

    #[test]
    fn test_atlas_env_dev_when_set() {
        with_env("ATLAS_ENV", Some("dev"), || {
            assert_eq!(atlas_env(), AtlasEnv::Dev);
        });
    }

    #[test]
    fn test_require_env_present() {
        with_env("TEST_VAR", Some("value"), || {
            assert_eq!(require_env("TEST_VAR").unwrap(), "value");
        });
    }

    #[test]
    fn test_require_env_missing() {
        with_env("TEST_VAR", None, || {
            assert!(require_env("TEST_VAR").is_err());
        });
    }

    #[test]
    fn test_require_env_empty() {
        with_env("TEST_VAR", Some(""), || {
            assert!(matches!(
                require_env("TEST_VAR"),
                Err(ConfigError::EmptyValue { .. })
            ));
        });
    }

    #[test]
    fn test_get_env_or_dev_in_dev_mode() {
        with_env("ATLAS_ENV", Some("dev"), || {
            with_env("TEST_VAR", None, || {
                assert_eq!(get_env_or_dev("TEST_VAR", "default").unwrap(), "default");
            });
        });
    }

    #[test]
    fn test_get_env_or_dev_in_strict_mode() {
        with_env("ATLAS_ENV", None, || {
            with_env("TEST_VAR", None, || {
                assert!(get_env_or_dev("TEST_VAR", "default").is_err());
            });
        });
    }

    #[test]
    fn test_is_env_enabled() {
        with_env("TEST_FLAG", Some("true"), || {
            assert!(is_env_enabled("TEST_FLAG"));
        });
        with_env("TEST_FLAG", Some("1"), || {
            assert!(is_env_enabled("TEST_FLAG"));
        });
        with_env("TEST_FLAG", Some("false"), || {
            assert!(!is_env_enabled("TEST_FLAG"));
        });
        with_env("TEST_FLAG", None, || {
            assert!(!is_env_enabled("TEST_FLAG"));
        });
    }

    #[test]
    fn test_forbid_in_strict() {
        with_env("ATLAS_ENV", None, || {
            with_env("FORBIDDEN_VAR", Some("value"), || {
                assert!(forbid_in_strict("FORBIDDEN_VAR", "testing").is_err());
            });
            with_env("FORBIDDEN_VAR", None, || {
                assert!(forbid_in_strict("FORBIDDEN_VAR", "testing").is_ok());
            });
        });
    }

    #[test]
    fn test_forbid_in_strict_allowed_in_dev() {
        with_env("ATLAS_ENV", Some("dev"), || {
            with_env("FORBIDDEN_VAR", Some("value"), || {
                assert!(forbid_in_strict("FORBIDDEN_VAR", "testing").is_ok());
            });
        });
    }
}
