use crate::generators::openapi::{OpenApiConfig, OpenApiGenerator};
use crate::types::{HealthSpec, OpenApiSpec, ServiceManifest, ServiceType};
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

pub struct ScaffoldGenerator;

impl ScaffoldGenerator {
    pub fn generate(
        service_name: &str,
        service_type: ServiceType,
        language: &str,
        openapi_source: Option<&str>,
        _openapi_format: &str,
        openapi_base_path: &str,
        openapi_tags: Option<&[String]>,
        openapi_ops: Option<&[String]>,
        dry_run: bool,
    ) -> Result<()> {
        let service_dir = Path::new("apps").join(service_name);

        if !dry_run {
            fs::create_dir_all(&service_dir)
                .context(format!("Failed to create directory: {:?}", service_dir))?;
        }

        let openapi_spec = if let Some(source) = openapi_source {
            let config = OpenApiConfig {
                source: source.to_string(),
                base_path: openapi_base_path.to_string(),
                tags: openapi_tags.map(|t| t.to_vec()),
                ops: openapi_ops.map(|o| o.to_vec()),
            };

            let generator = OpenApiGenerator::new(config)?;
            let spec = Some(OpenApiSpec {
                source: source.to_string(),
                base_path: openapi_base_path.to_string(),
                tags: openapi_tags.map(|t| t.to_vec()).unwrap_or_default(),
                ops: openapi_ops.map(|o| o.to_vec()).unwrap_or_default(),
                hash: generator.hash().to_string(),
            });

            if language == "rust" {
                generator.generate_rust_code(&service_dir, dry_run)?;
            } else {
                anyhow::bail!(
                    "OpenAPI code generation is only supported for Rust. Got: {}",
                    language
                );
            }

            spec
        } else {
            None
        };

        let manifest = ServiceManifest {
            name: service_name.to_string(),
            service_type: service_type.clone(),
            language: language.to_string(),
            ports: Self::default_ports(&service_type),
            env: HashMap::new(),
            secrets: vec![],
            kafka: Self::default_kafka(&service_type),
            resources: None,
            replicas: Some(1),
            health: HealthSpec::default(),
            openapi: openapi_spec,
        };

        let manifest_path = service_dir.join("service.yaml");
        if !dry_run {
            let yaml = manifest.to_yaml()?;
            fs::write(&manifest_path, yaml)
                .context(format!("Failed to write manifest: {:?}", manifest_path))?;
        }

        Self::generate_code(&service_dir, &manifest, dry_run)?;
        Self::generate_run_script(&service_dir, &manifest, dry_run)?;

        Ok(())
    }

    fn default_ports(service_type: &ServiceType) -> Vec<crate::types::PortSpec> {
        match service_type {
            ServiceType::Api | ServiceType::Hybrid => {
                vec![crate::types::PortSpec {
                    name: "http".to_string(),
                    container_port: 8080,
                    protocol: crate::types::PortProtocol::TCP,
                }]
            }
            ServiceType::Worker | ServiceType::Projector => vec![],
        }
    }

    fn default_kafka(service_type: &ServiceType) -> Option<crate::types::KafkaSpec> {
        match service_type {
            ServiceType::Projector => Some(crate::types::KafkaSpec {
                consumes: vec![],
                produces: vec![],
            }),
            _ => None,
        }
    }

    fn generate_code(
        service_dir: &Path,
        manifest: &ServiceManifest,
        dry_run: bool,
    ) -> Result<()> {
        match manifest.language.as_str() {
            "rust" => Self::generate_rust_code(service_dir, manifest, dry_run),
            "typescript" | "javascript" => {
                Self::generate_typescript_code(service_dir, manifest, dry_run)
            }
            "python" => Self::generate_python_code(service_dir, manifest, dry_run),
            "go" => Self::generate_go_code(service_dir, manifest, dry_run),
            _ => Self::generate_generic_code(service_dir, manifest, dry_run),
        }
    }

    fn generate_rust_code(
        service_dir: &Path,
        manifest: &ServiceManifest,
        dry_run: bool,
    ) -> Result<()> {
        let cargo_toml = format!(
            r#"[package]
name = "{}"
version = "0.1.0"
edition = "2021"

[workspace]

[dependencies]
anyhow = "1.0"
tokio = {{ version = "1.35", features = ["full"] }}
{}serde = {{ version = "1.0", features = ["derive"] }}
serde_json = "1.0"
tracing = "0.1"
tracing-subscriber = {{ version = "0.3", features = ["env-filter", "json"] }}
"#,
            manifest.name,
            if matches!(
                manifest.service_type,
                ServiceType::Api | ServiceType::Hybrid
            ) {
                "axum = \"0.7\"\n"
            } else {
                ""
            }
        );

        let main_rs = match manifest.service_type {
            ServiceType::Api | ServiceType::Hybrid => Self::rust_api_template(manifest),
            ServiceType::Worker => Self::rust_worker_template(manifest),
            ServiceType::Projector => Self::rust_projector_template(manifest),
        };

        if !dry_run {
            fs::create_dir_all(service_dir.join("src"))?;
            fs::write(service_dir.join("Cargo.toml"), cargo_toml)?;
            fs::write(service_dir.join("src").join("main.rs"), main_rs)?;
        }

        Ok(())
    }

    fn rust_api_template(manifest: &ServiceManifest) -> String {
        let has_openapi = manifest.openapi.is_some();

        if has_openapi {
            format!(
                r#"mod generated;
mod handlers;

use axum::{{routing::get, Router}};
use std::net::SocketAddr;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {{
    atlas_core::init_logging();

    info!("Starting {} service", "{}");

    let app = Router::new()
        .route("{}", get(health_check))
        .route("{}", get(health_check))
        .merge(generated::routes::create_router());

    let addr = SocketAddr::from(([0, 0, 0, 0], {}));
    info!("Listening on {{}}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}}

async fn health_check() -> &'static str {{
    "OK"
}}
"#,
                manifest.name,
                manifest.name,
                manifest.health.liveness_path,
                manifest.health.readiness_path,
                manifest.ports.first().map(|p| p.container_port).unwrap_or(8080)
            )
        } else {
            format!(
                r#"use axum::{{routing::get, Router}};
use std::net::SocketAddr;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {{
    atlas_core::init_logging();

    info!("Starting {} service", "{}");

    let app = Router::new()
        .route("{}", get(health_check))
        .route("{}", get(health_check));

    let addr = SocketAddr::from(([0, 0, 0, 0], {}));
    info!("Listening on {{}}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}}

async fn health_check() -> &'static str {{
    "OK"
}}
"#,
                manifest.name,
                manifest.name,
                manifest.health.liveness_path,
                manifest.health.readiness_path,
                manifest.ports.first().map(|p| p.container_port).unwrap_or(8080)
            )
        }
    }

    fn rust_worker_template(manifest: &ServiceManifest) -> String {
        format!(
            r#"use std::time::Duration;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {{
    atlas_core::init_logging();

    info!("Starting {} worker", "{}");

    loop {{
        info!("Processing work...");
        tokio::time::sleep(Duration::from_secs(10)).await;
    }}
}}
"#,
            manifest.name, manifest.name
        )
    }

    fn rust_projector_template(manifest: &ServiceManifest) -> String {
        format!(
            r#"use std::time::Duration;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {{
    atlas_core::init_logging();

    info!("Starting {} projector", "{}");

    loop {{
        info!("Processing events...");
        tokio::time::sleep(Duration::from_secs(5)).await;
    }}
}}
"#,
            manifest.name, manifest.name
        )
    }

    fn generate_typescript_code(
        service_dir: &Path,
        manifest: &ServiceManifest,
        dry_run: bool,
    ) -> Result<()> {
        let package_json = format!(
            r#"{{
  "name": "{}",
  "version": "0.1.0",
  "private": true,
  "scripts": {{
    "start": "node src/index.js",
    "dev": "nodemon src/index.js"
  }},
  "dependencies": {{
    {}
  }}
}}
"#,
            manifest.name,
            if matches!(
                manifest.service_type,
                ServiceType::Api | ServiceType::Hybrid
            ) {
                "\"express\": \"^4.18.0\""
            } else {
                ""
            }
        );

        let index_js = match manifest.service_type {
            ServiceType::Api | ServiceType::Hybrid => Self::typescript_api_template(manifest),
            ServiceType::Worker => Self::typescript_worker_template(manifest),
            ServiceType::Projector => Self::typescript_projector_template(manifest),
        };

        if !dry_run {
            fs::create_dir_all(service_dir.join("src"))?;
            fs::write(service_dir.join("package.json"), package_json)?;
            fs::write(service_dir.join("src").join("index.js"), index_js)?;
        }

        Ok(())
    }

    fn typescript_api_template(manifest: &ServiceManifest) -> String {
        format!(
            r#"const express = require('express');
const app = express();

const PORT = {};

app.get('{}', (req, res) => {{
  res.send('OK');
}});

app.get('{}', (req, res) => {{
  res.send('OK');
}});

app.listen(PORT, () => {{
  console.log(JSON.stringify({{ level: 'info', message: 'Starting {} service', port: PORT }}));
}});
"#,
            manifest.ports.first().map(|p| p.container_port).unwrap_or(8080),
            manifest.health.liveness_path,
            manifest.health.readiness_path,
            manifest.name
        )
    }

    fn typescript_worker_template(manifest: &ServiceManifest) -> String {
        format!(
            r#"console.log(JSON.stringify({{ level: 'info', message: 'Starting {} worker' }}));

setInterval(() => {{
  console.log(JSON.stringify({{ level: 'info', message: 'Processing work...' }}));
}}, 10000);
"#,
            manifest.name
        )
    }

    fn typescript_projector_template(manifest: &ServiceManifest) -> String {
        format!(
            r#"console.log(JSON.stringify({{ level: 'info', message: 'Starting {} projector' }}));

setInterval(() => {{
  console.log(JSON.stringify({{ level: 'info', message: 'Processing events...' }}));
}}, 5000);
"#,
            manifest.name
        )
    }

    fn generate_python_code(
        service_dir: &Path,
        manifest: &ServiceManifest,
        dry_run: bool,
    ) -> Result<()> {
        let requirements = if matches!(
            manifest.service_type,
            ServiceType::Api | ServiceType::Hybrid
        ) {
            "flask==3.0.0\n"
        } else {
            ""
        };

        let main_py = match manifest.service_type {
            ServiceType::Api | ServiceType::Hybrid => Self::python_api_template(manifest),
            ServiceType::Worker => Self::python_worker_template(manifest),
            ServiceType::Projector => Self::python_projector_template(manifest),
        };

        if !dry_run {
            fs::write(service_dir.join("requirements.txt"), requirements)?;
            fs::write(service_dir.join("main.py"), main_py)?;
        }

        Ok(())
    }

    fn python_api_template(manifest: &ServiceManifest) -> String {
        format!(
            r#"from flask import Flask
import json
import sys

app = Flask(__name__)

@app.route('{}')
def liveness():
    return 'OK'

@app.route('{}')
def readiness():
    return 'OK'

if __name__ == '__main__':
    print(json.dumps({{'level': 'info', 'message': 'Starting {} service'}}), file=sys.stderr)
    app.run(host='0.0.0.0', port={})
"#,
            manifest.health.liveness_path,
            manifest.health.readiness_path,
            manifest.name,
            manifest.ports.first().map(|p| p.container_port).unwrap_or(8080)
        )
    }

    fn python_worker_template(manifest: &ServiceManifest) -> String {
        format!(
            r#"import time
import json
import sys

print(json.dumps({{'level': 'info', 'message': 'Starting {} worker'}}), file=sys.stderr)

while True:
    print(json.dumps({{'level': 'info', 'message': 'Processing work...'}}), file=sys.stderr)
    time.sleep(10)
"#,
            manifest.name
        )
    }

    fn python_projector_template(manifest: &ServiceManifest) -> String {
        format!(
            r#"import time
import json
import sys

print(json.dumps({{'level': 'info', 'message': 'Starting {} projector'}}), file=sys.stderr)

while True:
    print(json.dumps({{'level': 'info', 'message': 'Processing events...'}}), file=sys.stderr)
    time.sleep(5)
"#,
            manifest.name
        )
    }

    fn generate_go_code(
        service_dir: &Path,
        manifest: &ServiceManifest,
        dry_run: bool,
    ) -> Result<()> {
        let go_mod = format!(
            r#"module {}

go 1.21
"#,
            manifest.name
        );

        let main_go = match manifest.service_type {
            ServiceType::Api | ServiceType::Hybrid => Self::go_api_template(manifest),
            ServiceType::Worker => Self::go_worker_template(manifest),
            ServiceType::Projector => Self::go_projector_template(manifest),
        };

        if !dry_run {
            fs::write(service_dir.join("go.mod"), go_mod)?;
            fs::write(service_dir.join("main.go"), main_go)?;
        }

        Ok(())
    }

    fn go_api_template(manifest: &ServiceManifest) -> String {
        format!(
            r#"package main

import (
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "os"
)

func healthCheck(w http.ResponseWriter, r *http.Request) {{
    fmt.Fprint(w, "OK")
}}

func main() {{
    msg, _ := json.Marshal(map[string]string{{"level": "info", "message": "Starting {} service"}})
    fmt.Fprintln(os.Stderr, string(msg))

    http.HandleFunc("{}", healthCheck)
    http.HandleFunc("{}", healthCheck)

    addr := ":{}";
    log.Fatal(http.ListenAndServe(addr, nil))
}}
"#,
            manifest.name,
            manifest.health.liveness_path,
            manifest.health.readiness_path,
            manifest.ports.first().map(|p| p.container_port).unwrap_or(8080)
        )
    }

    fn go_worker_template(manifest: &ServiceManifest) -> String {
        format!(
            r#"package main

import (
    "encoding/json"
    "fmt"
    "os"
    "time"
)

func main() {{
    msg, _ := json.Marshal(map[string]string{{"level": "info", "message": "Starting {} worker"}})
    fmt.Fprintln(os.Stderr, string(msg))

    for {{
        msg, _ := json.Marshal(map[string]string{{"level": "info", "message": "Processing work..."}})
        fmt.Fprintln(os.Stderr, string(msg))
        time.Sleep(10 * time.Second)
    }}
}}
"#,
            manifest.name
        )
    }

    fn go_projector_template(manifest: &ServiceManifest) -> String {
        format!(
            r#"package main

import (
    "encoding/json"
    "fmt"
    "os"
    "time"
)

func main() {{
    msg, _ := json.Marshal(map[string]string{{"level": "info", "message": "Starting {} projector"}})
    fmt.Fprintln(os.Stderr, string(msg))

    for {{
        msg, _ := json.Marshal(map[string]string{{"level": "info", "message": "Processing events..."}})
        fmt.Fprintln(os.Stderr, string(msg))
        time.Sleep(5 * time.Second)
    }}
}}
"#,
            manifest.name
        )
    }

    fn generate_generic_code(
        service_dir: &Path,
        manifest: &ServiceManifest,
        dry_run: bool,
    ) -> Result<()> {
        let readme = format!(
            r#"# {}

Service type: {:?}
Language: {}

## Setup

Add your application code here.
"#,
            manifest.name, manifest.service_type, manifest.language
        );

        if !dry_run {
            fs::write(service_dir.join("README.md"), readme)?;
        }

        Ok(())
    }

    fn generate_run_script(
        service_dir: &Path,
        manifest: &ServiceManifest,
        dry_run: bool,
    ) -> Result<()> {
        let (script_name, script_content) = match manifest.language.as_str() {
            "rust" => ("run.sh", Self::rust_run_script()),
            "typescript" | "javascript" => ("run.sh", Self::typescript_run_script()),
            "python" => ("run.sh", Self::python_run_script()),
            "go" => ("run.sh", Self::go_run_script()),
            _ => ("run.sh", Self::generic_run_script()),
        };

        if !dry_run {
            let script_path = service_dir.join(script_name);
            fs::write(&script_path, script_content)?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = fs::metadata(&script_path)?.permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&script_path, perms)?;
            }
        }

        Ok(())
    }

    fn rust_run_script() -> String {
        "#!/bin/bash\ncargo run\n".to_string()
    }

    fn typescript_run_script() -> String {
        "#!/bin/bash\nnpm install\nnpm start\n".to_string()
    }

    fn python_run_script() -> String {
        "#!/bin/bash\npip install -r requirements.txt\npython main.py\n".to_string()
    }

    fn go_run_script() -> String {
        "#!/bin/bash\ngo run main.go\n".to_string()
    }

    fn generic_run_script() -> String {
        "#!/bin/bash\necho \"Add run command for your language\"\n".to_string()
    }
}
