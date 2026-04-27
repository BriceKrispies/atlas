use crate::errors::{CatalogError, CatalogResult};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct VariantTableQuery {
    pub filters: HashMap<String, FilterValue>,
    pub sort: Option<String>,
    pub page_size: Option<usize>,
}

#[derive(Debug, Clone)]
pub enum FilterValue {
    Equals(String),
    Range { gte: Option<f64>, lte: Option<f64> },
}

pub async fn query_variant_table(
    pool: &PgPool,
    tenant_id: &str,
    family_key: &str,
    query: &VariantTableQuery,
) -> CatalogResult<Option<Value>> {
    let row = sqlx::query(
        r#"
        SELECT payload
        FROM catalog_variant_matrix_projection
        WHERE tenant_id = $1 AND family_key = $2
        "#,
    )
    .bind(tenant_id)
    .bind(family_key)
    .fetch_optional(pool)
    .await
    .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    let mut payload = match row {
        Some(r) => r.get::<Value, _>("payload"),
        None => return Ok(None),
    };

    let rows = payload
        .get("rows")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut filtered: Vec<Value> = rows
        .into_iter()
        .filter(|r| variant_matches(r, &query.filters))
        .collect();

    if let Some(sort_spec) = &query.sort {
        let (attr, dir) = parse_sort_spec(sort_spec);
        filtered.sort_by(|a, b| compare_variant(a, b, &attr, dir));
    }

    if let Some(limit) = query.page_size {
        filtered.truncate(limit);
    }

    if let Some(obj) = payload.as_object_mut() {
        obj.insert("rows".to_string(), Value::Array(filtered.clone()));
        obj.insert("rowCount".to_string(), json!(filtered.len()));
    }

    Ok(Some(payload))
}

fn variant_matches(row: &Value, filters: &HashMap<String, FilterValue>) -> bool {
    if filters.is_empty() {
        return true;
    }
    let values = match row.get("values") {
        Some(v) => v,
        None => return false,
    };
    for (attr, fv) in filters {
        let entry = match values.get(attr) {
            Some(e) => e,
            None => return false,
        };
        let raw = entry.get("raw").unwrap_or(&Value::Null);
        match fv {
            FilterValue::Equals(target) => {
                let raw_str = raw.as_str().map(|s| s.to_string()).unwrap_or_else(|| raw.to_string());
                if raw_str != *target {
                    return false;
                }
            }
            FilterValue::Range { gte, lte } => {
                let n = raw.as_f64().unwrap_or(f64::NAN);
                if let Some(g) = gte {
                    if !(n >= *g) {
                        return false;
                    }
                }
                if let Some(l) = lte {
                    if !(n <= *l) {
                        return false;
                    }
                }
            }
        }
    }
    true
}

fn parse_sort_spec(s: &str) -> (String, SortDir) {
    if let Some((attr, dir)) = s.rsplit_once('.') {
        let dir = match dir {
            "desc" => SortDir::Desc,
            _ => SortDir::Asc,
        };
        (attr.to_string(), dir)
    } else {
        (s.to_string(), SortDir::Asc)
    }
}

#[derive(Copy, Clone)]
enum SortDir {
    Asc,
    Desc,
}

fn compare_variant(a: &Value, b: &Value, attr: &str, dir: SortDir) -> std::cmp::Ordering {
    let av = a.get("values").and_then(|v| v.get(attr)).and_then(|v| v.get("normalized"));
    let bv = b.get("values").and_then(|v| v.get(attr)).and_then(|v| v.get("normalized"));

    let ord = match (av.and_then(|v| v.as_f64()), bv.and_then(|v| v.as_f64())) {
        (Some(an), Some(bn)) => an.partial_cmp(&bn).unwrap_or(std::cmp::Ordering::Equal),
        _ => {
            let as_ = av.and_then(|v| v.as_str()).unwrap_or("");
            let bs_ = bv.and_then(|v| v.as_str()).unwrap_or("");
            as_.cmp(bs_)
        }
    };
    match dir {
        SortDir::Asc => ord,
        SortDir::Desc => ord.reverse(),
    }
}

pub fn parse_filter_query(raw: &HashMap<String, String>) -> HashMap<String, FilterValue> {
    let mut out = HashMap::new();
    let mut ranges: HashMap<String, (Option<f64>, Option<f64>)> = HashMap::new();
    for (k, v) in raw {
        if let Some(rest) = k.strip_prefix("filters[") {
            if let Some(rest) = rest.strip_suffix(']') {
                if let Some((attr, op)) = rest.split_once("][") {
                    let n = v.parse::<f64>().ok();
                    let entry = ranges.entry(attr.to_string()).or_insert((None, None));
                    if op == "gte" {
                        entry.0 = n;
                    } else if op == "lte" {
                        entry.1 = n;
                    }
                } else {
                    out.insert(rest.to_string(), FilterValue::Equals(v.clone()));
                }
            }
        }
    }
    for (attr, (gte, lte)) in ranges {
        out.insert(attr, FilterValue::Range { gte, lte });
    }
    out
}
