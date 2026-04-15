//! Render tree IR validation.
//!
//! Validates structured render trees produced by WASM plugins against rules V1–V17.
//! Invalid trees are rejected entirely — no partial trees, no fallback.

use crate::PluginError;
use serde_json::Value;

pub const MAX_SERIALIZED_SIZE: usize = 1_024 * 1_024; // 1 MB (V15)
const MAX_DEPTH: usize = 64; // V13
const MAX_NODE_COUNT: usize = 10_000; // V14
const MAX_PROP_VALUE_SIZE: usize = 100 * 1_024; // 100 KB (V16)

/// Leaf node types that MUST NOT have children (V7).
const LEAF_TYPES: &[&str] = &["text", "image", "divider"];

/// Block-level node types.
const BLOCK_TYPES: &[&str] = &[
    "heading",
    "paragraph",
    "code_block",
    "blockquote",
    "list",
    "list_item",
    "block",
    "divider",
    "image",
];

/// Inline node types.
const INLINE_TYPES: &[&str] = &["text", "strong", "emphasis", "code", "link", "image"];

/// All known primitive types (V4).
const PRIMITIVE_TYPES: &[&str] = &[
    "text",
    "image",
    "divider",
    "heading",
    "paragraph",
    "code_block",
    "blockquote",
    "list",
    "list_item",
    "block",
    "strong",
    "emphasis",
    "code",
    "link",
];

/// Allowed URL schemes for links (V11).
const LINK_SCHEMES: &[&str] = &["https:", "http:", "mailto:"];

/// Allowed URL schemes for images (V12).
const IMAGE_SCHEMES: &[&str] = &["https:", "http:"];

fn err(msg: impl Into<String>) -> PluginError {
    PluginError::InvalidOutput(msg.into())
}

/// Validate a render tree (V1–V17). Returns Ok(()) or PluginError::InvalidOutput.
pub fn validate_render_tree(tree: &Value) -> Result<(), PluginError> {
    let obj = tree
        .as_object()
        .ok_or_else(|| err("render tree must be a JSON object"))?;

    // V1: version is a supported integer
    let version = obj
        .get("version")
        .ok_or_else(|| err("missing required field: version"))?
        .as_u64()
        .ok_or_else(|| err("version must be a positive integer"))?;
    if version != 1 {
        return Err(err(format!("unsupported render tree version: {}", version)));
    }

    // V2: nodes is a non-empty array
    let nodes = obj
        .get("nodes")
        .ok_or_else(|| err("missing required field: nodes"))?
        .as_array()
        .ok_or_else(|| err("nodes must be an array"))?;
    if nodes.is_empty() {
        return Err(err("nodes array must not be empty"));
    }

    // Reject unknown top-level keys
    for key in obj.keys() {
        if key != "version" && key != "nodes" {
            return Err(err(format!("unknown top-level field: {}", key)));
        }
    }

    // Validate all nodes recursively
    let mut node_count: usize = 0;
    for node in nodes {
        validate_node(node, NodeContext::Block, 1, &mut node_count)?;
    }

    Ok(())
}

/// Context in which a node appears, for nesting rule enforcement (V8).
#[derive(Debug, Clone, Copy, PartialEq)]
enum NodeContext {
    Block,
    Inline,
    ListChildren,
    Fallback,
}

fn validate_node(
    node: &Value,
    ctx: NodeContext,
    depth: usize,
    node_count: &mut usize,
) -> Result<(), PluginError> {
    // V13: depth check
    if depth > MAX_DEPTH {
        return Err(err(format!("tree depth exceeds maximum of {}", MAX_DEPTH)));
    }

    // V14: node count check
    *node_count += 1;
    if *node_count > MAX_NODE_COUNT {
        return Err(err(format!(
            "node count exceeds maximum of {}",
            MAX_NODE_COUNT
        )));
    }

    let obj = node
        .as_object()
        .ok_or_else(|| err("node must be a JSON object"))?;

    // V3: type is a non-empty string
    let node_type = obj
        .get("type")
        .ok_or_else(|| err("node missing required field: type"))?
        .as_str()
        .ok_or_else(|| err("node type must be a string"))?;
    if node_type.is_empty() {
        return Err(err("node type must not be empty"));
    }

    let is_extension = node_type.starts_with("x-");

    // V10: extension nodes are not allowed in fallback context
    if is_extension && ctx == NodeContext::Fallback {
        return Err(err(format!(
            "extension node '{}' is not allowed in fallback (must be primitive-only)",
            node_type
        )));
    }

    // V4: type is a known primitive OR starts with x-
    if !is_extension && !PRIMITIVE_TYPES.contains(&node_type) {
        return Err(err(format!("unknown node type: {}", node_type)));
    }

    // Reject unknown fields on the node
    for key in obj.keys() {
        match key.as_str() {
            "type" | "props" | "children" | "fallback" => {}
            _ => return Err(err(format!("unknown field on node: {}", key))),
        }
    }

    // V5, V6, V16: validate props
    if let Some(props) = obj.get("props") {
        validate_props(props, node_type)?;
    } else {
        // Check required props are present
        check_required_props(None, node_type)?;
    }

    let is_leaf = !is_extension && LEAF_TYPES.contains(&node_type);

    // V7: leaf nodes must not have children
    if is_leaf && obj.contains_key("children") {
        return Err(err(format!(
            "leaf node '{}' must not have children",
            node_type
        )));
    }

    // V8: nesting rules
    if !is_extension {
        validate_nesting(node_type, ctx)?;
    }

    // Validate children
    if let Some(children) = obj.get("children") {
        let children = children
            .as_array()
            .ok_or_else(|| err("children must be an array"))?;

        let child_ctx = child_context(node_type, is_extension);
        for child in children {
            validate_node(child, child_ctx, depth + 1, node_count)?;
        }
    }

    // V9, V10: extension fallback rules
    if is_extension {
        let fallback = obj
            .get("fallback")
            .ok_or_else(|| err(format!("extension node '{}' missing required fallback", node_type)))?
            .as_array()
            .ok_or_else(|| err("fallback must be an array"))?;

        for fb_node in fallback {
            validate_node(fb_node, NodeContext::Fallback, depth + 1, node_count)?;
        }
    } else if obj.contains_key("fallback") {
        return Err(err(format!(
            "primitive node '{}' must not have fallback",
            node_type
        )));
    }

    Ok(())
}

fn validate_nesting(node_type: &str, ctx: NodeContext) -> Result<(), PluginError> {
    match ctx {
        NodeContext::Block | NodeContext::Fallback => {
            // Top-level and fallback accept block-level nodes
            if !BLOCK_TYPES.contains(&node_type) {
                return Err(err(format!(
                    "node '{}' is not allowed at block level",
                    node_type
                )));
            }
        }
        NodeContext::Inline => {
            // Inline context accepts inline nodes only
            if !INLINE_TYPES.contains(&node_type) {
                return Err(err(format!(
                    "node '{}' is not allowed at inline level",
                    node_type
                )));
            }
        }
        NodeContext::ListChildren => {
            // list children must be list_item
            if node_type != "list_item" {
                return Err(err(format!(
                    "list children must be list_item, got '{}'",
                    node_type
                )));
            }
        }
    }
    Ok(())
}

fn child_context(node_type: &str, is_extension: bool) -> NodeContext {
    if is_extension {
        // Extension children are block-level
        return NodeContext::Block;
    }
    match node_type {
        "list" => NodeContext::ListChildren,
        // Containers whose children are inline
        "heading" | "paragraph" | "code_block" | "strong" | "emphasis" | "code" | "link" => {
            NodeContext::Inline
        }
        // list_item, blockquote, block can contain blocks
        "list_item" | "blockquote" | "block" => NodeContext::Block,
        _ => NodeContext::Block,
    }
}

fn validate_props(props: &Value, node_type: &str) -> Result<(), PluginError> {
    let obj = props
        .as_object()
        .ok_or_else(|| err("props must be a JSON object"))?;

    // V5: all values must be JSON primitives, V16: no value > 100 KB
    for (key, val) in obj {
        match val {
            Value::String(s) => {
                if s.len() > MAX_PROP_VALUE_SIZE {
                    return Err(err(format!(
                        "prop '{}' value exceeds 100 KB limit ({} bytes)",
                        key,
                        s.len()
                    )));
                }
            }
            Value::Number(_) | Value::Bool(_) | Value::Null => {}
            _ => {
                return Err(err(format!(
                    "prop '{}' value must be a JSON primitive (string, number, boolean, null)",
                    key
                )));
            }
        }
    }

    check_required_props(Some(obj), node_type)
}

fn check_required_props(
    props: Option<&serde_json::Map<String, Value>>,
    node_type: &str,
) -> Result<(), PluginError> {
    match node_type {
        "text" => {
            // V6: content is required string, V17: not empty
            let content = props
                .and_then(|p| p.get("content"))
                .ok_or_else(|| err("text node missing required prop: content"))?;
            let s = content
                .as_str()
                .ok_or_else(|| err("text.content must be a string"))?;
            if s.is_empty() {
                return Err(err("text.content must not be empty"));
            }
        }
        "heading" => {
            // V6: level is required number 1-6
            let level = props
                .and_then(|p| p.get("level"))
                .ok_or_else(|| err("heading node missing required prop: level"))?;
            let n = level
                .as_u64()
                .ok_or_else(|| err("heading.level must be an integer"))?;
            if !(1..=6).contains(&n) {
                return Err(err(format!("heading.level must be 1-6, got {}", n)));
            }
        }
        "image" => {
            // V6: src and alt required
            let src = props
                .and_then(|p| p.get("src"))
                .ok_or_else(|| err("image node missing required prop: src"))?;
            let src_str = src
                .as_str()
                .ok_or_else(|| err("image.src must be a string"))?;
            // V12: allowed schemes
            validate_url_scheme(src_str, IMAGE_SCHEMES, "image.src")?;

            let alt = props
                .and_then(|p| p.get("alt"))
                .ok_or_else(|| err("image node missing required prop: alt"))?;
            alt.as_str()
                .ok_or_else(|| err("image.alt must be a string"))?;
        }
        "link" => {
            // V6: href required
            let href = props
                .and_then(|p| p.get("href"))
                .ok_or_else(|| err("link node missing required prop: href"))?;
            let href_str = href
                .as_str()
                .ok_or_else(|| err("link.href must be a string"))?;
            // V11: allowed schemes
            validate_url_scheme(href_str, LINK_SCHEMES, "link.href")?;
        }
        "list" => {
            // V6: ordered is required boolean
            let ordered = props
                .and_then(|p| p.get("ordered"))
                .ok_or_else(|| err("list node missing required prop: ordered"))?;
            if !ordered.is_boolean() {
                return Err(err("list.ordered must be a boolean"));
            }
        }
        _ => {
            // No required props for other types (or extension types)
        }
    }
    Ok(())
}

fn validate_url_scheme(url: &str, allowed: &[&str], field: &str) -> Result<(), PluginError> {
    let lower = url.to_ascii_lowercase();
    for scheme in allowed {
        if lower.starts_with(scheme) {
            return Ok(());
        }
    }
    Err(err(format!(
        "{} has disallowed scheme (allowed: {:?}): {}",
        field,
        allowed,
        if url.len() > 50 { &url[..50] } else { url }
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn valid_basic_tree() {
        let tree = json!({
            "version": 1,
            "nodes": [
                {
                    "type": "heading",
                    "props": { "level": 1 },
                    "children": [
                        { "type": "text", "props": { "content": "Hello" } }
                    ]
                },
                {
                    "type": "paragraph",
                    "children": [
                        { "type": "text", "props": { "content": "World" } }
                    ]
                }
            ]
        });
        assert!(validate_render_tree(&tree).is_ok());
    }

    #[test]
    fn valid_extension_with_fallback() {
        let tree = json!({
            "version": 1,
            "nodes": [
                {
                    "type": "x-callout",
                    "props": { "level": "warning" },
                    "children": [
                        { "type": "paragraph", "children": [
                            { "type": "text", "props": { "content": "Watch out!" } }
                        ]}
                    ],
                    "fallback": [
                        { "type": "paragraph", "children": [
                            { "type": "text", "props": { "content": "Watch out!" } }
                        ]}
                    ]
                }
            ]
        });
        assert!(validate_render_tree(&tree).is_ok());
    }

    #[test]
    fn v1_wrong_version() {
        let tree = json!({ "version": 2, "nodes": [{ "type": "paragraph", "children": [{ "type": "text", "props": { "content": "x" }}]}] });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("unsupported"));
    }

    #[test]
    fn v2_empty_nodes() {
        let tree = json!({ "version": 1, "nodes": [] });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("empty"));
    }

    #[test]
    fn v3_missing_type() {
        let tree = json!({ "version": 1, "nodes": [{ "props": {} }] });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("type"));
    }

    #[test]
    fn v4_unknown_type() {
        let tree = json!({ "version": 1, "nodes": [{ "type": "div" }] });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("unknown node type"));
    }

    #[test]
    fn v5_nested_object_in_props() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "heading",
                "props": { "level": 1, "style": { "color": "red" } },
                "children": [{ "type": "text", "props": { "content": "x" } }]
            }]
        });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("primitive"));
    }

    #[test]
    fn v6_heading_level_out_of_range() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "heading",
                "props": { "level": 7 },
                "children": [{ "type": "text", "props": { "content": "x" } }]
            }]
        });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("1-6"));
    }

    #[test]
    fn v7_text_with_children() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "paragraph",
                "children": [{
                    "type": "text",
                    "props": { "content": "hello" },
                    "children": [{ "type": "text", "props": { "content": "bad" } }]
                }]
            }]
        });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("leaf"));
    }

    #[test]
    fn v8_block_inside_inline() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "paragraph",
                "children": [{
                    "type": "strong",
                    "children": [{
                        "type": "heading",
                        "props": { "level": 1 },
                        "children": [{ "type": "text", "props": { "content": "bad" } }]
                    }]
                }]
            }]
        });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("not allowed at inline level"));
    }

    #[test]
    fn v9_extension_missing_fallback() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "x-widget",
                "children": [{ "type": "paragraph", "children": [{ "type": "text", "props": { "content": "x" } }] }]
            }]
        });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("fallback"));
    }

    #[test]
    fn v10_extension_in_fallback() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "x-widget",
                "children": [{ "type": "paragraph", "children": [{ "type": "text", "props": { "content": "x" }}]}],
                "fallback": [{
                    "type": "x-inner",
                    "children": [{ "type": "paragraph", "children": [{ "type": "text", "props": { "content": "x" }}]}],
                    "fallback": [{ "type": "paragraph", "children": [{ "type": "text", "props": { "content": "x" }}]}]
                }]
            }]
        });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(
            e.to_string().contains("not allowed in fallback"),
            "expected fallback rejection, got: {}",
            e
        );
    }

    #[test]
    fn v11_javascript_href() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "paragraph",
                "children": [{
                    "type": "link",
                    "props": { "href": "javascript:alert(1)" },
                    "children": [{ "type": "text", "props": { "content": "click" } }]
                }]
            }]
        });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("disallowed scheme"));
    }

    #[test]
    fn v12_data_uri_image() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "image",
                "props": { "src": "data:image/png;base64,abc", "alt": "img" }
            }]
        });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("disallowed scheme"));
    }

    #[test]
    fn v17_empty_text_content() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "paragraph",
                "children": [{ "type": "text", "props": { "content": "" } }]
            }]
        });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("empty"));
    }

    #[test]
    fn valid_list() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "list",
                "props": { "ordered": false },
                "children": [
                    {
                        "type": "list_item",
                        "children": [
                            { "type": "paragraph", "children": [
                                { "type": "text", "props": { "content": "Item 1" } }
                            ]}
                        ]
                    },
                    {
                        "type": "list_item",
                        "children": [
                            { "type": "paragraph", "children": [
                                { "type": "text", "props": { "content": "Item 2" } }
                            ]}
                        ]
                    }
                ]
            }]
        });
        assert!(validate_render_tree(&tree).is_ok());
    }

    #[test]
    fn list_with_non_list_item_child() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "list",
                "props": { "ordered": true },
                "children": [
                    { "type": "paragraph", "children": [
                        { "type": "text", "props": { "content": "bad" } }
                    ]}
                ]
            }]
        });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("list_item"));
    }

    #[test]
    fn valid_complex_tree() {
        let tree = json!({
            "version": 1,
            "nodes": [
                {
                    "type": "heading",
                    "props": { "level": 1 },
                    "children": [{ "type": "text", "props": { "content": "Title" } }]
                },
                {
                    "type": "paragraph",
                    "children": [
                        { "type": "text", "props": { "content": "Hello " } },
                        { "type": "strong", "children": [
                            { "type": "text", "props": { "content": "bold" } }
                        ]},
                        { "type": "text", "props": { "content": " and " } },
                        { "type": "emphasis", "children": [
                            { "type": "text", "props": { "content": "italic" } }
                        ]},
                        { "type": "text", "props": { "content": ". See " } },
                        { "type": "link", "props": { "href": "https://example.com" }, "children": [
                            { "type": "text", "props": { "content": "link" } }
                        ]}
                    ]
                },
                {
                    "type": "code_block",
                    "props": { "language": "rust" },
                    "children": [{ "type": "text", "props": { "content": "fn main() {}" } }]
                },
                { "type": "divider" },
                {
                    "type": "blockquote",
                    "children": [{
                        "type": "paragraph",
                        "children": [{ "type": "text", "props": { "content": "A quote" } }]
                    }]
                },
                {
                    "type": "image",
                    "props": { "src": "https://example.com/img.png", "alt": "An image" }
                }
            ]
        });
        assert!(validate_render_tree(&tree).is_ok());
    }

    #[test]
    fn primitive_node_rejects_fallback() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "paragraph",
                "children": [{ "type": "text", "props": { "content": "x" } }],
                "fallback": [{ "type": "paragraph", "children": [{ "type": "text", "props": { "content": "y" }}]}]
            }]
        });
        let e = validate_render_tree(&tree).unwrap_err();
        assert!(e.to_string().contains("must not have fallback"));
    }

    #[test]
    fn valid_mailto_link() {
        let tree = json!({
            "version": 1,
            "nodes": [{
                "type": "paragraph",
                "children": [{
                    "type": "link",
                    "props": { "href": "mailto:user@example.com" },
                    "children": [{ "type": "text", "props": { "content": "email" } }]
                }]
            }]
        });
        assert!(validate_render_tree(&tree).is_ok());
    }
}
