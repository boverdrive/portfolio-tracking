use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Job status enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Idle,
    Running,
    Success,
    Failed,
    Disabled,
}

impl Default for JobStatus {
    fn default() -> Self {
        JobStatus::Idle
    }
}

/// Job configuration stored in PocketBase
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub name_en: String,
    #[serde(default)]
    pub job_type: String,           // "api_status_check", "price_update", etc.
    #[serde(default = "default_interval")]
    pub interval_seconds: u64,      // Interval in seconds (default: 86400 = 1 day)
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub status: JobStatus,
    #[serde(default)]
    pub last_run: Option<String>,   // Changed to String for flexibility
    #[serde(default)]
    pub next_run: Option<String>,   // Changed to String for flexibility
    #[serde(default)]
    pub last_result: Option<serde_json::Value>,
    // PocketBase auto-generated fields - ignore unknown fields
    #[serde(default, skip_serializing)]
    pub created: Option<String>,
    #[serde(default, skip_serializing)]
    pub updated: Option<String>,
    #[serde(default, skip_serializing)]
    pub collectionId: Option<String>,
    #[serde(default, skip_serializing)]
    pub collectionName: Option<String>,
}

fn default_interval() -> u64 { 86400 }
fn default_true() -> bool { true }

impl Default for JobConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: "ตรวจสอบสถานะ API".to_string(),
            name_en: "API Status Check".to_string(),
            job_type: "api_status_check".to_string(),
            interval_seconds: 86400, // 1 day
            enabled: true,
            status: JobStatus::Idle,
            last_run: None,
            next_run: None,
            last_result: None,
            created: None,
            updated: None,
            collectionId: None,
            collectionName: None,
        }
    }
}

/// Job run history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRunHistory {
    #[serde(default)]
    pub id: String,
    pub job_id: String,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub status: String,             // "success", "failed", "running"
    pub results: serde_json::Value, // Detailed results
    pub error_message: Option<String>,
}

/// Request to update job config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateJobRequest {
    pub interval_seconds: Option<u64>,
    pub enabled: Option<bool>,
}

/// API status check result for a single endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiStatusResult {
    pub market_id: String,
    pub market_name: String,
    pub url: String,
    pub status: String,             // "online", "offline", "error"
    pub response_time_ms: Option<u64>,
    pub error_message: Option<String>,
}

/// Full API status check job result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiStatusCheckResult {
    pub total_checked: usize,
    pub online_count: usize,
    pub offline_count: usize,
    pub results: Vec<ApiStatusResult>,
}

/// Common interval presets in seconds
pub mod intervals {
    pub const ONE_HOUR: u64 = 3600;
    pub const SIX_HOURS: u64 = 21600;
    pub const TWELVE_HOURS: u64 = 43200;
    pub const ONE_DAY: u64 = 86400;
    pub const ONE_WEEK: u64 = 604800;
}
