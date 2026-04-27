//! Postgres implementation of the `SearchEngine` port.
//!
//! Backed by a per-tenant `catalog_search_documents` table that uses Postgres
//! full-text search (`tsvector` + GIN). The table itself is created by the
//! tenant migration `20260427000001_catalog_search_documents.sql`.
//!
//! Wiring:
//! - The adapter holds an `Arc<dyn TenantDbProvider>` and resolves a tenant
//!   pool on every call. The provider already caches pools.
//! - `index` performs an UPSERT keyed on
//!   `(tenant_id, document_type, document_id)`.
//! - `search` issues a `plainto_tsquery` against the `search_vector` column
//!   and applies tenant + permission filtering at the SQL layer.
//! - `delete_by_document` is a concrete-struct helper used by the projection
//!   builder (Chunk E) to scrub stale rows before re-indexing. It is NOT on
//!   the `SearchEngine` trait — Chunk E holds the concrete struct directly.

#[cfg(feature = "postgres")]
use async_trait::async_trait;
#[cfg(feature = "postgres")]
use atlas_core::types::{PermissionAttributes, SearchDocument};
#[cfg(feature = "postgres")]
use atlas_platform_runtime::ports::{PortError, PortResult, SearchEngine, TenantDbProvider};
#[cfg(feature = "postgres")]
use serde_json::{json, Map, Value};
#[cfg(feature = "postgres")]
use sqlx::Row;
#[cfg(feature = "postgres")]
use std::collections::HashMap;
#[cfg(feature = "postgres")]
use std::sync::Arc;

#[cfg(feature = "postgres")]
const DEFAULT_SEARCH_LIMIT: i64 = 100;

/// Postgres-backed `SearchEngine`. Resolves per-tenant pools via
/// `TenantDbProvider`.
#[cfg(feature = "postgres")]
#[derive(Clone)]
pub struct PostgresSearchEngine {
    tenant_db: Arc<dyn TenantDbProvider>,
}

#[cfg(feature = "postgres")]
impl PostgresSearchEngine {
    pub fn new(tenant_db: Arc<dyn TenantDbProvider>) -> Self {
        Self { tenant_db }
    }

    /// Delete a single search document by its `(tenant_id, document_type,
    /// document_id)` identity. Used by the projection builder (Chunk E) to
    /// scrub stale rows before re-indexing on event.
    pub async fn delete_by_document(
        &self,
        tenant_id: &str,
        document_type: &str,
        document_id: &str,
    ) -> PortResult<()> {
        let pool = self.tenant_db.get_pool(tenant_id).await?;

        sqlx::query(
            r#"
            DELETE FROM catalog_search_documents
            WHERE tenant_id = $1
              AND document_type = $2
              AND document_id = $3
            "#,
        )
        .bind(tenant_id)
        .bind(document_type)
        .bind(document_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            PortError::Internal(format!(
                "delete_by_document({}, {}, {}) failed: {}",
                tenant_id, document_type, document_id, e
            ))
        })?;

        Ok(())
    }

    /// Paginated variant of `search`. The trait method delegates here with
    /// default limits.
    pub async fn search_paginated(
        &self,
        query: &str,
        tenant_id: &str,
        principal_id: &str,
        limit: i64,
        offset: i64,
    ) -> PortResult<Vec<SearchDocument>> {
        let pool = self.tenant_db.get_pool(tenant_id).await?;

        let rows = sqlx::query(
            r#"
            SELECT document_type, document_id, title, summary, body_text, taxonomy_path,
                   permission_attributes, filter_values, sort_values,
                   ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
            FROM catalog_search_documents
            WHERE tenant_id = $2
              AND search_vector @@ plainto_tsquery('english', $1)
              AND (permission_attributes IS NULL
                   OR permission_attributes->'allowedPrincipals' IS NULL
                   OR permission_attributes->'allowedPrincipals' ? $3)
            ORDER BY rank DESC, document_id
            LIMIT $4 OFFSET $5
            "#,
        )
        .bind(query)
        .bind(tenant_id)
        .bind(principal_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            PortError::Internal(format!(
                "search_paginated(tenant={}, q={:?}) failed: {}",
                tenant_id, query, e
            ))
        })?;

        let mut results = Vec::with_capacity(rows.len());
        for row in rows {
            let document_type: String = row.get("document_type");
            let document_id: String = row.get("document_id");
            let title: String = row.get("title");
            let summary: Option<String> = row.get("summary");
            let body_text: Option<String> = row.get("body_text");
            let taxonomy_path: Option<String> = row.get("taxonomy_path");
            let permission_attributes: Option<Value> = row.get("permission_attributes");
            let filter_values: Value = row.get("filter_values");
            let sort_values: Value = row.get("sort_values");
            let rank: f32 = row.get("rank");

            // Re-assemble fields: structured columns + filter_values catch-all
            // + the special `_sort` slot + computed `_score`.
            let mut fields: HashMap<String, Value> = HashMap::new();
            fields.insert("title".to_string(), Value::String(title));
            if let Some(s) = summary {
                fields.insert("summary".to_string(), Value::String(s));
            }
            if let Some(b) = body_text {
                fields.insert("body_text".to_string(), Value::String(b));
            }
            if let Some(t) = taxonomy_path {
                fields.insert("taxonomy_path".to_string(), Value::String(t));
            }

            if let Value::Object(map) = filter_values {
                for (k, v) in map {
                    // Don't let filter_values shadow the structured columns.
                    fields.entry(k).or_insert(v);
                }
            }

            if !matches!(sort_values, Value::Null) {
                fields.insert("_sort".to_string(), sort_values);
            }

            fields.insert("_score".to_string(), json!(rank as f64));

            let permission_attributes = match permission_attributes {
                None | Some(Value::Null) => None,
                Some(v) => parse_permission_attributes(v),
            };

            results.push(SearchDocument {
                document_id,
                document_type,
                tenant_id: tenant_id.to_string(),
                fields,
                permission_attributes,
            });
        }

        Ok(results)
    }
}

#[cfg(feature = "postgres")]
#[async_trait]
impl SearchEngine for PostgresSearchEngine {
    async fn index(&self, document: &SearchDocument) -> PortResult<()> {
        let pool = self.tenant_db.get_pool(&document.tenant_id).await?;

        // Pull structured columns out of `fields`. Title is required.
        let title = document
            .fields
            .get("title")
            .and_then(value_as_str_owned)
            .ok_or_else(|| {
                PortError::Misconfigured(format!(
                    "search document {}/{} missing required string field `title`",
                    document.document_type, document.document_id
                ))
            })?;

        let summary = document.fields.get("summary").and_then(value_as_str_owned);
        let body_text = document
            .fields
            .get("body_text")
            .and_then(value_as_str_owned);
        let taxonomy_path = document
            .fields
            .get("taxonomy_path")
            .and_then(value_as_str_owned);

        // Everything else in `fields` (besides `_sort` and the structured
        // columns) goes into `filter_values`.
        let mut filter_values = Map::new();
        for (k, v) in &document.fields {
            match k.as_str() {
                "title" | "summary" | "body_text" | "taxonomy_path" | "_sort" | "_score" => {
                    continue
                }
                _ => {
                    filter_values.insert(k.clone(), v.clone());
                }
            }
        }
        let filter_values_json = Value::Object(filter_values);

        let sort_values_json = document
            .fields
            .get("_sort")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));

        let permission_attributes_json: Option<Value> =
            document.permission_attributes.as_ref().map(|attrs| {
                json!({
                    "allowedPrincipals": attrs.allowed_principals,
                })
            });

        sqlx::query(
            r#"
            INSERT INTO catalog_search_documents
                (tenant_id, document_type, document_id, title, summary, body_text,
                 taxonomy_path, permission_attributes, filter_values, sort_values,
                 updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
            ON CONFLICT (tenant_id, document_type, document_id) DO UPDATE SET
                title = EXCLUDED.title,
                summary = EXCLUDED.summary,
                body_text = EXCLUDED.body_text,
                taxonomy_path = EXCLUDED.taxonomy_path,
                permission_attributes = EXCLUDED.permission_attributes,
                filter_values = EXCLUDED.filter_values,
                sort_values = EXCLUDED.sort_values,
                updated_at = now()
            "#,
        )
        .bind(&document.tenant_id)
        .bind(&document.document_type)
        .bind(&document.document_id)
        .bind(&title)
        .bind(summary.as_deref())
        .bind(body_text.as_deref())
        .bind(taxonomy_path.as_deref())
        .bind(permission_attributes_json)
        .bind(filter_values_json)
        .bind(sort_values_json)
        .execute(&pool)
        .await
        .map_err(|e| {
            PortError::Internal(format!(
                "index(tenant={}, type={}, id={}) failed: {}",
                document.tenant_id, document.document_type, document.document_id, e
            ))
        })?;

        Ok(())
    }

    async fn search(
        &self,
        query: &str,
        tenant_id: &str,
        principal_id: &str,
    ) -> PortResult<Vec<SearchDocument>> {
        self.search_paginated(query, tenant_id, principal_id, DEFAULT_SEARCH_LIMIT, 0)
            .await
    }
}

#[cfg(feature = "postgres")]
fn value_as_str_owned(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

#[cfg(feature = "postgres")]
fn parse_permission_attributes(v: Value) -> Option<PermissionAttributes> {
    let allowed = v
        .get("allowedPrincipals")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| p.as_str().map(String::from))
                .collect::<Vec<_>>()
        })?;
    Some(PermissionAttributes {
        allowed_principals: allowed,
    })
}

#[cfg(all(test, feature = "postgres"))]
mod tests {
    //! Tests run against a real Postgres tenant database.
    //!
    //! Set `TEST_TENANT_DB_URL` to a Postgres connection string for an
    //! empty (or scratch) database. Tenant migrations are run against it
    //! on first use. If the env var is not set, tests are silently skipped
    //! with a `tracing::warn!` so CI without Postgres still passes.
    //!
    //! Locally:
    //! ```bash
    //! make db-up
    //! # then create/use a scratch DB and export
    //! export TEST_TENANT_DB_URL=postgres://atlas_platform:local_dev_password@localhost:5433/tenant_search_test
    //! cargo test -p atlas-platform-adapters --features postgres
    //! ```

    use super::*;
    use async_trait::async_trait;
    use atlas_core::types::{PermissionAttributes, SearchDocument};
    use sqlx::postgres::PgPoolOptions;
    use sqlx::PgPool;
    use std::collections::HashMap;
    use std::sync::Arc;

    /// `TenantDbProvider` impl that returns the same pool for every tenant.
    /// Tests use a single physical DB and discriminate tenants only via
    /// the `tenant_id` column — that's enough to exercise the SQL paths.
    struct SinglePoolProvider {
        pool: PgPool,
    }

    #[async_trait]
    impl TenantDbProvider for SinglePoolProvider {
        async fn get_pool(&self, _tenant_id: &str) -> PortResult<PgPool> {
            Ok(self.pool.clone())
        }
    }

    async fn setup() -> Option<(PostgresSearchEngine, PgPool)> {
        let url = match std::env::var("TEST_TENANT_DB_URL") {
            Ok(u) => u,
            Err(_) => {
                eprintln!(
                    "TEST_TENANT_DB_URL not set; skipping postgres_search test (Postgres-backed)."
                );
                return None;
            }
        };

        let pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect to TEST_TENANT_DB_URL");

        // Drop+recreate the table so each run starts clean. The table shape
        // matches the tenant migration; if the migration is ever updated,
        // this `CREATE TABLE` should be updated in lockstep.
        sqlx::query("DROP TABLE IF EXISTS catalog_search_documents CASCADE")
            .execute(&pool)
            .await
            .expect("drop catalog_search_documents");

        // Reuse the migration text directly so test schema can't drift.
        let migration_sql =
            include_str!("../../tenant_db/migrations/20260427000001_catalog_search_documents.sql");
        for stmt in migration_sql.split(';').filter(|s| !s.trim().is_empty()) {
            sqlx::query(stmt)
                .execute(&pool)
                .await
                .expect("apply catalog_search_documents migration");
        }

        let provider = Arc::new(SinglePoolProvider { pool: pool.clone() });
        let engine = PostgresSearchEngine::new(provider);
        Some((engine, pool))
    }

    fn doc(
        tenant: &str,
        doc_type: &str,
        doc_id: &str,
        title: &str,
        summary: Option<&str>,
        body: Option<&str>,
        taxonomy: Option<&str>,
    ) -> SearchDocument {
        let mut fields: HashMap<String, Value> = HashMap::new();
        fields.insert("title".to_string(), Value::String(title.to_string()));
        if let Some(s) = summary {
            fields.insert("summary".to_string(), Value::String(s.to_string()));
        }
        if let Some(b) = body {
            fields.insert("body_text".to_string(), Value::String(b.to_string()));
        }
        if let Some(t) = taxonomy {
            fields.insert("taxonomy_path".to_string(), Value::String(t.to_string()));
        }
        SearchDocument {
            document_id: doc_id.to_string(),
            document_type: doc_type.to_string(),
            tenant_id: tenant.to_string(),
            fields,
            permission_attributes: None,
        }
    }

    #[tokio::test]
    async fn index_then_search_ranks_title_match_first() {
        let Some((engine, _pool)) = setup().await else {
            return;
        };
        let tenant = "t_index_search";

        let family = doc(
            tenant,
            "family",
            "service_anniversary_badge",
            "Service Anniversary Badge",
            Some("A badge family for celebrating service anniversaries"),
            Some("Recognition for years of service to the company."),
            Some("/recognition/badges/service-anniversary"),
        );
        let v1 = doc(
            tenant,
            "variant",
            "1_year_badge",
            "1 Year Badge",
            Some("Service Anniversary Badge / 1 Year"),
            Some("One year of service"),
            Some("/recognition/badges/service-anniversary"),
        );
        let v5 = doc(
            tenant,
            "variant",
            "5_year_badge",
            "5 Year Badge",
            Some("Service Anniversary Badge / 5 Year"),
            Some("Five years of service"),
            Some("/recognition/badges/service-anniversary"),
        );

        engine.index(&family).await.unwrap();
        engine.index(&v1).await.unwrap();
        engine.index(&v5).await.unwrap();

        // "anniversary" hits the family title (weight A) hardest.
        let res = engine
            .search("anniversary", tenant, "u_alice")
            .await
            .unwrap();
        assert!(!res.is_empty(), "expected at least one anniversary hit");
        assert_eq!(res[0].document_id, "service_anniversary_badge");

        // "5" should pull the 5 Year Badge to the top.
        let res5 = engine.search("5 year", tenant, "u_alice").await.unwrap();
        assert!(res5.iter().any(|d| d.document_id == "5_year_badge"));
        assert_eq!(res5[0].document_id, "5_year_badge");

        // _score field is populated.
        assert!(
            res[0].fields.contains_key("_score"),
            "result should carry _score"
        );
    }

    #[tokio::test]
    async fn search_is_tenant_isolated() {
        let Some((engine, _pool)) = setup().await else {
            return;
        };

        let a = doc(
            "tenant_a_iso",
            "family",
            "shared_key",
            "Anniversary Family A",
            None,
            None,
            None,
        );
        let b = doc(
            "tenant_b_iso",
            "family",
            "shared_key",
            "Anniversary Family B",
            None,
            None,
            None,
        );
        engine.index(&a).await.unwrap();
        engine.index(&b).await.unwrap();

        let res_a = engine
            .search("anniversary", "tenant_a_iso", "u_anyone")
            .await
            .unwrap();
        assert_eq!(res_a.len(), 1);
        assert_eq!(res_a[0].tenant_id, "tenant_a_iso");

        let res_b = engine
            .search("anniversary", "tenant_b_iso", "u_anyone")
            .await
            .unwrap();
        assert_eq!(res_b.len(), 1);
        assert_eq!(res_b[0].tenant_id, "tenant_b_iso");
    }

    #[tokio::test]
    async fn permission_filter_excludes_disallowed_principal() {
        let Some((engine, _pool)) = setup().await else {
            return;
        };
        let tenant = "t_perms";

        let mut restricted = doc(
            tenant,
            "family",
            "alice_only",
            "Alice Anniversary",
            None,
            None,
            None,
        );
        restricted.permission_attributes = Some(PermissionAttributes {
            allowed_principals: vec!["u_alice".to_string()],
        });
        let public = doc(
            tenant,
            "family",
            "everyone",
            "Public Anniversary",
            None,
            None,
            None,
        );
        engine.index(&restricted).await.unwrap();
        engine.index(&public).await.unwrap();

        let bob = engine.search("anniversary", tenant, "u_bob").await.unwrap();
        let bob_ids: Vec<_> = bob.iter().map(|d| d.document_id.as_str()).collect();
        assert!(bob_ids.contains(&"everyone"));
        assert!(
            !bob_ids.contains(&"alice_only"),
            "u_bob must not see alice-only doc"
        );

        let alice = engine
            .search("anniversary", tenant, "u_alice")
            .await
            .unwrap();
        let alice_ids: Vec<_> = alice.iter().map(|d| d.document_id.as_str()).collect();
        assert!(alice_ids.contains(&"everyone"));
        assert!(alice_ids.contains(&"alice_only"));
    }

    #[tokio::test]
    async fn upsert_replaces_existing_row() {
        let Some((engine, pool)) = setup().await else {
            return;
        };
        let tenant = "t_upsert";

        let mut d = doc(
            tenant,
            "family",
            "stable_id",
            "Original Title",
            None,
            None,
            None,
        );
        engine.index(&d).await.unwrap();

        d.fields
            .insert("title".to_string(), Value::String("Updated Title".into()));
        engine.index(&d).await.unwrap();

        // Exactly one row, with the updated title.
        let row = sqlx::query(
            r#"
            SELECT count(*) AS c, max(title) AS title
            FROM catalog_search_documents
            WHERE tenant_id = $1 AND document_type = 'family' AND document_id = 'stable_id'
            "#,
        )
        .bind(tenant)
        .fetch_one(&pool)
        .await
        .unwrap();
        let count: i64 = row.get("c");
        let title: String = row.get("title");
        assert_eq!(count, 1, "upsert should not duplicate");
        assert_eq!(title, "Updated Title");
    }

    #[tokio::test]
    async fn delete_by_document_removes_row() {
        let Some((engine, _pool)) = setup().await else {
            return;
        };
        let tenant = "t_delete";

        let d = doc(
            tenant,
            "family",
            "to_delete",
            "Anniversary Doomed",
            None,
            None,
            None,
        );
        engine.index(&d).await.unwrap();

        let before = engine
            .search("anniversary", tenant, "u_anyone")
            .await
            .unwrap();
        assert_eq!(before.len(), 1);

        engine
            .delete_by_document(tenant, "family", "to_delete")
            .await
            .unwrap();

        let after = engine
            .search("anniversary", tenant, "u_anyone")
            .await
            .unwrap();
        assert!(
            after.is_empty(),
            "deleted doc must not appear in search results"
        );
    }

    /// Empty query produces zero results: `plainto_tsquery('')` yields an
    /// empty tsquery which `@@` never matches. This is fine — the route in
    /// Chunk E should reject empty `q` at the parameter layer, not here.
    #[tokio::test]
    async fn empty_query_returns_no_results() {
        let Some((engine, _pool)) = setup().await else {
            return;
        };
        let tenant = "t_empty";

        let d = doc(tenant, "family", "any", "Anniversary", None, None, None);
        engine.index(&d).await.unwrap();

        let res = engine.search("", tenant, "u_anyone").await.unwrap();
        assert!(res.is_empty(), "empty tsquery matches nothing");
    }
}
