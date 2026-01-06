//! Prometheus metrics for workers service

use lazy_static::lazy_static;
use prometheus::{register_counter, Counter, Encoder, TextEncoder};

lazy_static! {
    pub static ref WORKER_HEARTBEATS_TOTAL: Counter = register_counter!(
        "worker_heartbeats_total",
        "Total number of worker heartbeats"
    )
    .unwrap();

    // Future metrics for job processing
    // pub static ref JOBS_PROCESSED_TOTAL: CounterVec = register_counter_vec!(
    //     "jobs_processed_total",
    //     "Total number of jobs processed",
    //     &["job_type", "status"]
    // ).unwrap();
    //
    // pub static ref PROJECTIONS_APPLIED_TOTAL: CounterVec = register_counter_vec!(
    //     "projections_applied_total",
    //     "Total number of projections applied",
    //     &["projection_name", "event_type"]
    // ).unwrap();
}

/// Gather all metrics and encode them in Prometheus text format
pub fn gather_metrics() -> String {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer).unwrap();
    String::from_utf8(buffer).unwrap()
}
