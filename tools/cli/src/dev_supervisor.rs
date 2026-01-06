use anyhow::{Context, Result};
use colored::Colorize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

pub struct DevSupervisor {
    dev_dir: PathBuf,
}

impl DevSupervisor {
    pub fn new() -> Result<Self> {
        let dev_dir = PathBuf::from(".dev");
        fs::create_dir_all(&dev_dir)?;
        Ok(Self { dev_dir })
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

    pub fn is_compose_running(&self) -> bool {
        let runtime = self.detect_container_runtime();
        let compose_cmd = if runtime == "podman" {
            "podman-compose"
        } else {
            "docker-compose"
        };

        let output = Command::new(compose_cmd)
            .args([
                "-f",
                "infra/compose/compose.control-plane.yml",
                "--env-file",
                "infra/compose/.env",
                "ps",
                "-q",
                "postgres",
            ])
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

        let compose_cmd = if runtime == "podman" {
            "podman-compose"
        } else {
            "docker-compose"
        };

        let env_file = Path::new("infra/compose/.env");
        if !env_file.exists() {
            println!(
                "{} Copying .env.example to .env...",
                "→".cyan()
            );
            fs::copy("infra/compose/.env.example", "infra/compose/.env")?;
        }

        println!("{} Starting services...", "→".cyan());

        let mut cmd = Command::new(compose_cmd);
        cmd.args([
            "-f",
            "infra/compose/compose.control-plane.yml",
            "--env-file",
            "infra/compose/.env",
            "up",
            "--build",
        ]);

        if detach {
            cmd.arg("-d");
        }

        let status = cmd
            .status()
            .context("Failed to start docker-compose")?;

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
        let runtime = self.detect_container_runtime();
        let compose_cmd = if runtime == "podman" {
            "podman-compose"
        } else {
            "docker-compose"
        };

        println!("{} Stopping containers...", "→".cyan());

        Command::new(compose_cmd)
            .args([
                "-f",
                "infra/compose/compose.control-plane.yml",
                "--env-file",
                "infra/compose/.env",
                "down",
            ])
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
                "atlas_platform",
                "-d",
                "control_plane",
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

        let create_schema = Command::new(&runtime)
            .args([
                "exec",
                container_name,
                "psql",
                "-U",
                "atlas_platform",
                "-d",
                "control_plane",
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
            anyhow::bail!("Failed to create schema: {}", String::from_utf8_lossy(&create_schema.stderr));
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
                    "atlas_platform",
                    "-d",
                    "control_plane",
                    "-tAc",
                    &format!("SELECT COUNT(*) FROM control_plane._migrations WHERE filename = '{}'", filename),
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
                    "atlas_platform",
                    "-d",
                    "control_plane",
                    "-c",
                    &sql_content,
                ])
                .output()?;

            if !exec_sql.status.success() {
                anyhow::bail!("Migration {} failed: {}", filename, String::from_utf8_lossy(&exec_sql.stderr));
            }

            let record = Command::new(&runtime)
                .args([
                    "exec",
                    container_name,
                    "psql",
                    "-U",
                    "atlas_platform",
                    "-d",
                    "control_plane",
                    "-c",
                    &format!("INSERT INTO control_plane._migrations (filename) VALUES ('{}')", filename),
                ])
                .output()?;

            if !record.status.success() {
                anyhow::bail!("Failed to record migration: {}", String::from_utf8_lossy(&record.stderr));
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
}
