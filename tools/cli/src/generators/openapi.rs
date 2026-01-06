use anyhow::{Context, Result};
use heck::{ToSnakeCase, ToUpperCamelCase};
use openapiv3::{OpenAPI, Operation, Parameter, PathItem, ReferenceOr, RequestBody, Schema, SchemaKind, Type};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

pub struct OpenApiConfig {
    pub source: String,
    pub base_path: String,
    pub tags: Option<Vec<String>>,
    pub ops: Option<Vec<String>>,
}

pub struct OpenApiGenerator {
    spec: OpenAPI,
    config: OpenApiConfig,
    hash: String,
}

impl OpenApiGenerator {
    pub fn new(config: OpenApiConfig) -> Result<Self> {
        let content = Self::load_spec(&config.source)?;
        let hash = Self::compute_hash(&content);

        let spec = if config.source.ends_with(".json")
            || (!config.source.ends_with(".yaml") && !config.source.ends_with(".yml"))
        {
            serde_json::from_str(&content)
                .context("Failed to parse OpenAPI spec as JSON")?
        } else {
            serde_yaml::from_str(&content)
                .context("Failed to parse OpenAPI spec as YAML")?
        };

        Ok(Self { spec, config, hash })
    }

    fn load_spec(source: &str) -> Result<String> {
        if source.starts_with("http://") || source.starts_with("https://") {
            anyhow::bail!("URL support not implemented. Please use a local file path.");
        }

        fs::read_to_string(source)
            .context(format!("Failed to read OpenAPI spec from {}", source))
    }

    fn compute_hash(content: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        hex::encode(hasher.finalize())
    }

    pub fn hash(&self) -> &str {
        &self.hash
    }

    pub fn config(&self) -> &OpenApiConfig {
        &self.config
    }

    pub fn generate_rust_code(&self, service_dir: &Path, dry_run: bool) -> Result<()> {
        let operations = self.collect_operations()?;

        if operations.is_empty() {
            println!("  No operations found matching filters");
            return Ok(());
        }

        let generated_dir = service_dir.join("generated");
        let handlers_dir = service_dir.join("src").join("handlers");

        if !dry_run {
            fs::create_dir_all(&generated_dir)?;
            fs::create_dir_all(&handlers_dir)?;
        }

        self.generate_models(&generated_dir, &operations, dry_run)?;
        self.generate_routes(&generated_dir, &operations, dry_run)?;
        self.generate_validation(&generated_dir, &operations, dry_run)?;
        self.generate_handler_stubs(&handlers_dir, &operations, dry_run)?;
        self.generate_mod_rs(&generated_dir, dry_run)?;

        Ok(())
    }

    fn generate_mod_rs(&self, generated_dir: &Path, dry_run: bool) -> Result<()> {
        let mod_content = "pub mod models;\npub mod routes;\npub mod validation;\n";
        let mod_path = generated_dir.join("mod.rs");
        if !dry_run {
            fs::write(&mod_path, mod_content)?;
        }
        Ok(())
    }

    fn collect_operations(&self) -> Result<Vec<OperationInfo>> {
        let mut operations = Vec::new();
        let tag_filter: Option<HashSet<String>> = self
            .config
            .tags
            .as_ref()
            .map(|tags| tags.iter().cloned().collect());
        let ops_filter: Option<HashSet<String>> = self
            .config
            .ops
            .as_ref()
            .map(|ops| ops.iter().cloned().collect());

        for (path, item) in &self.spec.paths.paths {
            if let ReferenceOr::Item(path_item) = item {
                self.collect_path_operations(
                    path,
                    path_item,
                    &tag_filter,
                    &ops_filter,
                    &mut operations,
                )?;
            }
        }

        Ok(operations)
    }

    fn collect_path_operations(
        &self,
        path: &str,
        item: &PathItem,
        tag_filter: &Option<HashSet<String>>,
        ops_filter: &Option<HashSet<String>>,
        operations: &mut Vec<OperationInfo>,
    ) -> Result<()> {
        let methods = [
            ("get", &item.get),
            ("post", &item.post),
            ("put", &item.put),
            ("delete", &item.delete),
            ("patch", &item.patch),
            ("options", &item.options),
            ("head", &item.head),
            ("trace", &item.trace),
        ];

        for (method, op) in methods {
            if let Some(operation) = op {
                if self.should_include_operation(operation, tag_filter, ops_filter) {
                    let op_info = self.build_operation_info(path, method, operation)?;
                    operations.push(op_info);
                }
            }
        }

        Ok(())
    }

    fn should_include_operation(
        &self,
        operation: &Operation,
        tag_filter: &Option<HashSet<String>>,
        ops_filter: &Option<HashSet<String>>,
    ) -> bool {
        if let Some(ops) = ops_filter {
            if let Some(ref op_id) = operation.operation_id {
                return ops.contains(op_id);
            }
            return false;
        }

        if let Some(tags) = tag_filter {
            return operation
                .tags
                .iter()
                .any(|tag| tags.contains(tag));
        }

        true
    }

    fn build_operation_info(
        &self,
        path: &str,
        method: &str,
        operation: &Operation,
    ) -> Result<OperationInfo> {
        let operation_id = operation
            .operation_id
            .clone()
            .unwrap_or_else(|| format!("{}_{}", method, path.replace('/', "_").replace('{', "").replace('}', "")));

        let handler_name = operation_id.to_snake_case();
        let full_path = format!("{}{}", self.config.base_path.trim_end_matches('/'), path);

        Ok(OperationInfo {
            operation_id,
            handler_name,
            path: full_path,
            method: method.to_string(),
            summary: operation.summary.clone(),
            parameters: operation.parameters.clone(),
            request_body: operation.request_body.clone(),
        })
    }

    fn generate_models(
        &self,
        generated_dir: &Path,
        operations: &[OperationInfo],
        dry_run: bool,
    ) -> Result<()> {
        let mut models = String::from("use serde::{Deserialize, Serialize};\n\n");

        let mut seen_models = HashSet::new();

        for op in operations {
            if let Some(ref req_body) = op.request_body {
                if let ReferenceOr::Item(body) = req_body {
                    if let Some(content) = body.content.get("application/json") {
                        if let Some(schema) = &content.schema {
                            self.generate_schema_models(&mut models, &op.operation_id, schema, "Request", &mut seen_models)?;
                        }
                    }
                }
            }

            let response_model = format!("{}Response", op.operation_id.to_upper_camel_case());
            if !seen_models.contains(&response_model) {
                models.push_str(&format!(
                    "#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct {} {{\n    pub message: String,\n}}\n\n",
                    response_model
                ));
                seen_models.insert(response_model);
            }
        }

        let models_path = generated_dir.join("models.rs");
        if !dry_run {
            fs::write(&models_path, models)?;
        }

        Ok(())
    }

    fn generate_schema_models(
        &self,
        output: &mut String,
        base_name: &str,
        schema: &ReferenceOr<Schema>,
        suffix: &str,
        seen: &mut HashSet<String>,
    ) -> Result<()> {
        match schema {
            ReferenceOr::Item(schema) => {
                let model_name = format!("{}{}", base_name.to_upper_camel_case(), suffix);
                if seen.contains(&model_name) {
                    return Ok(());
                }
                seen.insert(model_name.clone());

                if let SchemaKind::Type(Type::Object(obj)) = &schema.schema_kind {
                    output.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
                    output.push_str(&format!("pub struct {} {{\n", model_name));

                    for (prop_name, prop_schema) in &obj.properties {
                        let field_name = prop_name.to_snake_case();
                        let field_type = self.schema_to_rust_type(prop_schema)?;
                        let is_required = obj.required.contains(prop_name);

                        if is_required {
                            output.push_str(&format!("    pub {}: {},\n", field_name, field_type));
                        } else {
                            output.push_str(&format!("    #[serde(skip_serializing_if = \"Option::is_none\")]\n"));
                            output.push_str(&format!("    pub {}: Option<{}>,\n", field_name, field_type));
                        }
                    }

                    output.push_str("}\n\n");
                }
            }
            ReferenceOr::Reference { .. } => {}
        }

        Ok(())
    }

    fn schema_to_rust_type(&self, schema: &ReferenceOr<Box<Schema>>) -> Result<String> {
        match schema {
            ReferenceOr::Item(schema) => {
                match &schema.schema_kind {
                    SchemaKind::Type(Type::String(_)) => Ok("String".to_string()),
                    SchemaKind::Type(Type::Integer(_)) => Ok("i64".to_string()),
                    SchemaKind::Type(Type::Number(_)) => Ok("f64".to_string()),
                    SchemaKind::Type(Type::Boolean(_)) => Ok("bool".to_string()),
                    SchemaKind::Type(Type::Array(arr)) => {
                        if let Some(items) = &arr.items {
                            let item_type = self.schema_to_rust_type(items)?;
                            Ok(format!("Vec<{}>", item_type))
                        } else {
                            Ok("Vec<serde_json::Value>".to_string())
                        }
                    }
                    _ => Ok("serde_json::Value".to_string()),
                }
            }
            ReferenceOr::Reference { .. } => Ok("serde_json::Value".to_string()),
        }
    }

    fn schema_ref_to_rust_type(&self, schema: &ReferenceOr<Schema>) -> Result<String> {
        match schema {
            ReferenceOr::Item(schema) => {
                match &schema.schema_kind {
                    SchemaKind::Type(Type::String(_)) => Ok("String".to_string()),
                    SchemaKind::Type(Type::Integer(_)) => Ok("i64".to_string()),
                    SchemaKind::Type(Type::Number(_)) => Ok("f64".to_string()),
                    SchemaKind::Type(Type::Boolean(_)) => Ok("bool".to_string()),
                    SchemaKind::Type(Type::Array(_arr)) => {
                        Ok("Vec<serde_json::Value>".to_string())
                    }
                    _ => Ok("serde_json::Value".to_string()),
                }
            }
            ReferenceOr::Reference { .. } => Ok("serde_json::Value".to_string()),
        }
    }

    fn generate_routes(
        &self,
        generated_dir: &Path,
        operations: &[OperationInfo],
        dry_run: bool,
    ) -> Result<()> {
        let mut routes = String::from("use axum::routing::{get, post, put, delete, patch};\nuse axum::Router;\nuse crate::handlers;\n\n");
        routes.push_str("pub fn create_router() -> Router {\n");
        routes.push_str("    Router::new()\n");

        for op in operations {
            let method = match op.method.as_str() {
                "get" => "get",
                "post" => "post",
                "put" => "put",
                "delete" => "delete",
                "patch" => "patch",
                _ => continue,
            };

            let axum_path = op.path.replace('{', ":").replace('}', "");

            routes.push_str(&format!(
                "        .route(\"{}\", {}(handlers::{}))\n",
                axum_path, method, op.handler_name
            ));
        }

        routes.push_str("}\n");

        let routes_path = generated_dir.join("routes.rs");
        if !dry_run {
            fs::write(&routes_path, routes)?;
        }

        Ok(())
    }

    fn generate_validation(
        &self,
        generated_dir: &Path,
        _operations: &[OperationInfo],
        dry_run: bool,
    ) -> Result<()> {
        let validation = r#"use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

pub struct ValidationError(pub String);

impl IntoResponse for ValidationError {
    fn into_response(self) -> Response {
        (StatusCode::BAD_REQUEST, self.0).into_response()
    }
}
"#;

        let validation_path = generated_dir.join("validation.rs");
        if !dry_run {
            fs::write(&validation_path, validation)?;
        }

        Ok(())
    }

    fn generate_handler_stubs(
        &self,
        handlers_dir: &Path,
        operations: &[OperationInfo],
        dry_run: bool,
    ) -> Result<()> {
        let mut handlers_mod = String::new();

        for op in operations {
            let handler_file = handlers_dir.join(format!("{}.rs", op.handler_name));

            if !dry_run && handler_file.exists() {
                continue;
            }

            let mut handler_code = String::from("use axum::http::StatusCode;\nuse axum::Json;\n");

            let path_params: Vec<String> = op.path
                .split('/')
                .filter(|s| s.starts_with(':'))
                .map(|s| s.trim_start_matches(':').to_snake_case())
                .collect();

            if !path_params.is_empty() {
                handler_code.push_str("use axum::extract::Path;\n");
            }

            handler_code.push_str("use crate::generated::models::*;\n\n");

            let has_body = op.request_body.is_some();
            let request_type = if has_body {
                format!("{}Request", op.operation_id.to_upper_camel_case())
            } else {
                String::new()
            };

            let response_type = format!("{}Response", op.operation_id.to_upper_camel_case());

            let mut params = Vec::new();

            if path_params.len() == 1 {
                params.push(format!("Path({}): Path<String>", path_params[0]));
            } else if path_params.len() > 1 {
                let param_tuple = path_params.join(", ");
                let type_tuple = vec!["String"; path_params.len()].join(", ");
                params.push(format!("Path(({}))Path<({})>", param_tuple, type_tuple));
            }

            if has_body {
                params.push(format!("Json(_payload): Json<{}>", request_type));
            }

            let params_str = params.join(", ");

            handler_code.push_str(&format!(
                "pub async fn {}({}) -> Result<Json<{}>, StatusCode> {{\n",
                op.handler_name,
                if params_str.is_empty() { "" } else { &params_str },
                response_type
            ));

            handler_code.push_str(&format!(
                "    Ok(Json({} {{\n        message: \"Not implemented\".to_string(),\n    }}))\n",
                response_type
            ));
            handler_code.push_str("}\n");

            if !dry_run {
                fs::write(&handler_file, handler_code)?;
            }

            handlers_mod.push_str(&format!("pub mod {};\npub use {}::{};\n", op.handler_name, op.handler_name, op.handler_name));
        }

        let mod_file = handlers_dir.join("mod.rs");
        if !dry_run {
            fs::write(&mod_file, handlers_mod)?;
        }

        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct OperationInfo {
    pub operation_id: String,
    pub handler_name: String,
    pub path: String,
    pub method: String,
    pub summary: Option<String>,
    pub parameters: Vec<ReferenceOr<Parameter>>,
    pub request_body: Option<ReferenceOr<RequestBody>>,
}
