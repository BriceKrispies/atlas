//! WASM plugin runtime with zero authority.
//!
//! Executes tenant-supplied WASM modules in a sandboxed environment with:
//! - Zero host imports (module must be self-contained)
//! - Bounded memory (16 MB)
//! - Bounded compute (1M fuel instructions)
//! - Wall-clock timeout (5 seconds)
//! - Fresh Store + Instance per invocation (no shared state)
//!
//! Plugin output is validated as a structured render tree IR before
//! being returned. Raw HTML output is not accepted.

use std::fmt;
use tracing::debug;

mod render_tree;

/// Result of a WASM plugin execution.
pub type PluginResult = Result<serde_json::Value, PluginError>;

/// Errors that can occur during WASM plugin execution.
#[derive(Debug)]
pub enum PluginError {
    /// Module has imports, violating zero-authority constraint.
    HasImports(usize),
    /// Module is missing a required export.
    MissingExport(&'static str),
    /// WASM execution trapped or ran out of fuel.
    ExecutionFailed(String),
    /// Plugin exceeded wall-clock timeout.
    Timeout,
    /// Plugin returned invalid output (not valid JSON or not an object).
    InvalidOutput(String),
    /// Failed to load or compile the module.
    LoadFailed(String),
}

impl fmt::Display for PluginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PluginError::HasImports(n) => {
                write!(f, "module has {} import(s), expected zero", n)
            }
            PluginError::MissingExport(name) => {
                write!(f, "module missing required export: {}", name)
            }
            PluginError::ExecutionFailed(msg) => {
                write!(f, "execution failed: {}", msg)
            }
            PluginError::Timeout => write!(f, "execution timed out (5s limit)"),
            PluginError::InvalidOutput(msg) => {
                write!(f, "invalid plugin output: {}", msg)
            }
            PluginError::LoadFailed(msg) => {
                write!(f, "failed to load module: {}", msg)
            }
        }
    }
}

impl std::error::Error for PluginError {}

const MEMORY_LIMIT: usize = 16 << 20; // 16 MB
const FUEL_LIMIT: u64 = 1_000_000;
const TIMEOUT_SECS: u64 = 5;

/// Execute a WASM plugin with zero authority.
///
/// The module must:
/// - Have zero imports (no host functions)
/// - Export `alloc(len: i32) -> i32`
/// - Export `render(ptr: i32, len: i32) -> i64`
/// - Export `memory`
///
/// Returns the parsed JSON output from the plugin's `render` function,
/// or a `PluginError` if anything goes wrong.
pub async fn execute_plugin(
    wasm_bytes: &[u8],
    input: &serde_json::Value,
) -> PluginResult {
    let wasm_bytes = wasm_bytes.to_vec();
    let input_json = serde_json::to_vec(input)
        .map_err(|e| PluginError::ExecutionFailed(format!("failed to serialize input: {}", e)))?;

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(TIMEOUT_SECS),
        tokio::task::spawn_blocking(move || {
            execute_plugin_sync(&wasm_bytes, &input_json)
        }),
    )
    .await;

    match result {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => Err(PluginError::ExecutionFailed(format!(
            "task join error: {}",
            e
        ))),
        Err(_) => Err(PluginError::Timeout),
    }
}

fn execute_plugin_sync(wasm_bytes: &[u8], input_json: &[u8]) -> PluginResult {
    // 1. Create engine with fuel consumption enabled
    let mut config = wasmtime::Config::new();
    config.consume_fuel(true);
    let engine = wasmtime::Engine::new(&config)
        .map_err(|e| PluginError::LoadFailed(format!("engine creation failed: {}", e)))?;

    // 2. Compile module
    let module = wasmtime::Module::new(&engine, wasm_bytes)
        .map_err(|e| PluginError::LoadFailed(format!("compilation failed: {}", e)))?;

    // 3. Reject if module has any imports (zero authority enforcement)
    let import_count = module.imports().len();
    if import_count > 0 {
        return Err(PluginError::HasImports(import_count));
    }

    // 4. Create store with fuel and memory limits
    let store_limits = wasmtime::StoreLimitsBuilder::new()
        .memory_size(MEMORY_LIMIT)
        .build();
    let mut store = wasmtime::Store::new(&engine, store_limits);
    store.set_fuel(FUEL_LIMIT)
        .map_err(|e| PluginError::ExecutionFailed(format!("failed to set fuel: {}", e)))?;
    store.limiter(|limits| limits);

    // 5. Instantiate module with empty imports
    let instance = wasmtime::Instance::new(&mut store, &module, &[])
        .map_err(|e| PluginError::ExecutionFailed(format!("instantiation failed: {}", e)))?;

    // 6. Get required exports
    let memory = instance
        .get_memory(&mut store, "memory")
        .ok_or(PluginError::MissingExport("memory"))?;

    let alloc_fn = instance
        .get_typed_func::<i32, i32>(&mut store, "alloc")
        .map_err(|_| PluginError::MissingExport("alloc"))?;

    let render_fn = instance
        .get_typed_func::<(i32, i32), i64>(&mut store, "render")
        .map_err(|_| PluginError::MissingExport("render"))?;

    // 7. Allocate space in WASM memory and write input
    let input_len = input_json.len() as i32;
    let input_ptr = alloc_fn
        .call(&mut store, input_len)
        .map_err(|e| PluginError::ExecutionFailed(format!("alloc call failed: {}", e)))?;

    memory
        .write(&mut store, input_ptr as usize, input_json)
        .map_err(|e| {
            PluginError::ExecutionFailed(format!("failed to write input to WASM memory: {}", e))
        })?;

    debug!(
        input_ptr = input_ptr,
        input_len = input_len,
        "Wrote input to WASM memory"
    );

    // 8. Call render
    let packed_result = render_fn
        .call(&mut store, (input_ptr, input_len))
        .map_err(|e| PluginError::ExecutionFailed(format!("render call failed: {}", e)))?;

    // 9. Unpack result: lower 32 bits = ptr, upper 32 bits = len
    let out_ptr = (packed_result & 0xFFFF_FFFF) as i32;
    let out_len = ((packed_result >> 32) & 0xFFFF_FFFF) as i32;

    if out_len <= 0 || out_ptr < 0 {
        return Err(PluginError::InvalidOutput(format!(
            "invalid result pointer/length: ptr={}, len={}",
            out_ptr, out_len
        )));
    }

    // 10. Read output from WASM memory
    let mut output_buf = vec![0u8; out_len as usize];
    memory
        .read(&store, out_ptr as usize, &mut output_buf)
        .map_err(|e| {
            PluginError::InvalidOutput(format!("failed to read output from WASM memory: {}", e))
        })?;

    debug!(
        out_ptr = out_ptr,
        out_len = out_len,
        "Read output from WASM memory"
    );

    // 11. Check serialized size (V15: ≤ 1 MB)
    if output_buf.len() > render_tree::MAX_SERIALIZED_SIZE {
        return Err(PluginError::InvalidOutput(format!(
            "serialized output exceeds 1 MB limit ({} bytes)",
            output_buf.len()
        )));
    }

    // 12. Parse as JSON and validate it's an object
    let output: serde_json::Value = serde_json::from_slice(&output_buf).map_err(|e| {
        let preview = String::from_utf8_lossy(&output_buf[..output_buf.len().min(200)]);
        PluginError::InvalidOutput(format!("not valid JSON: {} (output: {})", e, preview))
    })?;

    if !output.is_object() {
        return Err(PluginError::InvalidOutput(
            "output must be a JSON object".to_string(),
        ));
    }

    // 13. Validate render tree structure (V1-V17)
    render_tree::validate_render_tree(&output)?;

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demo_wasm_bytes() -> Vec<u8> {
        // Load the pre-built demo-transform WASM from the plugins directory
        let wasm_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("plugins/demo-transform/target/wasm32-unknown-unknown/release/demo_transform.wasm");

        std::fs::read(&wasm_path).unwrap_or_else(|e| {
            panic!(
                "Could not read demo WASM at {:?}: {}. \
                 Build it first with: cargo build --manifest-path plugins/demo-transform/Cargo.toml \
                 --target wasm32-unknown-unknown --release",
                wasm_path, e
            )
        })
    }

    #[tokio::test]
    async fn test_execute_demo_plugin() {
        let wasm = demo_wasm_bytes();
        let input = serde_json::json!({
            "pageId": "page-123",
            "title": "My Page",
            "slug": "my-page",
            "tenantId": "tenant-001",
            "createdAt": "2026-02-09T10:00:00+00:00"
        });

        let result = execute_plugin(&wasm, &input).await;
        let output = result.expect("plugin should succeed");

        // Output is a render tree with version and nodes
        assert_eq!(output["version"], 1);
        let nodes = output["nodes"].as_array().expect("nodes should be array");
        assert_eq!(nodes.len(), 2);

        // First node: heading
        assert_eq!(nodes[0]["type"], "heading");
        assert_eq!(nodes[0]["props"]["level"], 1);
        let heading_text = nodes[0]["children"][0]["props"]["content"]
            .as_str()
            .unwrap();
        assert_eq!(heading_text, "My Page");

        // Second node: paragraph with page info
        assert_eq!(nodes[1]["type"], "paragraph");
        let para_text = nodes[1]["children"][0]["props"]["content"]
            .as_str()
            .unwrap();
        assert!(para_text.contains("page-123"), "should contain pageId");
        assert!(para_text.contains("my-page"), "should contain slug");
    }

    #[tokio::test]
    async fn test_module_with_imports_rejected() {
        // A minimal WASM module that imports a function
        // (module (import "env" "abort" (func (param i32))))
        let wat = r#"(module (import "env" "abort" (func (param i32))))"#;
        let wasm = wat::parse_str(wat).expect("valid WAT");

        let input = serde_json::json!({});
        let result = execute_plugin(&wasm, &input).await;
        match result {
            Err(PluginError::HasImports(n)) => assert_eq!(n, 1),
            other => panic!("expected HasImports error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_fuel_exhaustion() {
        // A module with an infinite loop that will exhaust fuel
        let wat = r#"
            (module
                (memory (export "memory") 1)
                (func (export "alloc") (param i32) (result i32)
                    i32.const 0
                )
                (func (export "render") (param i32 i32) (result i64)
                    (local $i i32)
                    (loop $inf
                        (local.set $i (i32.add (local.get $i) (i32.const 1)))
                        (br $inf)
                    )
                    i64.const 0
                )
            )
        "#;
        let wasm = wat::parse_str(wat).expect("valid WAT");

        let input = serde_json::json!({"test": true});
        let result = execute_plugin(&wasm, &input).await;
        match result {
            Err(PluginError::ExecutionFailed(msg)) => {
                // wasmtime reports fuel exhaustion as a trap in the wasm backtrace
                assert!(
                    msg.contains("wasm") || msg.contains("fuel") || msg.contains("trap"),
                    "error should indicate execution failure: {}",
                    msg
                );
            }
            other => panic!("expected ExecutionFailed, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_invalid_output_json() {
        // A module that returns non-JSON bytes
        let wat = r#"
            (module
                (memory (export "memory") 1)
                (data (i32.const 100) "not json at all")
                (func (export "alloc") (param i32) (result i32)
                    i32.const 0
                )
                (func (export "render") (param i32 i32) (result i64)
                    ;; Return ptr=100, len=15 packed as i64
                    ;; upper 32 = len (15), lower 32 = ptr (100)
                    i64.const 64424509540
                )
            )
        "#;
        // 15 << 32 | 100 = 64424509540
        let wasm = wat::parse_str(wat).expect("valid WAT");

        let input = serde_json::json!({"test": true});
        let result = execute_plugin(&wasm, &input).await;
        match result {
            Err(PluginError::InvalidOutput(msg)) => {
                assert!(
                    msg.contains("not valid JSON"),
                    "error should mention JSON: {}",
                    msg
                );
            }
            other => panic!("expected InvalidOutput, got: {:?}", other),
        }
    }
}
