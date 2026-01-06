use crate::types::ServiceManifest;
use anyhow::Result;
use handlebars::Handlebars;
use serde_json::json;

const KAFKA_TEMPLATE: &str = r#"# Kafka configuration for {{name}}
topics:
{{#each all_topics}}
  - name: {{this}}
    partitions: 3
    replicationFactor: 1
    config:
      retention.ms: "604800000"
      cleanup.policy: delete
{{/each}}

acls:
{{#each consumes}}
  - principal: User:{{../name}}
    operation: READ
    resourceType: TOPIC
    resourceName: {{topic}}
    permissionType: ALLOW
  - principal: User:{{../name}}
    operation: READ
    resourceType: GROUP
    resourceName: {{group}}
    permissionType: ALLOW
{{/each}}
{{#each produces}}
  - principal: User:{{../name}}
    operation: WRITE
    resourceType: TOPIC
    resourceName: {{topic}}
    permissionType: ALLOW
{{/each}}
"#;

pub fn generate_kafka_manifest(manifest: &ServiceManifest) -> Result<Option<String>> {
    let kafka = match &manifest.kafka {
        Some(k) => k,
        None => return Ok(None),
    };

    if kafka.consumes.is_empty() && kafka.produces.is_empty() {
        return Ok(None);
    }

    let mut handlebars = Handlebars::new();
    handlebars.register_template_string("kafka", KAFKA_TEMPLATE)?;

    let mut all_topics = std::collections::HashSet::new();
    for consumer in &kafka.consumes {
        all_topics.insert(consumer.topic.clone());
    }
    for producer in &kafka.produces {
        all_topics.insert(producer.topic.clone());
    }
    let all_topics: Vec<String> = all_topics.into_iter().collect();

    let data = json!({
        "name": manifest.name,
        "all_topics": all_topics,
        "consumes": kafka.consumes,
        "produces": kafka.produces,
    });

    Ok(Some(handlebars.render("kafka", &data)?))
}
