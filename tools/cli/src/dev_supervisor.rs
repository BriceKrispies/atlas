use anyhow::{Context, Result};
use colored::Colorize;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

/// Default environment variables for local development.
/// These are injected by the CLI when starting compose in dev mode.
pub struct DevEnvConfig {
    // Core settings
    pub atlas_env: &'static str,

    // Postgres settings
    pub postgres_db: &'static str,
    pub postgres_user: &'static str,
    pub postgres_password: &'static str,
    pub postgres_port: &'static str,

    // pgAdmin settings
    pub pgadmin_email: &'static str,
    pub pgadmin_password: &'static str,
    pub pgadmin_port: &'static str,

    // Control plane settings
    pub control_plane_port: &'static str,
    pub rust_log: &'static str,

    // Tenant ID for dev mode (only used in dev)
    pub tenant_id: &'static str,

    // Keycloak settings
    pub keycloak_admin: &'static str,
    pub keycloak_admin_password: &'static str,
    pub keycloak_port: &'static str,

    // OIDC settings (for dev)
    pub oidc_issuer_url: &'static str,
    pub oidc_jwks_url: &'static str,
    pub oidc_audience: &'static str,
}

impl Default for DevEnvConfig {
    fn default() -> Self {
        Self {
            atlas_env: "dev",
            postgres_db: "control_plane",
            postgres_user: "atlas_platform",
            postgres_password: "local_dev_password",
            postgres_port: "5433",
            pgadmin_email: "admin@example.com",
            pgadmin_password: "admin",
            pgadmin_port: "5050",
            control_plane_port: "8000",
            rust_log: "info",
            tenant_id: "tenant-dev",
            keycloak_admin: "admin",
            keycloak_admin_password: "admin",
            keycloak_port: "8081",
            oidc_issuer_url: "http://localhost:8081/realms/atlas",
            oidc_jwks_url: "http://keycloak:8080/realms/atlas/protocol/openid-connect/certs",
            oidc_audience: "account",
        }
    }
}

impl DevEnvConfig {
    /// Returns all environment variables as a vector of (key, value) pairs.
    pub fn as_env_pairs(&self) -> Vec<(&'static str, &'static str)> {
        vec![
            ("ATLAS_ENV", self.atlas_env),
            ("POSTGRES_DB", self.postgres_db),
            ("POSTGRES_USER", self.postgres_user),
            ("POSTGRES_PASSWORD", self.postgres_password),
            ("POSTGRES_PORT", self.postgres_port),
            ("PGADMIN_DEFAULT_EMAIL", self.pgadmin_email),
            ("PGADMIN_DEFAULT_PASSWORD", self.pgadmin_password),
            ("PGADMIN_PORT", self.pgadmin_port),
            ("CONTROL_PLANE_PORT", self.control_plane_port),
            ("RUST_LOG", self.rust_log),
            ("TENANT_ID", self.tenant_id),
            ("KEYCLOAK_ADMIN", self.keycloak_admin),
            ("KEYCLOAK_ADMIN_PASSWORD", self.keycloak_admin_password),
            ("KEYCLOAK_PORT", self.keycloak_port),
            ("OIDC_ISSUER_URL", self.oidc_issuer_url),
            ("OIDC_JWKS_URL", self.oidc_jwks_url),
            ("OIDC_AUDIENCE", self.oidc_audience),
        ]
    }

    /// Returns the control plane database URL.
    pub fn control_plane_db_url(&self) -> String {
        format!(
            "postgres://{}:{}@localhost:{}/{}",
            self.postgres_user, self.postgres_password, self.postgres_port, self.postgres_db
        )
    }
}

pub struct DevSupervisor {
    dev_dir: PathBuf,
    env_config: DevEnvConfig,
}

impl DevSupervisor {
    pub fn new() -> Result<Self> {
        let dev_dir = PathBuf::from(".dev");
        fs::create_dir_all(&dev_dir)?;
        Ok(Self {
            dev_dir,
            env_config: DevEnvConfig::default(),
        })
    }

    pub fn detect_container_runtime(&self) -> String {
        if let Ok(runtime) = std::env::var("CONTAINER_RUNTIME") {
            return runtime;
        }

        if Command::new("docker")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            return "docker".to_string();
        }

        if Command::new("podman")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            return "podman".to_string();
        }

        "docker".to_string()
    }

    /// Create a compose command with all dev environment variables injected.
    fn compose_command(&self) -> Command {
        let runtime = self.detect_container_runtime();
        let compose_cmd = if runtime == "podman" {
            "podman-compose"
        } else {
            "docker-compose"
        };

        let mut cmd = Command::new(compose_cmd);
        cmd.args(["-f", "infra/compose/compose.control-plane.yml"]);

        // Inject all dev environment variables
        for (key, value) in self.env_config.as_env_pairs() {
            cmd.env(key, value);
        }

        // Also set the derived DB URL
        cmd.env(
            "CONTROL_PLANE_DB_URL",
            format!(
                "postgres://{}:{}@postgres:5432/{}",
                self.env_config.postgres_user,
                self.env_config.postgres_password,
                self.env_config.postgres_db
            ),
        );

        cmd
    }

    pub fn is_compose_running(&self) -> bool {
        let output = self
            .compose_command()
            .args(["ps", "-q", "postgres"])
            .output();

        if let Ok(output) = output {
            !output.stdout.is_empty()
        } else {
            false
        }
    }

    pub fn start_compose(&self, detach: bool) -> Result<()> {
        let runtime = self.detect_container_runtime();
        println!("{} Using container runtime: {}", "→".cyan(), runtime);
        println!(
            "{} Starting services with ATLAS_ENV=dev...",
            "→".cyan()
        );

        let mut cmd = self.compose_command();
        cmd.args(["up", "--build"]);

        if detach {
            cmd.arg("-d");
        }

        let status = cmd.status().context("Failed to start docker-compose")?;

        if !status.success() {
            anyhow::bail!("docker-compose exited with error");
        }

        if detach {
            println!(
                "{} Waiting for PostgreSQL to be ready...",
                "→".cyan()
            );
            self.wait_for_postgres()?;

            println!(
                "{} Waiting for control plane to be ready...",
                "→".cyan()
            );
            self.wait_for_control_plane()?;
        }

        Ok(())
    }

    pub fn stop_compose(&self) -> Result<()> {
        println!("{} Stopping containers...", "→".cyan());

        self.compose_command()
            .arg("down")
            .status()
            .context("Failed to stop docker-compose")?;

        Ok(())
    }

    pub fn wait_for_postgres(&self) -> Result<()> {
        for attempt in 1..=30 {
            if self.check_postgres_ready() {
                println!("{} PostgreSQL is ready", "✓".green());
                return Ok(());
            }

            if attempt % 5 == 0 {
                println!(
                    "{} Still waiting for PostgreSQL... (attempt {}/30)",
                    "⋯".yellow(),
                    attempt
                );
            }

            thread::sleep(Duration::from_secs(1));
        }

        anyhow::bail!("PostgreSQL did not become ready in time")
    }

    fn check_postgres_ready(&self) -> bool {
        let runtime = self.detect_container_runtime();
        let container_name = "atlas-platform-control-plane-db";

        let output = Command::new(&runtime)
            .args([
                "exec",
                container_name,
                "psql",
                "-U",
                self.env_config.postgres_user,
                "-d",
                self.env_config.postgres_db,
                "-c",
                "SELECT 1",
            ])
            .output();

        matches!(output, Ok(output) if output.status.success())
    }

    pub fn run_migrations(&self) -> Result<()> {
        println!("{} Running control plane migrations...", "→".cyan());

        let migrations_dir = std::path::Path::new("crates/control_plane_db/migrations");
        if !migrations_dir.exists() {
            anyhow::bail!("Migrations directory not found: {:?}", migrations_dir);
        }

        let runtime = self.detect_container_runtime();
        let container_name = "atlas-platform-control-plane-db";
        let postgres_user = self.env_config.postgres_user;
        let postgres_db = self.env_config.postgres_db;

        let create_schema = Command::new(&runtime)
            .args([
                "exec",
                container_name,
                "psql",
                "-U",
                postgres_user,
                "-d",
                postgres_db,
                "-c",
                "CREATE SCHEMA IF NOT EXISTS control_plane; \
                 CREATE TABLE IF NOT EXISTS control_plane._migrations (\
                    id SERIAL PRIMARY KEY,\
                    filename TEXT NOT NULL UNIQUE,\
                    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\
                 );",
            ])
            .output()
            .context("Failed to create schema and migrations table")?;

        if !create_schema.status.success() {
            anyhow::bail!(
                "Failed to create schema: {}",
                String::from_utf8_lossy(&create_schema.stderr)
            );
        }

        let mut migration_files: Vec<_> = std::fs::read_dir(migrations_dir)?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("sql"))
            .collect();

        migration_files.sort_by_key(|e| e.file_name());

        for entry in migration_files {
            let filename = entry.file_name().to_string_lossy().to_string();
            let sql_content = std::fs::read_to_string(entry.path())?;

            let check_executed = Command::new(&runtime)
                .args([
                    "exec",
                    container_name,
                    "psql",
                    "-U",
                    postgres_user,
                    "-d",
                    postgres_db,
                    "-tAc",
                    &format!(
                        "SELECT COUNT(*) FROM control_plane._migrations WHERE filename = '{}'",
                        filename
                    ),
                ])
                .output()?;

            if String::from_utf8_lossy(&check_executed.stdout).trim() == "1" {
                println!("  Skipping already executed: {}", filename);
                continue;
            }

            println!("  Executing: {}", filename);

            let exec_sql = Command::new(&runtime)
                .args([
                    "exec",
                    container_name,
                    "psql",
                    "-U",
                    postgres_user,
                    "-d",
                    postgres_db,
                    "-c",
                    &sql_content,
                ])
                .output()?;

            if !exec_sql.status.success() {
                anyhow::bail!(
                    "Migration {} failed: {}",
                    filename,
                    String::from_utf8_lossy(&exec_sql.stderr)
                );
            }

            let record = Command::new(&runtime)
                .args([
                    "exec",
                    container_name,
                    "psql",
                    "-U",
                    postgres_user,
                    "-d",
                    postgres_db,
                    "-c",
                    &format!(
                        "INSERT INTO control_plane._migrations (filename) VALUES ('{}')",
                        filename
                    ),
                ])
                .output()?;

            if !record.status.success() {
                anyhow::bail!(
                    "Failed to record migration: {}",
                    String::from_utf8_lossy(&record.stderr)
                );
            }
        }

        println!("{} Migrations completed", "✓".green());
        Ok(())
    }

    pub fn is_control_plane_running(&self) -> bool {
        let runtime = self.detect_container_runtime();
        let output = Command::new(&runtime)
            .args(["ps", "-q", "-f", "name=atlas-platform-control-plane"])
            .output();

        matches!(output, Ok(output) if !output.stdout.is_empty())
    }

    pub fn wait_for_control_plane(&self) -> Result<()> {
        for attempt in 1..=60 {
            if self.check_control_plane_ready() {
                println!("{} Control plane is ready", "✓".green());
                return Ok(());
            }

            if attempt % 10 == 0 {
                println!(
                    "{} Still waiting for control plane... (attempt {}/60)",
                    "⋯".yellow(),
                    attempt
                );
            }

            thread::sleep(Duration::from_secs(1));
        }

        anyhow::bail!("Control plane did not become ready in time")
    }

    fn check_control_plane_ready(&self) -> bool {
        let client = reqwest::blocking::Client::new();
        client
            .get("http://localhost:8000/readyz")
            .timeout(Duration::from_secs(1))
            .send()
            .is_ok()
    }

    pub fn get_logs(&self) -> Result<String> {
        let runtime = self.detect_container_runtime();
        let output = Command::new(&runtime)
            .args(["logs", "--tail", "50", "atlas-platform-control-plane"])
            .output()
            .context("Failed to get container logs")?;

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Print the dev environment configuration for reference.
    pub fn print_dev_config(&self) {
        println!("\n{} Dev environment configuration:", "ℹ".blue());
        println!("  ATLAS_ENV=dev");
        println!(
            "  POSTGRES_DB={}",
            self.env_config.postgres_db
        );
        println!(
            "  POSTGRES_USER={}",
            self.env_config.postgres_user
        );
        println!(
            "  POSTGRES_PORT={}",
            self.env_config.postgres_port
        );
        println!(
            "  TENANT_ID={}",
            self.env_config.tenant_id
        );
        println!(
            "  CONTROL_PLANE_DB_URL={}",
            self.env_config.control_plane_db_url()
        );
        println!();
    }
}
