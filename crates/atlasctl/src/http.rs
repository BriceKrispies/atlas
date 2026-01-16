use anyhow::{Context, Result};
use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::time::Duration;

pub struct AtlasClient {
    client: Client,
    base_url: String,
    debug_principal: Option<String>,
    correlation_id: Option<String>,
}

impl AtlasClient {
    pub fn new(base_url: String, timeout_ms: u64) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .build()
            .context("Failed to create HTTP client")?;

        Ok(Self {
            client,
            base_url,
            debug_principal: None,
            correlation_id: None,
        })
    }

    pub fn with_debug_principal(mut self, principal: Option<String>) -> Self {
        self.debug_principal = principal;
        self
    }

    pub fn with_correlation_id(mut self, correlation_id: Option<String>) -> Self {
        self.correlation_id = correlation_id;
        self
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let mut request = self.client.get(&url);

        if let Some(ref principal) = self.debug_principal {
            request = request.header("X-Debug-Principal", principal);
        }
        if let Some(ref correlation_id) = self.correlation_id {
            request = request.header("X-Correlation-ID", correlation_id);
        }

        let response = request.send().await.context("HTTP request failed")?;
        self.handle_response(response).await
    }

    pub async fn post<T: DeserializeOwned, B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let mut request = self.client.post(&url).json(body);

        if let Some(ref principal) = self.debug_principal {
            request = request.header("X-Debug-Principal", principal);
        }
        if let Some(ref correlation_id) = self.correlation_id {
            request = request.header("X-Correlation-ID", correlation_id);
        }

        let response = request.send().await.context("HTTP request failed")?;
        self.handle_response(response).await
    }

    pub async fn post_raw<B: serde::Serialize>(&self, path: &str, body: &B) -> Result<RawResponse> {
        let url = format!("{}{}", self.base_url, path);
        let mut request = self.client.post(&url).json(body);

        if let Some(ref principal) = self.debug_principal {
            request = request.header("X-Debug-Principal", principal);
        }
        if let Some(ref correlation_id) = self.correlation_id {
            request = request.header("X-Correlation-ID", correlation_id);
        }

        let response = request.send().await.context("HTTP request failed")?;
        let status = response.status();
        let body = response.text().await.context("Failed to read response body")?;

        Ok(RawResponse { status, body })
    }

    pub async fn get_raw(&self, path: &str) -> Result<RawResponse> {
        let url = format!("{}{}", self.base_url, path);
        let mut request = self.client.get(&url);

        if let Some(ref principal) = self.debug_principal {
            request = request.header("X-Debug-Principal", principal);
        }
        if let Some(ref correlation_id) = self.correlation_id {
            request = request.header("X-Correlation-ID", correlation_id);
        }

        let response = request.send().await.context("HTTP request failed")?;
        let status = response.status();
        let body = response.text().await.context("Failed to read response body")?;

        Ok(RawResponse { status, body })
    }

    async fn handle_response<T: DeserializeOwned>(&self, response: Response) -> Result<T> {
        let status = response.status();
        let body = response.text().await.context("Failed to read response body")?;

        if !status.is_success() {
            let snippet = if body.len() > 200 {
                format!("{}...", &body[..200])
            } else {
                body.clone()
            };
            anyhow::bail!("HTTP {} - {}", status.as_u16(), snippet);
        }

        serde_json::from_str(&body).with_context(|| {
            format!("Failed to parse response: {}", truncate_str(&body, 100))
        })
    }
}

#[derive(Debug)]
pub struct RawResponse {
    pub status: StatusCode,
    pub body: String,
}

impl RawResponse {
    pub fn is_success(&self) -> bool {
        self.status.is_success()
    }
}

fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() > max_len {
        format!("{}...", &s[..max_len])
    } else {
        s.to_string()
    }
}
