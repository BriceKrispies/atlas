use crate::types::ServiceManifest;
use anyhow::Result;
use handlebars::Handlebars;
use serde_json::json;

const K8S_TEMPLATE: &str = r#"apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{name}}
  labels:
    app: {{name}}
    type: {{service_type}}
spec:
  replicas: {{replicas}}
  selector:
    matchLabels:
      app: {{name}}
  template:
    metadata:
      labels:
        app: {{name}}
        type: {{service_type}}
    spec:
      containers:
      - name: {{name}}
        image: {{name}}:latest
        imagePullPolicy: IfNotPresent
        {{#if ports}}
        ports:
        {{#each ports}}
        - name: {{this.name}}
          containerPort: {{this.containerPort}}
          protocol: {{this.protocol}}
        {{/each}}
        {{/if}}
        {{#if has_env}}
        env:
        {{#each env}}
        - name: {{@key}}
          value: "{{this}}"
        {{/each}}
        {{#each secrets}}
        - name: {{this}}
          valueFrom:
            secretKeyRef:
              name: {{../name}}-secrets
              key: {{this}}
        {{/each}}
        {{/if}}
        {{#if resources}}
        resources:
          {{#if resources.cpu}}
          requests:
            cpu: {{resources.cpu}}
          limits:
            cpu: {{resources.cpu}}
          {{/if}}
          {{#if resources.memory}}
          requests:
            memory: {{resources.memory}}
          limits:
            memory: {{resources.memory}}
          {{/if}}
        {{/if}}
        livenessProbe:
          httpGet:
            path: {{health.livenessPath}}
            port: {{default_port}}
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: {{health.readinessPath}}
            port: {{default_port}}
          initialDelaySeconds: 5
          periodSeconds: 5
---
{{#if has_ports}}
apiVersion: v1
kind: Service
metadata:
  name: {{name}}
  labels:
    app: {{name}}
spec:
  selector:
    app: {{name}}
  ports:
  {{#each ports}}
  - name: {{this.name}}
    port: {{this.containerPort}}
    targetPort: {{this.containerPort}}
    protocol: {{this.protocol}}
  {{/each}}
  type: ClusterIP
{{/if}}
"#;

pub fn generate_k8s_manifest(manifest: &ServiceManifest) -> Result<String> {
    let mut handlebars = Handlebars::new();
    handlebars.register_template_string("k8s", K8S_TEMPLATE)?;

    let default_port = manifest
        .ports
        .first()
        .map(|p| p.container_port)
        .unwrap_or(8080);

    let has_env = !manifest.env.is_empty() || !manifest.secrets.is_empty();
    let has_ports = !manifest.ports.is_empty();

    let data = json!({
        "name": manifest.name,
        "service_type": format!("{:?}", manifest.service_type).to_lowercase(),
        "replicas": manifest.replicas.unwrap_or(1),
        "ports": manifest.ports,
        "env": manifest.env,
        "secrets": manifest.secrets,
        "has_env": has_env,
        "has_ports": has_ports,
        "resources": manifest.resources,
        "health": manifest.health,
        "default_port": default_port,
    });

    Ok(handlebars.render("k8s", &data)?)
}
