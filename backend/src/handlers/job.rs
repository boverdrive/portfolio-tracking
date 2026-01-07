use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::UpdateJobRequest;

/// List all jobs
pub async fn list_jobs(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let jobs = state.job_scheduler.get_jobs().await;
    Ok(Json(json!({ "jobs": jobs })))
}

/// Get a specific job
pub async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    match state.job_scheduler.get_job(&id).await {
        Some(job) => Ok(Json(json!(job))),
        None => Err(AppError::NotFound(format!("Job {} not found", id))),
    }
}

/// Update job configuration
pub async fn update_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateJobRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    match state.job_scheduler.update_job(&id, req.interval_seconds, req.enabled).await {
        Ok(job) => Ok(Json(json!(job))),
        Err(e) => Err(AppError::Internal(e)),
    }
}

/// Run a job immediately
pub async fn run_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    match state.job_scheduler.run_job_now(&id).await {
        Ok(result) => Ok(Json(json!({
            "success": true,
            "result": result
        }))),
        Err(e) => Err(AppError::Internal(e)),
    }
}
