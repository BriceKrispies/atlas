use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceType {
    Api,
    Worker,
    Projector,
    Hybrid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum PortProtocol {
    TCP,
    UDP,
}

impl Default for PortProtocol {
    fn default() -> Self {
        Self::TCP
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortSpec {
    pub name: String,
    #[serde(rename = "containerPort")]
    pub container_port: u16,
    #[serde(default)]
    pub protocol: PortProtocol,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KafkaConsumer {
    pub topic: String,
    pub group: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KafkaProducer {
    pub topic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KafkaSpec {
    #[serde(default)]
    pub consumes: Vec<KafkaConsumer>,
    #[serde(default)]
    pub produces: Vec<KafkaProducer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceSpec {
    pub cpu: Option<String>,
    pub memory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSpec {
    #[serde(rename = "livenessPath", default = "default_liveness_path")]
    pub liveness_path: String,
    #[serde(rename = "readinessPath", default = "default_readiness_path")]
    pub readiness_path: String,
}

fn default_liveness_path() -> String {
    "/healthz".to_string()
}

fn default_readiness_path() -> String {
    "/readyz".to_string()
}

impl Default for HealthSpec {
    fn default() -> Self {
        Self {
            liveness_path: default_liveness_path(),
            readiness_path: default_readiness_path(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenApiSpec {
    pub source: String,
    #[serde(rename = "basePath", default = "default_base_path")]
    pub base_path: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub ops: Vec<String>,
    pub hash: String,
}

fn default_base_path() -> String {
    "/".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceManifest {
    pub name: String,
    #[serde(rename = "type")]
    pub service_type: ServiceType,
    pub language: String,
    #[serde(default)]
    pub ports: Vec<PortSpec>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub secrets: Vec<String>,
    pub kafka: Option<KafkaSpec>,
    pub resources: Option<ResourceSpec>,
    pub replicas: Option<u32>,
    #[serde(default)]
    pub health: HealthSpec,
    pub openapi: Option<OpenApiSpec>,
}

impl ServiceManifest {
    pub fn from_yaml(content: &str) -> anyhow::Result<Self> {
        Ok(serde_yaml::from_str(content)?)
    }

    pub fn to_yaml(&self) -> anyhow::Result<String> {
        Ok(serde_yaml::to_string(self)?)
    }

    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        if self.name.is_empty() {
            errors.push("Service name cannot be empty".to_string());
        }

        if self.language.is_empty() {
            errors.push("Service language cannot be empty".to_string());
        }

        if let Some(ref kafka) = self.kafka {
            for consumer in &kafka.consumes {
                if consumer.topic.is_empty() {
                    errors.push("Kafka consumer topic cannot be empty".to_string());
                }
                if consumer.group.is_empty() {
                    errors.push("Kafka consumer group cannot be empty".to_string());
                }
            }
            for producer in &kafka.produces {
                if producer.topic.is_empty() {
                    errors.push("Kafka producer topic cannot be empty".to_string());
                }
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}
