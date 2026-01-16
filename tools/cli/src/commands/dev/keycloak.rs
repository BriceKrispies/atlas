//! Keycloak setup commands for local development.

use crate::commands::Command;
use anyhow::{Context, Result};
use clap::Args;
use colored::Colorize;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Setup Keycloak for local development.
///
/// Creates the atlas realm, frontend client (for browser PKCE), service client,
/// and a test user.
#[derive(Debug, Args)]
pub struct KeycloakSetupCommand {
    /// Keycloak base URL
    #[arg(long, default_value = "http://localhost:8081")]
    pub keycloak_url: String,

    /// Admin username
    #[arg(long, default_value = "admin")]
    pub admin_user: String,

    /// Admin password
    #[arg(long, default_value = "admin")]
    pub admin_password: String,

    /// Realm name to create
    #[arg(long, default_value = "atlas")]
    pub realm: String,

    /// Frontend redirect URI (Vite dev server)
    #[arg(long, default_value = "http://localhost:5173")]
    pub frontend_url: String,

    /// Skip creating test user
    #[arg(long)]
    pub skip_user: bool,

    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Serialize)]
struct RealmConfig {
    realm: String,
    enabled: bool,
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(rename = "registrationAllowed")]
    registration_allowed: bool,
    #[serde(rename = "loginWithEmailAllowed")]
    login_with_email_allowed: bool,
    #[serde(rename = "duplicateEmailsAllowed")]
    duplicate_emails_allowed: bool,
    #[serde(rename = "resetPasswordAllowed")]
    reset_password_allowed: bool,
    #[serde(rename = "editUsernameAllowed")]
    edit_username_allowed: bool,
    #[serde(rename = "bruteForceProtected")]
    brute_force_protected: bool,
}

#[derive(Serialize)]
struct ClientConfig {
    #[serde(rename = "clientId")]
    client_id: String,
    name: String,
    description: String,
    enabled: bool,
    #[serde(rename = "publicClient")]
    public_client: bool,
    #[serde(rename = "standardFlowEnabled")]
    standard_flow_enabled: bool,
    #[serde(rename = "directAccessGrantsEnabled")]
    direct_access_grants_enabled: bool,
    #[serde(rename = "serviceAccountsEnabled")]
    service_accounts_enabled: bool,
    #[serde(rename = "authorizationServicesEnabled")]
    authorization_services_enabled: bool,
    #[serde(rename = "redirectUris")]
    redirect_uris: Vec<String>,
    #[serde(rename = "webOrigins")]
    web_origins: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    secret: Option<String>,
    attributes: std::collections::HashMap<String, String>,
    protocol: String,
    #[serde(rename = "fullScopeAllowed")]
    full_scope_allowed: bool,
}

#[derive(Serialize)]
struct UserConfig {
    username: String,
    email: String,
    #[serde(rename = "firstName")]
    first_name: String,
    #[serde(rename = "lastName")]
    last_name: String,
    enabled: bool,
    #[serde(rename = "emailVerified")]
    email_verified: bool,
    credentials: Vec<CredentialConfig>,
}

#[derive(Serialize)]
struct CredentialConfig {
    #[serde(rename = "type")]
    cred_type: String,
    value: String,
    temporary: bool,
}

#[derive(Serialize)]
struct SetupResult {
    realm: String,
    clients: Vec<String>,
    user: Option<String>,
}

impl Command for KeycloakSetupCommand {
    fn execute(&self) -> Result<()> {
        if !self.json {
            println!("{}", "Setting up Keycloak for local development...".cyan().bold());
            println!("  Keycloak URL: {}", self.keycloak_url);
            println!("  Realm: {}", self.realm);
            println!("  Frontend URL: {}", self.frontend_url);
            println!();
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;

        // Get admin token
        if !self.json {
            print!("1. Getting admin token... ");
        }
        let token = self.get_admin_token(&client)?;
        if !self.json {
            println!("{}", "✓".green());
        }

        // Create realm if needed
        if !self.json {
            print!("2. Checking realm '{}'... ", self.realm);
        }
        let realm_created = self.ensure_realm(&client, &token)?;
        if !self.json {
            if realm_created {
                println!("{} (created)", "✓".green());
            } else {
                println!("{} (exists)", "✓".green());
            }
        }

        // Create frontend client
        if !self.json {
            print!("3. Checking client 'atlas-frontend'... ");
        }
        let frontend_created = self.ensure_frontend_client(&client, &token)?;
        if !self.json {
            if frontend_created {
                println!("{} (created)", "✓".green());
            } else {
                println!("{} (exists)", "✓".green());
            }
        }

        // Create service client
        if !self.json {
            print!("4. Checking client 'atlas-s2s'... ");
        }
        let s2s_created = self.ensure_service_client(&client, &token)?;
        if !self.json {
            if s2s_created {
                println!("{} (created)", "✓".green());
            } else {
                println!("{} (exists)", "✓".green());
            }
        }

        // Create test user
        if !self.skip_user {
            if !self.json {
                print!("5. Checking user 'testuser'... ");
            }
            let user_created = self.ensure_test_user(&client, &token)?;
            if !self.json {
                if user_created {
                    println!("{} (created)", "✓".green());
                } else {
                    println!("{} (exists)", "✓".green());
                }
            }
        }

        if self.json {
            let result = SetupResult {
                realm: self.realm.clone(),
                clients: vec!["atlas-frontend".to_string(), "atlas-s2s".to_string()],
                user: if self.skip_user { None } else { Some("testuser".to_string()) },
            };
            println!("{}", serde_json::to_string_pretty(&result)?);
        } else {
            println!();
            println!("{}", "=== Setup Complete ===".green().bold());
            println!();
            println!("{}", "Clients:".bold());
            println!("  atlas-frontend  Public client for browser PKCE auth");
            println!("  atlas-s2s       Confidential client for service auth");
            println!();
            if !self.skip_user {
                println!("{}", "Test User:".bold());
                println!("  Username: testuser");
                println!("  Password: testpass");
                println!();
            }
            println!("{}", "Frontend:".bold());
            println!("  cd frontend && npm install && npm run dev");
            println!("  Open http://localhost:5173");
        }

        Ok(())
    }
}

impl KeycloakSetupCommand {
    fn get_admin_token(&self, client: &Client) -> Result<String> {
        let response = client
            .post(format!(
                "{}/realms/master/protocol/openid-connect/token",
                self.keycloak_url
            ))
            .form(&[
                ("username", self.admin_user.as_str()),
                ("password", self.admin_password.as_str()),
                ("grant_type", "password"),
                ("client_id", "admin-cli"),
            ])
            .send()
            .context("Failed to connect to Keycloak. Is it running?")?;

        if !response.status().is_success() {
            anyhow::bail!(
                "Failed to get admin token: {} - Check admin credentials",
                response.status()
            );
        }

        let token_response: TokenResponse = response.json()?;
        Ok(token_response.access_token)
    }

    fn ensure_realm(&self, client: &Client, token: &str) -> Result<bool> {
        // Check if realm exists
        let response = client
            .get(format!("{}/admin/realms/{}", self.keycloak_url, self.realm))
            .bearer_auth(token)
            .send()?;

        if response.status().is_success() {
            return Ok(false); // Already exists
        }

        if response.status().as_u16() != 404 {
            anyhow::bail!("Unexpected error checking realm: {}", response.status());
        }

        // Create realm
        let realm_config = RealmConfig {
            realm: self.realm.clone(),
            enabled: true,
            display_name: "Atlas Platform".to_string(),
            registration_allowed: false,
            login_with_email_allowed: true,
            duplicate_emails_allowed: false,
            reset_password_allowed: true,
            edit_username_allowed: false,
            brute_force_protected: true,
        };

        let response = client
            .post(format!("{}/admin/realms", self.keycloak_url))
            .bearer_auth(token)
            .json(&realm_config)
            .send()?;

        if !response.status().is_success() {
            anyhow::bail!("Failed to create realm: {}", response.status());
        }

        Ok(true)
    }

    fn ensure_frontend_client(&self, client: &Client, token: &str) -> Result<bool> {
        // Check if client exists
        let response = client
            .get(format!(
                "{}/admin/realms/{}/clients?clientId=atlas-frontend",
                self.keycloak_url, self.realm
            ))
            .bearer_auth(token)
            .send()?;

        let clients: Vec<serde_json::Value> = response.json()?;
        if !clients.is_empty() {
            return Ok(false); // Already exists
        }

        // Create frontend client (public, PKCE)
        let mut attributes = std::collections::HashMap::new();
        attributes.insert("pkce.code.challenge.method".to_string(), "S256".to_string());

        let client_config = ClientConfig {
            client_id: "atlas-frontend".to_string(),
            name: "Atlas Frontend (Browser)".to_string(),
            description: "Public client for browser-based PKCE authentication".to_string(),
            enabled: true,
            public_client: true,
            standard_flow_enabled: true,
            direct_access_grants_enabled: false,
            service_accounts_enabled: false,
            authorization_services_enabled: false,
            redirect_uris: vec![format!("{}/*", self.frontend_url)],
            web_origins: vec![self.frontend_url.clone()],
            secret: None,
            attributes,
            protocol: "openid-connect".to_string(),
            full_scope_allowed: true,
        };

        let response = client
            .post(format!(
                "{}/admin/realms/{}/clients",
                self.keycloak_url, self.realm
            ))
            .bearer_auth(token)
            .json(&client_config)
            .send()?;

        if !response.status().is_success() {
            anyhow::bail!("Failed to create frontend client: {}", response.status());
        }

        Ok(true)
    }

    fn ensure_service_client(&self, client: &Client, token: &str) -> Result<bool> {
        // Check if client exists
        let response = client
            .get(format!(
                "{}/admin/realms/{}/clients?clientId=atlas-s2s",
                self.keycloak_url, self.realm
            ))
            .bearer_auth(token)
            .send()?;

        let clients: Vec<serde_json::Value> = response.json()?;
        if !clients.is_empty() {
            return Ok(false); // Already exists
        }

        // Create service client (confidential, service accounts)
        let client_config = ClientConfig {
            client_id: "atlas-s2s".to_string(),
            name: "Atlas Service-to-Service".to_string(),
            description: "Confidential client for backend service authentication".to_string(),
            enabled: true,
            public_client: false,
            standard_flow_enabled: false,
            direct_access_grants_enabled: false,
            service_accounts_enabled: true,
            authorization_services_enabled: false,
            redirect_uris: vec![],
            web_origins: vec![],
            secret: Some("sQgPBnIo4TyopWfovMHhq6PaMEALlFt0".to_string()),
            attributes: std::collections::HashMap::new(),
            protocol: "openid-connect".to_string(),
            full_scope_allowed: true,
        };

        let response = client
            .post(format!(
                "{}/admin/realms/{}/clients",
                self.keycloak_url, self.realm
            ))
            .bearer_auth(token)
            .json(&client_config)
            .send()?;

        if !response.status().is_success() {
            anyhow::bail!("Failed to create service client: {}", response.status());
        }

        Ok(true)
    }

    fn ensure_test_user(&self, client: &Client, token: &str) -> Result<bool> {
        // Check if user exists
        let response = client
            .get(format!(
                "{}/admin/realms/{}/users?username=testuser",
                self.keycloak_url, self.realm
            ))
            .bearer_auth(token)
            .send()?;

        let users: Vec<serde_json::Value> = response.json()?;
        if !users.is_empty() {
            return Ok(false); // Already exists
        }

        // Create test user
        let user_config = UserConfig {
            username: "testuser".to_string(),
            email: "testuser@example.com".to_string(),
            first_name: "Test".to_string(),
            last_name: "User".to_string(),
            enabled: true,
            email_verified: true,
            credentials: vec![CredentialConfig {
                cred_type: "password".to_string(),
                value: "testpass".to_string(),
                temporary: false,
            }],
        };

        let response = client
            .post(format!(
                "{}/admin/realms/{}/users",
                self.keycloak_url, self.realm
            ))
            .bearer_auth(token)
            .json(&user_config)
            .send()?;

        if !response.status().is_success() {
            anyhow::bail!("Failed to create test user: {}", response.status());
        }

        Ok(true)
    }
}
