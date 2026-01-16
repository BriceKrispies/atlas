mod http;
mod types;

use anyhow::{Context, Result};
use chrono::Utc;
use clap::{Parser, Subcommand, ValueEnum};
use http::AtlasClient;
use std::fs;
use types::{EventEnvelope, HealthResponse, IntentResponse};
use uuid::Uuid;

#[derive(Parser)]
#[command(name = "atlasctl")]
#[command(author, version, about = "Atlas Platform controller client")]
#[command(long_about = "atlasctl is the operator/controller client for interacting with the Atlas platform.\n\n\
    It communicates exclusively over HTTP with the ingress service and control plane API.\n\
    All operations are subject to the same authentication and authorization as other clients.\n\n\
    See specs/crosscut/atlasctl.md for the full specification.")]
struct Cli {
    #[arg(long, env = "ATLAS_BASE_URL", default_value = "http://localhost:3000")]
    #[arg(help = "Base URL for the Atlas ingress service")]
    base_url: String,

    #[arg(long, env = "ATLAS_TIMEOUT_MS", default_value = "30000")]
    #[arg(help = "Request timeout in milliseconds")]
    timeout_ms: u64,

    #[arg(long, short, value_enum, default_value = "json")]
    #[arg(help = "Output format")]
    output: OutputFormat,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Clone, ValueEnum)]
enum OutputFormat {
    Json,
    Table,
}

#[derive(Subcommand)]
enum Commands {
    #[command(about = "Check service health and status")]
    Status,

    #[command(subcommand)]
    #[command(about = "Action-related commands")]
    Actions(ActionsCommands),

    #[command(about = "Invoke an intent action")]
    #[command(long_about = "Submit an intent to the Atlas platform.\n\n\
        The data payload must contain at minimum:\n\
        - actionId: The action identifier (e.g., ContentPages.Page.Create)\n\
        - resourceType: The resource type (e.g., Page)\n\n\
        Example:\n\
        atlasctl invoke ContentPages.PageCreate --tenant tenant-001 --data '{\"actionId\": \"ContentPages.Page.Create\", \"resourceType\": \"Page\"}'")]
    Invoke {
        #[arg(help = "Action name (used as event_type prefix)")]
        action: String,

        #[arg(long, help = "Tenant ID for the request")]
        tenant: Option<String>,

        #[arg(long, value_name = "PRINCIPAL", help = "Debug principal (format: type:id or type:id:tenant)")]
        #[arg(long_help = "Debug principal for test authentication.\n\
            Only works when ingress is compiled with test-auth feature and TEST_AUTH_ENABLED=true.\n\
            Format: type:id or type:id:tenant_id\n\
            Examples: user:123, service:worker, user:456:tenant-xyz")]
        r#as: Option<String>,

        #[arg(long, value_name = "JSON", help = "Payload data (inline JSON or @filename)")]
        data: String,

        #[arg(long, help = "Idempotency key (auto-generated if not provided)")]
        idempotency_key: Option<String>,

        #[arg(long, help = "Correlation ID (auto-generated if not provided)")]
        correlation_id: Option<String>,

        #[arg(long, help = "Event ID (auto-generated if not provided)")]
        event_id: Option<String>,
    },

    #[command(about = "Trace a request by correlation ID")]
    #[command(long_about = "Query the system for events and logs associated with a correlation ID.\n\n\
        NOTE: This command requires a trace endpoint that is not yet implemented.\n\
        See specs/crosscut/atlasctl.md for the specification.")]
    Trace {
        #[arg(help = "Correlation ID to trace")]
        correlation_id: String,
    },
}

#[derive(Subcommand)]
enum ActionsCommands {
    #[command(about = "List available actions")]
    #[command(long_about = "List actions registered in the module manifests.\n\n\
        NOTE: This command requires a discovery endpoint that is not yet implemented.\n\
        See specs/crosscut/atlasctl.md for the specification.")]
    List,
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("Error: {:#}", e);
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();
    let client = AtlasClient::new(cli.base_url, cli.timeout_ms)?;

    match cli.command {
        Commands::Status => cmd_status(&client, &cli.output).await,
        Commands::Actions(ActionsCommands::List) => cmd_actions_list(&cli.output).await,
        Commands::Invoke {
            action,
            tenant,
            r#as,
            data,
            idempotency_key,
            correlation_id,
            event_id,
        } => {
            cmd_invoke(
                &client,
                &cli.output,
                action,
                tenant,
                r#as,
                data,
                idempotency_key,
                correlation_id,
                event_id,
            )
            .await
        }
        Commands::Trace { correlation_id } => cmd_trace(&correlation_id, &cli.output).await,
    }
}

async fn cmd_status(client: &AtlasClient, output: &OutputFormat) -> Result<()> {
    let response = client.get_raw("/").await?;

    if response.is_success() {
        let health: HealthResponse =
            serde_json::from_str(&response.body).context("Failed to parse health response")?;
        print_output(output, &health)?;
    } else {
        eprintln!(
            "Service unhealthy: HTTP {} - {}",
            response.status.as_u16(),
            response.body
        );
        std::process::exit(1);
    }

    Ok(())
}

async fn cmd_actions_list(output: &OutputFormat) -> Result<()> {
    let message = serde_json::json!({
        "error": "not_implemented",
        "message": "No known endpoint for listing actions. See specs/crosscut/atlasctl.md for the API Surface Expectations.",
        "todo": "Requires discovery endpoint to be implemented in ingress or control plane."
    });
    print_output(output, &message)?;
    std::process::exit(1);
}

async fn cmd_invoke(
    client: &AtlasClient,
    output: &OutputFormat,
    action: String,
    tenant: Option<String>,
    debug_principal: Option<String>,
    data: String,
    idempotency_key: Option<String>,
    correlation_id: Option<String>,
    event_id: Option<String>,
) -> Result<()> {
    let payload = parse_data_arg(&data)?;

    let tenant_id = tenant.unwrap_or_else(|| "default".to_string());
    let correlation_id = correlation_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let idempotency_key = idempotency_key.unwrap_or_else(|| Uuid::new_v4().to_string());
    let event_id = event_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let envelope = EventEnvelope {
        event_id,
        event_type: format!("{}.Intent", action),
        schema_id: format!("{}.v1", action.to_lowercase()),
        schema_version: 1,
        occurred_at: Utc::now(),
        tenant_id: tenant_id.clone(),
        correlation_id: correlation_id.clone(),
        idempotency_key,
        causation_id: None,
        principal_id: None,
        user_id: None,
        cache_invalidation_tags: None,
        payload,
    };

    let client = AtlasClient::new(client.base_url().to_string(), 30000)?
        .with_debug_principal(debug_principal)
        .with_correlation_id(Some(correlation_id.clone()));

    let response = client.post_raw("/api/v1/intents", &envelope).await?;

    if response.is_success() {
        let intent_response: IntentResponse =
            serde_json::from_str(&response.body).context("Failed to parse intent response")?;
        let result = serde_json::json!({
            "status": "accepted",
            "correlation_id": correlation_id,
            "event_id": intent_response.event_id,
            "tenant_id": intent_response.tenant_id,
        });
        print_output(output, &result)?;
    } else {
        let error_body: serde_json::Value =
            serde_json::from_str(&response.body).unwrap_or(serde_json::json!({
                "raw": response.body
            }));
        let result = serde_json::json!({
            "status": "failed",
            "correlation_id": correlation_id,
            "http_status": response.status.as_u16(),
            "error": error_body,
        });
        print_output(output, &result)?;
        std::process::exit(1);
    }

    Ok(())
}

async fn cmd_trace(correlation_id: &str, output: &OutputFormat) -> Result<()> {
    let message = serde_json::json!({
        "error": "not_implemented",
        "message": "No known endpoint for tracing by correlation ID. See specs/crosscut/atlasctl.md for the API Surface Expectations.",
        "correlation_id": correlation_id,
        "todo": "Requires trace endpoint to be implemented."
    });
    print_output(output, &message)?;
    std::process::exit(1);
}

fn parse_data_arg(data: &str) -> Result<serde_json::Value> {
    if let Some(path) = data.strip_prefix('@') {
        let content = fs::read_to_string(path)
            .with_context(|| format!("Failed to read file: {}", path))?;
        serde_json::from_str(&content)
            .with_context(|| format!("Failed to parse JSON from file: {}", path))
    } else {
        serde_json::from_str(data).context("Failed to parse inline JSON data")
    }
}

fn print_output<T: serde::Serialize>(format: &OutputFormat, value: &T) -> Result<()> {
    match format {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(value)?);
        }
        OutputFormat::Table => {
            println!("{}", serde_json::to_string_pretty(value)?);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_data_inline_json() {
        let result = parse_data_arg(r#"{"key": "value"}"#).unwrap();
        assert_eq!(result["key"], "value");
    }

    #[test]
    fn test_parse_data_inline_json_complex() {
        let result =
            parse_data_arg(r#"{"actionId": "Test.Action", "resourceType": "Resource"}"#).unwrap();
        assert_eq!(result["actionId"], "Test.Action");
        assert_eq!(result["resourceType"], "Resource");
    }

    #[test]
    fn test_parse_data_invalid_json() {
        let result = parse_data_arg("not valid json");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_data_file_not_found() {
        let result = parse_data_arg("@nonexistent_file.json");
        assert!(result.is_err());
    }

    #[test]
    fn test_cli_parse_status() {
        let cli = Cli::try_parse_from(["atlasctl", "status"]).unwrap();
        assert!(matches!(cli.command, Commands::Status));
        assert_eq!(cli.base_url, "http://localhost:3000");
    }

    #[test]
    fn test_cli_parse_invoke_with_data() {
        let cli = Cli::try_parse_from([
            "atlasctl",
            "invoke",
            "TestAction",
            "--data",
            r#"{"test": true}"#,
        ])
        .unwrap();
        match cli.command {
            Commands::Invoke { action, data, .. } => {
                assert_eq!(action, "TestAction");
                assert_eq!(data, r#"{"test": true}"#);
            }
            _ => panic!("Expected Invoke command"),
        }
    }

    #[test]
    fn test_cli_parse_invoke_with_file() {
        let cli = Cli::try_parse_from([
            "atlasctl",
            "invoke",
            "TestAction",
            "--data",
            "@payload.json",
        ])
        .unwrap();
        match cli.command {
            Commands::Invoke { data, .. } => {
                assert_eq!(data, "@payload.json");
            }
            _ => panic!("Expected Invoke command"),
        }
    }

    #[test]
    fn test_cli_parse_custom_base_url() {
        let cli =
            Cli::try_parse_from(["atlasctl", "--base-url", "http://custom:9000", "status"]).unwrap();
        assert_eq!(cli.base_url, "http://custom:9000");
    }

    #[test]
    fn test_cli_parse_timeout() {
        let cli =
            Cli::try_parse_from(["atlasctl", "--timeout-ms", "5000", "status"]).unwrap();
        assert_eq!(cli.timeout_ms, 5000);
    }

    #[test]
    fn test_cli_parse_output_format() {
        let cli = Cli::try_parse_from(["atlasctl", "--output", "table", "status"]).unwrap();
        assert!(matches!(cli.output, OutputFormat::Table));
    }

    #[test]
    fn test_cli_parse_invoke_full_options() {
        let cli = Cli::try_parse_from([
            "atlasctl",
            "invoke",
            "MyAction",
            "--tenant",
            "tenant-001",
            "--as",
            "user:123:tenant-001",
            "--data",
            r#"{"actionId": "Test"}"#,
            "--idempotency-key",
            "idem-123",
            "--correlation-id",
            "corr-456",
            "--event-id",
            "evt-789",
        ])
        .unwrap();
        match cli.command {
            Commands::Invoke {
                action,
                tenant,
                r#as,
                idempotency_key,
                correlation_id,
                event_id,
                ..
            } => {
                assert_eq!(action, "MyAction");
                assert_eq!(tenant, Some("tenant-001".to_string()));
                assert_eq!(r#as, Some("user:123:tenant-001".to_string()));
                assert_eq!(idempotency_key, Some("idem-123".to_string()));
                assert_eq!(correlation_id, Some("corr-456".to_string()));
                assert_eq!(event_id, Some("evt-789".to_string()));
            }
            _ => panic!("Expected Invoke command"),
        }
    }
}
