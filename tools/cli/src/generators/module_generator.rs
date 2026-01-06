use crate::types::ModuleManifest;
use anyhow::{Context, Result};
use colored::Colorize;
use std::fs;
use std::path::Path;

pub struct ModuleGenerator;

impl ModuleGenerator {
    pub fn generate(manifest: &ModuleManifest, dry_run: bool) -> Result<()> {
        let crate_path_str = manifest.crate_path();
        let crate_path = Path::new(&crate_path_str);

        if dry_run {
            println!("{}", format!("[DRY RUN] Would create module crate at: {}", crate_path.display()).yellow());
            Self::print_dry_run(manifest)?;
            return Ok(());
        }

        if crate_path.exists() {
            println!("{}", format!("→ Module crate already exists: {}", crate_path.display()).yellow());
            println!("{}", "→ Updating generated files...".cyan());
        } else {
            println!("{}", format!("→ Creating module crate: {}", crate_path.display()).cyan());
            fs::create_dir_all(crate_path)?;
        }

        fs::create_dir_all(crate_path.join("src"))?;

        Self::generate_cargo_toml(manifest, crate_path)?;
        Self::generate_lib_rs(manifest, crate_path)?;
        Self::generate_manifest_metadata(manifest, crate_path)?;

        if !manifest.actions.is_empty() {
            Self::generate_actions_rs(manifest, crate_path)?;
        }

        if !manifest.events.publishes.is_empty() || !manifest.events.consumes.is_empty() {
            Self::generate_events_rs(manifest, crate_path)?;
        }

        if !manifest.projections.is_empty() {
            Self::generate_projections_rs(manifest, crate_path)?;
        }

        if !manifest.jobs.is_empty() {
            Self::generate_jobs_rs(manifest, crate_path)?;
        }

        if !crate_path.exists() || !Self::is_in_workspace(&manifest.crate_path())? {
            Self::add_to_workspace(&manifest.crate_path())?;
        }

        println!("{}", format!("✓ Module crate generated: {}", crate_path.display()).green());

        Ok(())
    }

    fn is_in_workspace(crate_path: &str) -> Result<bool> {
        let workspace_toml = Path::new("Cargo.toml");
        if !workspace_toml.exists() {
            return Ok(false);
        }

        let content = fs::read_to_string(workspace_toml)?;
        Ok(content.contains(&format!("\"{}\"", crate_path)))
    }

    fn add_to_workspace(crate_path: &str) -> Result<()> {
        let workspace_toml = Path::new("Cargo.toml");
        if !workspace_toml.exists() {
            return Ok(());
        }

        let content = fs::read_to_string(workspace_toml)?;

        let member_line = format!("    \"{}\",", crate_path);

        if content.contains(&member_line) {
            return Ok(());
        }

        let updated = if let Some(pos) = content.find("members = [") {
            if let Some(newline_pos) = content[pos..].find('\n') {
                let insert_pos = pos + newline_pos + 1;
                let mut new_content = String::new();
                new_content.push_str(&content[..insert_pos]);
                new_content.push_str(&member_line);
                new_content.push('\n');
                new_content.push_str(&content[insert_pos..]);
                new_content
            } else {
                content
            }
        } else {
            content
        };

        fs::write(workspace_toml, updated)?;
        println!("{}", "→ Added module to workspace members".cyan());

        Ok(())
    }

    fn print_dry_run(manifest: &ModuleManifest) -> Result<()> {
        let crate_path_str = manifest.crate_path();
        let crate_path = Path::new(&crate_path_str);

        println!("  Files to be created:");
        println!("    {}", crate_path.join("Cargo.toml").display());
        println!("    {}", crate_path.join("src/lib.rs").display());
        println!("    {}", crate_path.join(".manifest_metadata.json").display());

        if !manifest.actions.is_empty() {
            println!("    {}", crate_path.join("src/actions.rs").display());
        }

        if !manifest.events.publishes.is_empty() || !manifest.events.consumes.is_empty() {
            println!("    {}", crate_path.join("src/events.rs").display());
        }

        if !manifest.projections.is_empty() {
            println!("    {}", crate_path.join("src/projections.rs").display());
        }

        if !manifest.jobs.is_empty() {
            println!("    {}", crate_path.join("src/jobs.rs").display());
        }

        Ok(())
    }

    fn generate_cargo_toml(manifest: &ModuleManifest, crate_path: &Path) -> Result<()> {
        let content = format!(
            r#"[package]
name = "{}"
version.workspace = true
edition.workspace = true

[dependencies]
atlas-core.workspace = true
serde.workspace = true
serde_json.workspace = true
anyhow.workspace = true
"#,
            manifest.crate_name()
        );

        fs::write(crate_path.join("Cargo.toml"), content)
            .context("Failed to write Cargo.toml")?;

        Ok(())
    }

    fn generate_lib_rs(manifest: &ModuleManifest, crate_path: &Path) -> Result<()> {
        let mut content = String::new();

        content.push_str(&format!(
            r#"pub const MODULE_ID: &str = "{}";
pub const MODULE_NAME: &str = "{}";
pub const MODULE_VERSION: &str = "{}";

"#,
            manifest.module_id, manifest.display_name, manifest.version
        ));

        if !manifest.actions.is_empty() {
            content.push_str("pub mod actions;\n");
        }

        if !manifest.events.publishes.is_empty() || !manifest.events.consumes.is_empty() {
            content.push_str("pub mod events;\n");
        }

        if !manifest.projections.is_empty() {
            content.push_str("pub mod projections;\n");
        }

        if !manifest.jobs.is_empty() {
            content.push_str("pub mod jobs;\n");
        }

        content.push_str("\n");

        content.push_str(&format!(
            r#"pub struct ModuleInfo {{
    pub id: &'static str,
    pub name: &'static str,
    pub version: &'static str,
    pub types: Vec<&'static str>,
}}

pub fn module_info() -> ModuleInfo {{
    ModuleInfo {{
        id: MODULE_ID,
        name: MODULE_NAME,
        version: MODULE_VERSION,
        types: vec![{}],
    }}
}}
"#,
            manifest
                .module_type
                .iter()
                .map(|t| format!("\"{}\"", t))
                .collect::<Vec<_>>()
                .join(", ")
        ));

        fs::write(crate_path.join("src/lib.rs"), content).context("Failed to write lib.rs")?;

        Ok(())
    }

    fn generate_manifest_metadata(manifest: &ModuleManifest, crate_path: &Path) -> Result<()> {
        let metadata = serde_json::json!({
            "manifestPath": format!("specs/modules/{}.json", manifest.module_id),
            "moduleId": manifest.module_id,
            "version": manifest.version,
            "generatedFrom": "atlas module scaffold"
        });

        fs::write(
            crate_path.join(".manifest_metadata.json"),
            serde_json::to_string_pretty(&metadata)?,
        )
        .context("Failed to write manifest metadata")?;

        Ok(())
    }

    fn generate_actions_rs(manifest: &ModuleManifest, crate_path: &Path) -> Result<()> {
        let mut content = String::new();

        content.push_str("use serde::{Deserialize, Serialize};\n\n");

        content.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
        content.push_str("pub struct Action {\n");
        content.push_str("    pub action_id: String,\n");
        content.push_str("    pub resource_type: String,\n");
        content.push_str("    pub verb: String,\n");
        content.push_str("}\n\n");

        content.push_str("pub fn declared_actions() -> Vec<Action> {\n");
        content.push_str("    vec![\n");

        for action in &manifest.actions {
            content.push_str(&format!(
                "        Action {{\n            action_id: \"{}\".to_string(),\n            resource_type: \"{}\".to_string(),\n            verb: \"{}\".to_string(),\n        }},\n",
                action.action_id, action.resource_type, action.verb
            ));
        }

        content.push_str("    ]\n");
        content.push_str("}\n");

        fs::write(crate_path.join("src/actions.rs"), content)
            .context("Failed to write actions.rs")?;

        Ok(())
    }

    fn generate_events_rs(manifest: &ModuleManifest, crate_path: &Path) -> Result<()> {
        let mut content = String::new();

        content.push_str("use serde::{Deserialize, Serialize};\n\n");

        if !manifest.events.publishes.is_empty() {
            content.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
            content.push_str("pub struct PublishedEvent {\n");
            content.push_str("    pub event_type: String,\n");
            content.push_str("    pub category: String,\n");
            content.push_str("    pub schema_id: String,\n");
            content.push_str("}\n\n");

            content.push_str("pub fn published_events() -> Vec<PublishedEvent> {\n");
            content.push_str("    vec![\n");

            for event in &manifest.events.publishes {
                content.push_str(&format!(
                    "        PublishedEvent {{\n            event_type: \"{}\".to_string(),\n            category: \"{}\".to_string(),\n            schema_id: \"{}\".to_string(),\n        }},\n",
                    event.event_type, event.category, event.schema_id
                ));
            }

            content.push_str("    ]\n");
            content.push_str("}\n\n");
        }

        if !manifest.events.consumes.is_empty() {
            content.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
            content.push_str("pub struct ConsumedEvent {\n");
            content.push_str("    pub event_type: String,\n");
            content.push_str("    pub category: String,\n");
            content.push_str("}\n\n");

            content.push_str("pub fn consumed_events() -> Vec<ConsumedEvent> {\n");
            content.push_str("    vec![\n");

            for event in &manifest.events.consumes {
                content.push_str(&format!(
                    "        ConsumedEvent {{\n            event_type: \"{}\".to_string(),\n            category: \"{}\".to_string(),\n        }},\n",
                    event.event_type, event.category
                ));
            }

            content.push_str("    ]\n");
            content.push_str("}\n");
        }

        fs::write(crate_path.join("src/events.rs"), content)
            .context("Failed to write events.rs")?;

        Ok(())
    }

    fn generate_projections_rs(manifest: &ModuleManifest, crate_path: &Path) -> Result<()> {
        let mut content = String::new();

        content.push_str("use serde::{Deserialize, Serialize};\n\n");

        content.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
        content.push_str("pub struct ProjectionInfo {\n");
        content.push_str("    pub name: String,\n");
        content.push_str("    pub input_events: Vec<String>,\n");
        content.push_str("    pub output_model: String,\n");
        content.push_str("    pub rebuildable: bool,\n");
        content.push_str("}\n\n");

        content.push_str("pub fn declared_projections() -> Vec<ProjectionInfo> {\n");
        content.push_str("    vec![\n");

        for proj in &manifest.projections {
            content.push_str(&format!(
                "        ProjectionInfo {{\n            name: \"{}\".to_string(),\n            input_events: vec![{}],\n            output_model: \"{}\".to_string(),\n            rebuildable: {},\n        }},\n",
                proj.projection_name,
                proj.input_events
                    .iter()
                    .map(|e| format!("\"{}\".to_string()", e))
                    .collect::<Vec<_>>()
                    .join(", "),
                proj.output_model,
                proj.rebuildable
            ));
        }

        content.push_str("    ]\n");
        content.push_str("}\n");

        fs::write(crate_path.join("src/projections.rs"), content)
            .context("Failed to write projections.rs")?;

        Ok(())
    }

    fn generate_jobs_rs(manifest: &ModuleManifest, crate_path: &Path) -> Result<()> {
        let mut content = String::new();

        content.push_str("use serde::{Deserialize, Serialize};\n\n");

        content.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
        content.push_str("pub struct JobInfo {\n");
        content.push_str("    pub job_id: String,\n");
        content.push_str("    pub kind: String,\n");
        content.push_str("}\n\n");

        content.push_str("pub fn declared_jobs() -> Vec<JobInfo> {\n");
        content.push_str("    vec![\n");

        for job in &manifest.jobs {
            content.push_str(&format!(
                "        JobInfo {{\n            job_id: \"{}\".to_string(),\n            kind: \"{}\".to_string(),\n        }},\n",
                job.job_id, job.kind
            ));
        }

        content.push_str("    ]\n");
        content.push_str("}\n");

        fs::write(crate_path.join("src/jobs.rs"), content)
            .context("Failed to write jobs.rs")?;

        Ok(())
    }
}
