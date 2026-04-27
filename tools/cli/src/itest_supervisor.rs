use anyhow::{Context, Result};
use colored::Colorize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

/// Hybrid integration-test supervisor.
///
/// Postgres + Keycloak run as podman containers via
/// `infra/compose/compose.itest-infra.yml`. The Atlas Rust services
/// (control-plane, ingress, workers) run as host processes spawned by
/// this supervisor. PIDs and logs are tracked under `.itest/`.
pub struct ItestSupervisor {
    project_root: PathBuf,
    state_dir: PathBuf,
    env: ItestEnv,
}

/// Single source of truth for the itest hybrid environment.
pub struct ItestEnv {
    pub atlas_env: &'static str,

    pub postgres_user: &'static str,
    pub postgres_password: &'static str,
    pub postgres_db: &'static str,
    pub postgres_port: &'static str,

    pub keycloak_admin: &'static str,
    pub keycloak_admin_password: &'static str,
    pub keycloak_port: &'static str,

    pub control_plane_port: &'static str,
    pub ingress_port: &'static str,
    pub workers_metrics_port: &'static str,

    pub tenant_id: &'static str,
    pub rust_log: &'static str,
}

impl Default for ItestEnv {
    fn default() -> Self {
        Self {
            atlas_env: "dev",
            postgres_user: "atlas_platform",
            postgres_password: "itest_password_change_me",
            postgres_db: "control_plane",
            postgres_port: "15432",
            keycloak_admin: "admin",
            keycloak_admin_password: "admin",
            keycloak_port: "8081",
            control_plane_port: "8000",
            ingress_port: "3000",
            workers_metrics_port: "9101",
            tenant_id: "tenant-itest-001",
            rust_log: "info,atlas_platform_ingress=debug,atlas_platform_workers=debug",
        }
    }
}

impl ItestEnv {
    pub fn control_plane_db_url(&self) -> String {
        format!(
            "postgres://{}:{}@localhost:{}/{}",
            self.postgres_user, self.postgres_password, self.postgres_port, self.postgres_db
        )
    }

    pub fn oidc_issuer_url(&self) -> String {
        format!("http://localhost:{}/realms/atlas", self.keycloak_port)
    }

    pub fn oidc_jwks_url(&self) -> String {
        format!(
            "http://localhost:{}/realms/atlas/protocol/openid-connect/certs",
            self.keycloak_port
        )
    }
}

const SERVICES: &[&str] = &["control-plane", "ingress", "workers"];

impl ItestSupervisor {
    pub fn new() -> Result<Self> {
        let project_root = std::env::current_dir().context("Failed to read CWD")?;
        let state_dir = project_root.join(".itest");
        fs::create_dir_all(&state_dir).context("Failed to create .itest/")?;
        Ok(Self {
            project_root,
            state_dir,
            env: ItestEnv::default(),
        })
    }

    pub fn env(&self) -> &ItestEnv {
        &self.env
    }

    pub fn pid_path(&self, service: &str) -> PathBuf {
        self.state_dir.join(format!("{service}.pid"))
    }

    pub fn log_path(&self, service: &str) -> PathBuf {
        self.state_dir.join(format!("{service}.log"))
    }

    fn compose_file(&self) -> PathBuf {
        self.project_root
            .join("infra/compose/compose.itest-infra.yml")
    }

    fn podman_compose_provider() -> Option<PathBuf> {
        if let Ok(p) = std::env::var("PODMAN_COMPOSE_PROVIDER") {
            return Some(PathBuf::from(p));
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            for v in ["Python310", "Python311", "Python312"] {
                let p = PathBuf::from(&appdata)
                    .join("Python")
                    .join(v)
                    .join("Scripts")
                    .join("podman-compose.exe");
                if p.exists() {
                    return Some(p);
                }
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(home).join(".local/bin/podman-compose");
            if p.exists() {
                return Some(p);
            }
        }
        for sys in ["/usr/local/bin/podman-compose", "/usr/bin/podman-compose"] {
            if Path::new(sys).exists() {
                return Some(PathBuf::from(sys));
            }
        }
        None
    }

    fn compose_command(&self) -> Result<Command> {
        if let Some(provider) = Self::podman_compose_provider() {
            std::env::set_var("PODMAN_COMPOSE_PROVIDER", &provider);
        }

        let mut cmd = Command::new("podman");
        cmd.arg("compose");
        cmd.args(["-f", self.compose_file().to_str().unwrap()]);

        let env = &self.env;
        cmd.env("POSTGRES_USER", env.postgres_user);
        cmd.env("POSTGRES_PASSWORD", env.postgres_password);
        cmd.env("POSTGRES_DB", env.postgres_db);
        cmd.env("POSTGRES_PORT", env.postgres_port);
        cmd.env("KEYCLOAK_ADMIN", env.keycloak_admin);
        cmd.env("KEYCLOAK_ADMIN_PASSWORD", env.keycloak_admin_password);
        cmd.env("KEYCLOAK_PORT", env.keycloak_port);

        Ok(cmd)
    }

    pub fn infra_up(&self, detach: bool) -> Result<()> {
        println!(
            "{} Starting infra (postgres + keycloak) via podman compose...",
            "→".cyan()
        );
        let mut cmd = self.compose_command()?;
        cmd.arg("up");
        if detach {
            cmd.arg("-d");
        }
        let status = cmd.status().context("Failed to invoke podman compose up")?;
        if !status.success() {
            anyhow::bail!("podman compose up exited with status {}", status);
        }
        Ok(())
    }

    pub fn infra_down(&self) -> Result<()> {
        println!("{} Tearing down infra containers...", "→".cyan());
        let status = self.compose_command()?.arg("down").status()?;
        if !status.success() {
            anyhow::bail!("podman compose down exited with status {}", status);
        }
        Ok(())
    }

    pub fn wait_for_postgres(&self) -> Result<()> {
        println!("{} Waiting for Postgres readiness...", "→".cyan());
        for attempt in 1..=60 {
            let ok = Command::new("podman")
                .args([
                    "exec",
                    "atlas-itest-db",
                    "pg_isready",
                    "-U",
                    self.env.postgres_user,
                    "-d",
                    self.env.postgres_db,
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok {
                println!("{} Postgres is ready", "✓".green());
                return Ok(());
            }
            if attempt % 10 == 0 {
                println!(
                    "{} Still waiting for Postgres ({}/60)...",
                    "⋯".yellow(),
                    attempt
                );
            }
            thread::sleep(Duration::from_secs(1));
        }
        anyhow::bail!("Postgres did not become ready within 60s")
    }

    pub fn wait_for_keycloak(&self) -> Result<()> {
        println!("{} Waiting for Keycloak readiness...", "→".cyan());
        let url = format!(
            "http://localhost:{}/realms/atlas/.well-known/openid-configuration",
            self.env.keycloak_port
        );
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()?;
        for attempt in 1..=120 {
            if client
                .get(&url)
                .send()
                .map(|r| r.status().is_success())
                .unwrap_or(false)
            {
                println!("{} Keycloak realm 'atlas' is ready", "✓".green());
                return Ok(());
            }
            if attempt % 10 == 0 {
                println!(
                    "{} Still waiting for Keycloak ({}/120)...",
                    "⋯".yellow(),
                    attempt
                );
            }
            thread::sleep(Duration::from_secs(1));
        }
        anyhow::bail!("Keycloak did not become ready within 120s")
    }

    pub fn run_control_plane_migrations(&self) -> Result<()> {
        println!("{} Running control-plane migrations...", "→".cyan());
        let status = Command::new("cargo")
            .args([
                "run",
                "--quiet",
                "-p",
                "atlas-platform-control-plane-db",
                "--bin",
                "migrate",
            ])
            .env("CONTROL_PLANE_DB_URL", self.env.control_plane_db_url())
            .current_dir(&self.project_root)
            .status()?;
        if !status.success() {
            anyhow::bail!("Control plane migrate failed");
        }
        println!("{} Control plane migrations complete", "✓".green());
        Ok(())
    }

    pub fn seed_control_plane(&self) -> Result<()> {
        println!("{} Seeding control plane...", "→".cyan());
        let fixtures_dir = self.project_root.join("specs/fixtures");
        let status = Command::new("cargo")
            .args([
                "run",
                "--quiet",
                "-p",
                "atlas-platform-control-plane-db",
                "--bin",
                "seed",
            ])
            .env("CONTROL_PLANE_DB_URL", self.env.control_plane_db_url())
            .env("ATLAS_FIXTURES_DIR", fixtures_dir)
            .current_dir(&self.project_root)
            .status()?;
        if !status.success() {
            anyhow::bail!("Control plane seed failed");
        }
        println!("{} Control plane seeded", "✓".green());
        Ok(())
    }

    /// Build all three service binaries up-front so that spawning them
    /// later doesn't hold the cargo build lock for the lifetime of each
    /// process (which would block sibling builds — `cargo run` keeps the
    /// lock until the spawned binary exits).
    pub fn build_services(&self) -> Result<()> {
        println!("{} Building service binaries (release)...", "→".cyan());

        // Build control-plane + workers in one cargo invocation (no special
        // features); ingress separately because it needs the test-auth
        // feature flag.
        let s1 = Command::new("cargo")
            .args([
                "build",
                "--release",
                "-p",
                "atlas-platform-control-plane",
                "-p",
                "atlas-platform-workers",
            ])
            .current_dir(&self.project_root)
            .status()?;
        if !s1.success() {
            anyhow::bail!("cargo build for control-plane/workers failed");
        }

        let s2 = Command::new("cargo")
            .args([
                "build",
                "--release",
                "-p",
                "atlas-platform-ingress",
                "--features",
                "test-auth",
            ])
            .current_dir(&self.project_root)
            .status()?;
        if !s2.success() {
            anyhow::bail!("cargo build for ingress failed");
        }

        println!("{} Service binaries built", "✓".green());
        Ok(())
    }

    fn binary_path(&self, service: &str) -> PathBuf {
        let bin_name = match service {
            "control-plane" => "control-plane",
            "ingress" => "ingress",
            "workers" => "workers",
            _ => panic!("unknown service: {service}"),
        };
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        self.project_root
            .join("target/release")
            .join(format!("{bin_name}{suffix}"))
    }

    /// Spawn one of the Atlas Rust services as a detached host process.
    /// Returns immediately after spawning. The child's stdout/stderr are
    /// redirected to `.itest/<service>.log`. The binary must already be
    /// built — call `build_services()` first.
    pub fn spawn_service(&self, service: &str) -> Result<()> {
        if !SERVICES.contains(&service) {
            anyhow::bail!("Unknown itest service: {service}");
        }

        if self.is_service_running(service) {
            println!("{} {} already running, skipping", "→".yellow(), service);
            return Ok(());
        }

        let bin = self.binary_path(service);
        if !bin.exists() {
            anyhow::bail!(
                "Service binary missing: {}. Run `atlas itest up` (it builds before spawning).",
                bin.display()
            );
        }

        let log_file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(self.log_path(service))?;
        let log_file_err = log_file.try_clone()?;

        let mut cmd = Command::new(&bin);

        let env = &self.env;
        cmd.env("ATLAS_ENV", env.atlas_env);
        cmd.env("CONTROL_PLANE_DB_URL", env.control_plane_db_url());
        cmd.env("CONTROL_PLANE_ENABLED", "true");
        cmd.env("TENANT_ID", env.tenant_id);
        cmd.env("TEST_TENANT_ID", env.tenant_id);
        cmd.env("RUST_LOG", env.rust_log);
        cmd.env("TEST_AUTH_ENABLED", "true");
        cmd.env("DEBUG_AUTH_ENDPOINT_ENABLED", "true");
        cmd.env("OIDC_ISSUER_URL", env.oidc_issuer_url());
        cmd.env("OIDC_JWKS_URL", env.oidc_jwks_url());
        cmd.env("OIDC_AUDIENCE", "account");
        // Tenant-DB fan-out lives in the control-plane handler — it reads
        // these to populate db_host/db_port/db_user/db_password on each
        // newly created tenant row, which is what PostgresTenantDbProvider
        // later uses to pool per-tenant connections.
        cmd.env("DEV_DB_HOST", "localhost");
        cmd.env("DEV_DB_PORT", env.postgres_port);
        cmd.env("POSTGRES_USER", env.postgres_user);
        cmd.env("POSTGRES_PASSWORD", env.postgres_password);
        cmd.env("ENVIRONMENT", "dev");

        match service {
            "control-plane" => {
                cmd.env("PORT", env.control_plane_port);
            }
            "ingress" => {
                cmd.env("INGRESS_PORT", env.ingress_port);
                cmd.env("METRICS_ADDR", "0.0.0.0:9100");
            }
            "workers" => {
                cmd.env("METRICS_ADDR", format!("0.0.0.0:{}", env.workers_metrics_port));
            }
            _ => {}
        }

        cmd.current_dir(&self.project_root);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::from(log_file));
        cmd.stderr(Stdio::from(log_file_err));

        // Detach so the child outlives the supervisor invocation. On
        // Windows, CREATE_NEW_PROCESS_GROUP keeps Ctrl-C signals from
        // the supervisor's console out of the child.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
            cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
        }

        let child = cmd.spawn().context("Failed to spawn service")?;
        let pid = child.id();
        std::mem::forget(child); // don't wait, don't drop the handle

        let mut pid_file = fs::File::create(self.pid_path(service))?;
        writeln!(pid_file, "{pid}")?;

        println!(
            "{} Spawned {} (pid {}) -> .itest/{}.log",
            "✓".green(),
            service,
            pid,
            service
        );

        Ok(())
    }

    pub fn stop_service(&self, service: &str) -> Result<()> {
        let pid_path = self.pid_path(service);
        if !pid_path.exists() {
            return Ok(());
        }
        let pid_str = fs::read_to_string(&pid_path)?;
        let pid: u32 = pid_str.trim().parse().context("invalid pid file")?;

        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        #[cfg(not(windows))]
        {
            let _ = Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }

        let _ = fs::remove_file(&pid_path);
        println!("{} Stopped {} (pid {})", "✓".green(), service, pid);
        Ok(())
    }

    pub fn stop_all_services(&self) -> Result<()> {
        for s in SERVICES {
            self.stop_service(s)?;
        }
        Ok(())
    }

    pub fn is_service_running(&self, service: &str) -> bool {
        let pid_path = self.pid_path(service);
        let Ok(pid_str) = fs::read_to_string(&pid_path) else {
            return false;
        };
        let Ok(pid) = pid_str.trim().parse::<u32>() else {
            return false;
        };

        #[cfg(windows)]
        {
            Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}")])
                .output()
                .map(|o| {
                    let s = String::from_utf8_lossy(&o.stdout);
                    s.contains(&pid.to_string())
                })
                .unwrap_or(false)
        }
        #[cfg(not(windows))]
        {
            Command::new("kill")
                .args(["-0", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }
    }

    pub fn wait_for_service_health(&self, service: &str) -> Result<()> {
        let url = match service {
            "control-plane" => format!("http://localhost:{}/healthz", self.env.control_plane_port),
            "ingress" => format!("http://localhost:{}/", self.env.ingress_port),
            "workers" => format!("http://localhost:{}/metrics", self.env.workers_metrics_port),
            _ => anyhow::bail!("Unknown service for health: {service}"),
        };
        println!("{} Waiting for {} health at {}...", "→".cyan(), service, url);
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()?;

        for attempt in 1..=300 {
            if !self.is_service_running(service) {
                anyhow::bail!(
                    "{} died before becoming healthy — check .itest/{}.log",
                    service,
                    service
                );
            }
            if client
                .get(&url)
                .send()
                .map(|r| r.status().is_success())
                .unwrap_or(false)
            {
                println!("{} {} is healthy", "✓".green(), service);
                return Ok(());
            }
            if attempt % 15 == 0 {
                println!(
                    "{} Still waiting for {} ({}/300s)...",
                    "⋯".yellow(),
                    service,
                    attempt
                );
            }
            thread::sleep(Duration::from_secs(1));
        }
        anyhow::bail!("{} did not become healthy within 5 minutes", service)
    }

    pub fn print_summary(&self) {
        let env = &self.env;
        println!();
        println!("{}", "Atlas itest stack (hybrid mode):".bold());
        println!(
            "  Postgres:      localhost:{} (db={}, user={})",
            env.postgres_port, env.postgres_db, env.postgres_user
        );
        println!("  Keycloak:      http://localhost:{}", env.keycloak_port);
        println!(
            "  Control plane: http://localhost:{}",
            env.control_plane_port
        );
        println!("  Ingress:       http://localhost:{}", env.ingress_port);
        println!(
            "  Workers:       http://localhost:{}/metrics",
            env.workers_metrics_port
        );
        println!();
        println!("  Logs: .itest/<service>.log");
        println!("  Stop: atlas itest down");
        println!();
    }

    pub fn run_blackbox_tests(&self) -> Result<()> {
        println!("{} Running blackbox tests...", "→".cyan());
        let env = &self.env;
        let status = Command::new("cargo")
            .args(["test", "--release", "--", "--test-threads=4"])
            .env("INGRESS_BASE_URL", format!("http://localhost:{}", env.ingress_port))
            .env(
                "CONTROL_PLANE_BASE_URL",
                format!("http://localhost:{}", env.control_plane_port),
            )
            .env(
                "KEYCLOAK_BASE_URL",
                format!("http://localhost:{}", env.keycloak_port),
            )
            .env("TEST_TENANT_ID", env.tenant_id)
            .env("CONTROL_PLANE_DB_URL", env.control_plane_db_url())
            .env(
                "TEST_TENANT_DB_URL",
                env.control_plane_db_url(),
            )
            .current_dir(self.project_root.join("tests/blackbox"))
            .status()?;
        if !status.success() {
            anyhow::bail!("Blackbox tests failed");
        }
        println!("{} All blackbox tests passed", "✓".green());
        Ok(())
    }
}
