//! Keycloak OIDC client for authentication testing.
//!
//! This module provides utilities for minting access tokens from Keycloak
//! using the client_credentials grant flow. It's used by authentication
//! blackbox tests to obtain real JWT tokens for testing ingress validation.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::time::Duration;

/// Keycloak OIDC client for minting access tokens.
#[derive(Clone)]
pub struct KeycloakClient {
    /// Base URL of Keycloak (e.g., "http://localhost:8081")
    base_url: String,
    /// Realm name (e.g., "atlas")
    realm: String,
    /// Client ID for client_credentials grant
    client_id: String,
    /// Client secret
    client_secret: String,
    /// HTTP client
    http_client: reqwest::Client,
}

/// Token response from Keycloak's token endpoint.
#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: u64,
    pub token_type: String,
    #[serde(default)]
    pub scope: Option<String>,
}

/// OIDC discovery document (partial).
#[derive(Debug, Deserialize)]
pub struct OidcDiscovery {
    pub issuer: String,
    pub token_endpoint: String,
    pub jwks_uri: String,
}

impl KeycloakClient {
    /// Create a new Keycloak client with the given configuration.
    pub fn new(
        base_url: impl Into<String>,
        realm: impl Into<String>,
        client_id: impl Into<String>,
        client_secret: impl Into<String>,
    ) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            base_url: base_url.into(),
            realm: realm.into(),
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            http_client,
        }
    }

    /// Create a Keycloak client from environment variables.
    ///
    /// Expects:
    /// - `KEYCLOAK_BASE_URL` (default: "http://localhost:8081")
    /// - `KEYCLOAK_REALM` (default: "atlas")
    /// - `KEYCLOAK_CLIENT_ID` (default: "atlas-s2s")
    /// - `KEYCLOAK_CLIENT_SECRET` (required for token minting)
    pub fn from_env() -> Option<Self> {
        let base_url = std::env::var("KEYCLOAK_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:8081".to_string());
        let realm = std::env::var("KEYCLOAK_REALM")
            .unwrap_or_else(|_| "atlas".to_string());
        let client_id = std::env::var("KEYCLOAK_CLIENT_ID")
            .unwrap_or_else(|_| "atlas-s2s".to_string());
        let client_secret = std::env::var("KEYCLOAK_CLIENT_SECRET").ok()?;

        Some(Self::new(base_url, realm, client_id, client_secret))
    }

    /// Get the token endpoint URL for this realm.
    pub fn token_endpoint(&self) -> String {
        format!(
            "{}/realms/{}/protocol/openid-connect/token",
            self.base_url, self.realm
        )
    }

    /// Get the OIDC discovery endpoint URL.
    pub fn discovery_endpoint(&self) -> String {
        format!(
            "{}/realms/{}/.well-known/openid-configuration",
            self.base_url, self.realm
        )
    }

    /// Fetch the OIDC discovery document.
    pub async fn discover(&self) -> Result<OidcDiscovery> {
        let url = self.discovery_endpoint();
        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .context("Failed to fetch OIDC discovery document")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!(
                "OIDC discovery failed with status {}: {}",
                status,
                body
            );
        }

        response
            .json()
            .await
            .context("Failed to parse OIDC discovery document")
    }

    /// Mint an access token using the client_credentials grant.
    ///
    /// This is the primary method for obtaining tokens for testing.
    /// The token will be signed by Keycloak and can be validated by ingress.
    pub async fn mint_token(&self) -> Result<TokenResponse> {
        let url = self.token_endpoint();

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
            ])
            .send()
            .await
            .context("Failed to send token request")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!(
                "Token request failed with status {}: {}",
                status,
                body
            );
        }

        response
            .json()
            .await
            .context("Failed to parse token response")
    }

    /// Check if Keycloak is available and the realm exists.
    ///
    /// Uses the discovery endpoint as a health check.
    /// Returns Ok(()) if Keycloak is reachable and the realm is configured.
    pub async fn health_check(&self) -> Result<()> {
        self.discover().await?;
        Ok(())
    }

    /// Wait for Keycloak to become available with retries.
    ///
    /// This is useful at the start of tests when services may still be starting.
    pub async fn wait_for_ready(&self, max_attempts: u32, delay: Duration) -> Result<()> {
        for attempt in 1..=max_attempts {
            match self.health_check().await {
                Ok(()) => return Ok(()),
                Err(e) if attempt < max_attempts => {
                    eprintln!(
                        "Keycloak not ready (attempt {}/{}): {}",
                        attempt, max_attempts, e
                    );
                    tokio::time::sleep(delay).await;
                }
                Err(e) => {
                    anyhow::bail!(
                        "Keycloak not ready after {} attempts: {}",
                        max_attempts,
                        e
                    );
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_endpoint_construction() {
        let client = KeycloakClient::new(
            "http://localhost:8081",
            "atlas",
            "atlas-s2s",
            "secret",
        );

        assert_eq!(
            client.token_endpoint(),
            "http://localhost:8081/realms/atlas/protocol/openid-connect/token"
        );
    }

    #[test]
    fn test_discovery_endpoint_construction() {
        let client = KeycloakClient::new(
            "http://localhost:8081",
            "atlas",
            "atlas-s2s",
            "secret",
        );

        assert_eq!(
            client.discovery_endpoint(),
            "http://localhost:8081/realms/atlas/.well-known/openid-configuration"
        );
    }
}
