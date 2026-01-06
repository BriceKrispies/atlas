use crate::commands::Command;
use crate::types::ServiceManifest;
use anyhow::{Context, Result};
use clap::Args;
use colored::Colorize;
use std::fs;
use std::path::Path;
use std::process::{Command as ProcessCommand, Stdio};
use walkdir::WalkDir;

#[derive(Debug, Args)]
pub struct RunCommand {
    #[arg(help = "Name of the service to run")]
    pub service: String,
}

impl Command for RunCommand {
    fn execute(&self) -> Result<()> {
        let service_dir = Path::new("apps").join(&self.service);

        if !service_dir.exists() {
            anyhow::bail!("Service not found: {}", self.service);
        }

        let run_script = service_dir.join("run.sh");

        if !run_script.exists() {
            anyhow::bail!(
                "Run script not found: {:?}\nRun 'atlas scaffold {}' to generate it.",
                run_script,
                self.service
            );
        }

        println!(
            "{}",
            format!("Starting service: {}", self.service).green()
        );

        let status = if cfg!(target_os = "windows") {
            ProcessCommand::new("sh")
                .arg(run_script.to_str().unwrap())
                .current_dir(&service_dir)
                .status()?
        } else {
            ProcessCommand::new("sh")
                .arg("run.sh")
                .current_dir(&service_dir)
                .status()?
        };

        if !status.success() {
            anyhow::bail!("Service exited with error: {}", status);
        }

        Ok(())
    }
}

#[derive(Debug, Args)]
pub struct RunAllCommand {}

impl Command for RunAllCommand {
    fn execute(&self) -> Result<()> {
        let manifests = Self::find_all_manifests()?;

        if manifests.is_empty() {
            println!("{}", "No services found in apps/".yellow());
            return Ok(());
        }

        println!(
            "{}",
            format!("Starting {} services...", manifests.len()).green()
        );

        let mut handles = vec![];

        for manifest in manifests {
            let service_name = manifest.name.clone();
            let service_dir = Path::new("apps").join(&service_name);
            let run_script = service_dir.join("run.sh");

            if !run_script.exists() {
                println!(
                    "  {} Skipping {} (no run script)",
                    "⚠".yellow(),
                    service_name
                );
                continue;
            }

            println!("  {} Starting {}", "→".cyan(), service_name);

            let handle = std::thread::spawn(move || {
                let mut child = if cfg!(target_os = "windows") {
                    ProcessCommand::new("sh")
                        .arg(run_script.to_str().unwrap())
                        .current_dir(&service_dir)
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn()
                        .expect("Failed to start service")
                } else {
                    ProcessCommand::new("sh")
                        .arg("run.sh")
                        .current_dir(&service_dir)
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn()
                        .expect("Failed to start service")
                };

                use std::io::{BufRead, BufReader};

                let stdout = child.stdout.take().unwrap();
                let stderr = child.stderr.take().unwrap();

                let service_name_clone = service_name.clone();
                let stdout_handle = std::thread::spawn(move || {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            println!("[{}] {}", service_name_clone.cyan(), line);
                        }
                    }
                });

                let service_name_clone2 = service_name.clone();
                let stderr_handle = std::thread::spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            eprintln!("[{}] {}", service_name_clone2.yellow(), line);
                        }
                    }
                });

                stdout_handle.join().ok();
                stderr_handle.join().ok();
                child.wait().ok();
            });

            handles.push(handle);
        }

        println!("{}", "\nAll services started. Press Ctrl+C to stop.\n".green());

        for handle in handles {
            handle.join().ok();
        }

        Ok(())
    }
}

impl RunAllCommand {
    fn find_all_manifests() -> Result<Vec<ServiceManifest>> {
        let mut manifests = Vec::new();
        let apps_dir = Path::new("apps");

        if !apps_dir.exists() {
            return Ok(manifests);
        }

        for entry in WalkDir::new(apps_dir)
            .max_depth(2)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_name() == "service.yaml" {
                let content = fs::read_to_string(entry.path())
                    .context(format!("Failed to read {:?}", entry.path()))?;

                let manifest = ServiceManifest::from_yaml(&content).context(format!(
                    "Failed to parse manifest at {:?}",
                    entry.path()
                ))?;

                manifests.push(manifest);
            }
        }

        Ok(manifests)
    }
}
