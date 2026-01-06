use crate::types::{CacheArtifact, PrivacyLevel, VaryDimension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// Result type for cache operations
pub type CacheResult<T> = Result<T, CacheError>;

/// Cache operation errors
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CacheError {
    MissingRequiredKeyPart(String),
    MissingPlaceholder {
        tag_template: String,
        placeholder: String,
    },
    InvalidPrivacyConfiguration(String),
    InvalidTagTemplate(String),
}

impl std::fmt::Display for CacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CacheError::MissingRequiredKeyPart(key) => {
                write!(f, "Missing required key part: {}", key)
            }
            CacheError::MissingPlaceholder {
                tag_template,
                placeholder,
            } => {
                write!(
                    f,
                    "Missing placeholder '{}' in tag template '{}'",
                    placeholder, tag_template
                )
            }
            CacheError::InvalidPrivacyConfiguration(msg) => {
                write!(f, "Invalid privacy configuration: {}", msg)
            }
            CacheError::InvalidTagTemplate(msg) => write!(f, "Invalid tag template: {}", msg),
        }
    }
}

impl std::error::Error for CacheError {}

/// Build a deterministic cache key from artifact definition and runtime values
///
/// Format: cache:{artifactId}@{version}:{tenantId}:{...keyParts}:{varyHash}
///
/// # Arguments
/// * `artifact` - Cache artifact descriptor
/// * `key_values` - Runtime values for keyParts (e.g., {"tenantId": "acme", "pageId": "123"})
/// * `vary_values` - Optional runtime values for varyBy dimensions
///
/// # Returns
/// Deterministic cache key string
///
/// # Errors
/// Returns error if required key parts are missing
pub fn build_cache_key(
    artifact: &CacheArtifact,
    key_values: &HashMap<String, String>,
    vary_values: Option<&HashMap<String, String>>,
) -> CacheResult<String> {
    // Validate inputs first
    validate_cache_key_inputs(artifact, key_values, vary_values)?;

    let mut parts = Vec::new();

    // Prefix
    parts.push("cache".to_string());

    // Artifact ID with version
    parts.push(format!(
        "{}@v{}",
        artifact.artifact_id, artifact.ttl_seconds
    ));

    // Build stable key parts using tags as the ordered template
    // Tags like "tenant:{tenantId}" define the canonical order
    for tag_template in &artifact.tags {
        if let Some(key_name) = extract_placeholder(tag_template) {
            if let Some(value) = key_values.get(&key_name) {
                parts.push(value.clone());
            }
        }
    }

    // Add vary hash if present
    if let Some(vary_vals) = vary_values {
        if !vary_vals.is_empty() {
            let vary_hash = build_vary_hash(&artifact.vary_by, vary_vals);
            parts.push(vary_hash);
        }
    }

    Ok(parts.join(":"))
}

/// Build a stable hash from vary dimensions and values
/// Uses BTreeMap for deterministic ordering
fn build_vary_hash(vary_by: &[VaryDimension], vary_values: &HashMap<String, String>) -> String {
    // Sort by dimension name for deterministic ordering
    let mut sorted = BTreeMap::new();

    for dim in vary_by {
        let key = format!("{:?}", dim).to_lowercase();
        if let Some(value) = vary_values.get(&key) {
            sorted.insert(key, value.clone());
        }
    }

    if sorted.is_empty() {
        return "none".to_string();
    }

    // Create stable representation
    let repr: Vec<String> = sorted.iter().map(|(k, v)| format!("{}={}", k, v)).collect();

    // For now, use simple concatenation. In production, use a proper hash
    format!("vary({})", repr.join(","))
}

/// Render tag templates with runtime values
///
/// # Arguments
/// * `artifact` - Cache artifact with tag templates
/// * `key_values` - Values for placeholder substitution
/// * `vary_values` - Optional vary dimension values
///
/// # Returns
/// Rendered tag strings
///
/// # Errors
/// Returns error if placeholder value is missing
pub fn render_tags(
    artifact: &CacheArtifact,
    key_values: &HashMap<String, String>,
    vary_values: Option<&HashMap<String, String>>,
) -> CacheResult<Vec<String>> {
    let mut rendered = Vec::new();

    for tag_template in &artifact.tags {
        let rendered_tag = render_tag_template(tag_template, key_values, vary_values)?;
        rendered.push(rendered_tag);
    }

    Ok(rendered)
}

/// Render a single tag template by replacing placeholders
fn render_tag_template(
    template: &str,
    key_values: &HashMap<String, String>,
    vary_values: Option<&HashMap<String, String>>,
) -> CacheResult<String> {
    let mut result = template.to_string();

    // Find all {placeholder} patterns
    let placeholders = extract_all_placeholders(template);

    for placeholder in placeholders {
        let replacement = key_values
            .get(&placeholder)
            .or_else(|| vary_values.and_then(|vv| vv.get(&placeholder)))
            .ok_or_else(|| CacheError::MissingPlaceholder {
                tag_template: template.to_string(),
                placeholder: placeholder.clone(),
            })?;

        result = result.replace(&format!("{{{}}}", placeholder), replacement);
    }

    Ok(result)
}

/// Extract placeholder name from tag template like "tenant:{tenantId}" -> "tenantId"
fn extract_placeholder(template: &str) -> Option<String> {
    let start = template.find('{')?;
    let end = template.find('}')?;
    if end > start {
        Some(template[start + 1..end].to_string())
    } else {
        None
    }
}

/// Extract all placeholders from a template
fn extract_all_placeholders(template: &str) -> Vec<String> {
    let mut placeholders = Vec::new();
    let mut chars = template.chars().peekable();
    let mut current_placeholder = String::new();
    let mut inside_braces = false;

    while let Some(ch) = chars.next() {
        match ch {
            '{' => {
                inside_braces = true;
                current_placeholder.clear();
            }
            '}' => {
                if inside_braces && !current_placeholder.is_empty() {
                    placeholders.push(current_placeholder.clone());
                }
                inside_braces = false;
            }
            _ => {
                if inside_braces {
                    current_placeholder.push(ch);
                }
            }
        }
    }

    placeholders
}

/// Validate cache artifact configuration
pub fn validate_cache_artifact(artifact: &CacheArtifact) -> CacheResult<()> {
    // Rule: tenantId must be in tags unless privacy is PUBLIC
    if artifact.privacy != PrivacyLevel::Public {
        let has_tenant_tag = artifact
            .tags
            .iter()
            .any(|tag| tag.contains("{tenantId}") || tag.contains("{tenant_id}"));

        if !has_tenant_tag {
            return Err(CacheError::InvalidPrivacyConfiguration(
                "tenantId must be in tag templates unless privacy is PUBLIC".to_string(),
            ));
        }
    }

    // Rule: if privacy is USER, principalId must be in varyBy
    if artifact.privacy == PrivacyLevel::User {
        let has_principal = artifact
            .vary_by
            .iter()
            .any(|dim| matches!(dim, VaryDimension::User));

        if !has_principal {
            return Err(CacheError::InvalidPrivacyConfiguration(
                "principalId must be in varyBy when privacy is USER".to_string(),
            ));
        }
    }

    // Validate tag templates have valid syntax
    for tag in &artifact.tags {
        if tag.contains('{') && !tag.contains('}') {
            return Err(CacheError::InvalidTagTemplate(format!(
                "Unclosed placeholder in tag: {}",
                tag
            )));
        }
    }

    Ok(())
}

/// Validate that all required key parts are provided
pub fn validate_cache_key_inputs(
    artifact: &CacheArtifact,
    key_values: &HashMap<String, String>,
    vary_values: Option<&HashMap<String, String>>,
) -> CacheResult<()> {
    // Extract required key parts from tag templates
    for tag in &artifact.tags {
        let placeholders = extract_all_placeholders(tag);

        for placeholder in placeholders {
            let found = key_values.contains_key(&placeholder)
                || vary_values.map_or(false, |vv| vv.contains_key(&placeholder));

            if !found {
                return Err(CacheError::MissingRequiredKeyPart(placeholder));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_artifact() -> CacheArtifact {
        CacheArtifact {
            artifact_id: "RenderPageModel".to_string(),
            vary_by: vec![VaryDimension::Locale],
            ttl_seconds: 300,
            tags: vec!["tenant:{tenantId}".to_string(), "page:{pageId}".to_string()],
            privacy: PrivacyLevel::Tenant,
        }
    }

    #[test]
    fn test_build_cache_key_deterministic() {
        let artifact = create_test_artifact();

        let mut key_values = HashMap::new();
        key_values.insert("tenantId".to_string(), "acme".to_string());
        key_values.insert("pageId".to_string(), "page-123".to_string());

        let mut vary_values = HashMap::new();
        vary_values.insert("locale".to_string(), "en-US".to_string());

        let key1 = build_cache_key(&artifact, &key_values, Some(&vary_values)).unwrap();
        let key2 = build_cache_key(&artifact, &key_values, Some(&vary_values)).unwrap();

        assert_eq!(key1, key2, "Keys should be deterministic");
        assert!(key1.starts_with("cache:RenderPageModel@v300:"));
        assert!(key1.contains("acme"));
        assert!(key1.contains("page-123"));
    }

    #[test]
    fn test_build_cache_key_missing_key_part() {
        let artifact = create_test_artifact();

        let mut key_values = HashMap::new();
        key_values.insert("tenantId".to_string(), "acme".to_string());
        // Missing pageId

        let result = build_cache_key(&artifact, &key_values, None);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            CacheError::MissingRequiredKeyPart(_)
        ));
    }

    #[test]
    fn test_render_tags() {
        let artifact = create_test_artifact();

        let mut key_values = HashMap::new();
        key_values.insert("tenantId".to_string(), "acme".to_string());
        key_values.insert("pageId".to_string(), "page-123".to_string());

        let tags = render_tags(&artifact, &key_values, None).unwrap();

        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0], "tenant:acme");
        assert_eq!(tags[1], "page:page-123");
    }

    #[test]
    fn test_render_tags_missing_placeholder() {
        let artifact = create_test_artifact();

        let mut key_values = HashMap::new();
        key_values.insert("tenantId".to_string(), "acme".to_string());
        // Missing pageId

        let result = render_tags(&artifact, &key_values, None);
        assert!(result.is_err());

        match result.unwrap_err() {
            CacheError::MissingPlaceholder { placeholder, .. } => {
                assert_eq!(placeholder, "pageId");
            }
            _ => panic!("Expected MissingPlaceholder error"),
        }
    }

    #[test]
    fn test_validate_cache_artifact_tenant_privacy_requires_tenant_tag() {
        let mut artifact = create_test_artifact();
        artifact.tags = vec!["page:{pageId}".to_string()]; // Missing tenant

        let result = validate_cache_artifact(&artifact);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            CacheError::InvalidPrivacyConfiguration(_)
        ));
    }

    #[test]
    fn test_validate_cache_artifact_user_privacy_requires_principal() {
        let mut artifact = create_test_artifact();
        artifact.privacy = PrivacyLevel::User;
        artifact.vary_by = vec![VaryDimension::Locale]; // Missing User dimension

        let result = validate_cache_artifact(&artifact);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_cache_artifact_public_privacy_ok_without_tenant() {
        let mut artifact = create_test_artifact();
        artifact.privacy = PrivacyLevel::Public;
        artifact.tags = vec!["global:config".to_string()]; // No tenant

        let result = validate_cache_artifact(&artifact);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_placeholder() {
        assert_eq!(
            extract_placeholder("tenant:{tenantId}"),
            Some("tenantId".to_string())
        );
        assert_eq!(
            extract_placeholder("page:{pageId}"),
            Some("pageId".to_string())
        );
        assert_eq!(extract_placeholder("no-placeholder"), None);
    }

    #[test]
    fn test_extract_all_placeholders() {
        let placeholders = extract_all_placeholders("tenant:{tenantId}:page:{pageId}");
        assert_eq!(placeholders, vec!["tenantId", "pageId"]);

        let single = extract_all_placeholders("only:{one}");
        assert_eq!(single, vec!["one"]);

        let none = extract_all_placeholders("no-placeholders-here");
        assert!(none.is_empty());
    }
}
