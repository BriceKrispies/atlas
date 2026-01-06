//! Prometheus metrics for ingress service

use lazy_static::lazy_static;
use prometheus::{
    register_counter_vec, register_histogram_vec, CounterVec, Encoder, HistogramVec, TextEncoder,
};

lazy_static! {
    pub static ref HTTP_REQUESTS_TOTAL: CounterVec = register_counter_vec!(
        "http_requests_total",
        "Total number of HTTP requests",
        &["route", "method", "status"]
    )
    .unwrap();
    pub static ref HTTP_REQUEST_DURATION_SECONDS: HistogramVec = register_histogram_vec!(
        "http_request_duration_seconds",
        "HTTP request duration in seconds",
        &["route", "method"],
        vec![0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
    )
    .unwrap();
    pub static ref EVENTS_APPENDED_TOTAL: CounterVec = register_counter_vec!(
        "events_appended_total",
        "Total number of events appended to event store",
        &["tenant_id", "event_type"]
    )
    .unwrap();
    pub static ref POLICY_EVALUATIONS_TOTAL: CounterVec = register_counter_vec!(
        "policy_evaluations_total",
        "Total number of policy evaluations",
        &["decision"]
    )
    .unwrap();
}

/// Gather all metrics and encode them in Prometheus text format
pub fn gather_metrics() -> String {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer).unwrap();
    String::from_utf8(buffer).unwrap()
}
