use crate::errors::{CatalogError, CatalogResult};
use atlas_core::types::SearchDocument;
use atlas_platform_runtime::ports::SearchEngine;
use serde_json::{json, Value};
use std::sync::Arc;

pub const DEFAULT_PAGE_SIZE: usize = 25;
pub const MAX_PAGE_SIZE: usize = 100;

#[derive(Debug, Clone)]
pub struct SearchQueryParams {
    pub query: String,
    pub document_type: Option<String>,
    pub page_size: usize,
    pub offset: usize,
}

impl SearchQueryParams {
    pub fn from_raw(
        q: Option<&str>,
        type_filter: Option<&str>,
        page_size: Option<&str>,
        cursor: Option<&str>,
    ) -> CatalogResult<Self> {
        let query = q.unwrap_or("").trim().to_string();
        if query.is_empty() {
            return Err(CatalogError::InvalidSeedPayload(
                "search query parameter `q` is required".to_string(),
            ));
        }
        let mut size = page_size
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(DEFAULT_PAGE_SIZE);
        if size == 0 {
            size = DEFAULT_PAGE_SIZE;
        }
        if size > MAX_PAGE_SIZE {
            size = MAX_PAGE_SIZE;
        }
        let offset = cursor.and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
        Ok(Self {
            query,
            document_type: type_filter.map(|s| s.to_string()).filter(|s| !s.is_empty()),
            page_size: size,
            offset,
        })
    }
}

pub async fn handle_search(
    search_engine: Arc<dyn SearchEngine>,
    tenant_id: &str,
    principal_id: &str,
    params: &SearchQueryParams,
) -> CatalogResult<Value> {
    let mut docs = search_engine
        .search(&params.query, tenant_id, principal_id)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    if let Some(t) = &params.document_type {
        docs.retain(|d| &d.document_type == t);
    }

    // Offset-based pagination over the post-filtered list.
    let total = docs.len();
    let start = params.offset.min(total);
    let end = (start + params.page_size).min(total);
    let page = docs[start..end].to_vec();
    let has_more = end < total;
    let next_cursor = if has_more {
        Some(end.to_string())
    } else {
        None
    };

    let results: Vec<Value> = page.iter().map(format_result).collect();

    Ok(json!({
        "query": params.query,
        "results": results,
        "pageInfo": {
            "hasMore": has_more,
            "nextCursor": next_cursor,
        }
    }))
}

fn format_result(d: &SearchDocument) -> Value {
    let title = d
        .fields
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let summary = d
        .fields
        .get("summary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let taxonomy_path = d
        .fields
        .get("taxonomy_path")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let score = d
        .fields
        .get("_score")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    json!({
        "documentType": d.document_type,
        "documentId": d.document_id,
        "title": title,
        "summary": summary,
        "taxonomyPath": taxonomy_path,
        "score": score,
    })
}
