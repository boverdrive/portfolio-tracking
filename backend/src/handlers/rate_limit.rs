use axum::{
    extract::State,
    Json,
};
use serde::Serialize;
use crate::AppState;
use crate::error::AppError;

#[derive(Debug, Serialize)]
pub struct RateLimitStatusResponse {
    pub api_name: String,
    pub requests_per_minute: i32,
    pub requests_per_day: Option<i32>,
    pub current_minute_count: i32,
    pub current_day_count: i32,
    pub minute_remaining: i32,
    pub day_remaining: Option<i32>,
    pub is_blocked: bool,
    pub blocked_until: Option<String>,
    pub last_request_at: Option<String>,
}

/// GET /api/rate-limits - Get all rate limit statuses
pub async fn get_rate_limits(
    State(state): State<AppState>,
) -> Result<Json<Vec<RateLimitStatusResponse>>, AppError> {
    let limits = state.rate_limiter.get_all_limits().await;
    
    let response: Vec<RateLimitStatusResponse> = limits.into_iter().map(|l| {
        let minute_remaining = (l.requests_per_minute - l.current_minute_count).max(0);
        let day_remaining = l.requests_per_day.map(|d| (d - l.current_day_count).max(0));
        
        RateLimitStatusResponse {
            api_name: l.api_name,
            requests_per_minute: l.requests_per_minute,
            requests_per_day: l.requests_per_day,
            current_minute_count: l.current_minute_count,
            current_day_count: l.current_day_count,
            minute_remaining,
            day_remaining,
            is_blocked: l.is_blocked,
            blocked_until: l.blocked_until,
            last_request_at: l.last_request_at,
        }
    }).collect();
    
    Ok(Json(response))
}
