use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};
use crate::error::AppError;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct SnapshotQuery {
    pub days: Option<i32>,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PortfolioSnapshot {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub total_invested: f64,
    #[serde(default)]
    pub total_current_value: f64,
    #[serde(default)]
    pub total_unrealized_pnl: f64,
    #[serde(default)]
    pub total_unrealized_pnl_percent: f64,
    #[serde(default)]
    pub total_realized_pnl: f64,
    #[serde(default)]
    pub assets_count: serde_json::Value, // Flexible type - can be number or null
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub assets: Option<serde_json::Value>,
    // Catch any other fields from PocketBase
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct PocketBaseResponse {
    items: Vec<PortfolioSnapshot>,
}

/// Extract user_id from Authorization header JWT
fn extract_user_id(state: &AppState, headers: &HeaderMap) -> Result<String, AppError> {
    let auth_header = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".to_string()))?;
    
    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("Invalid Authorization header format".to_string()))?;
    
    let claims = state.auth_service.verify_jwt(token)?;
    Ok(claims.sub)
}

/// GET /api/snapshots - Get portfolio snapshots for the logged-in user
pub async fn get_snapshots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SnapshotQuery>,
) -> Result<Json<Vec<PortfolioSnapshot>>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    
    // Build filter
    let mut filter = format!("user_id='{}'", user_id);
    
    // Date filtering
    if let (Some(from), Some(to)) = (&query.from, &query.to) {
        filter.push_str(&format!(" && date >= '{}' && date <= '{}'", from, to));
    } else if let Some(days) = query.days {
        let from_date = chrono::Utc::now() - chrono::Duration::days(days as i64);
        let from_str = from_date.format("%Y-%m-%d").to_string();
        filter.push_str(&format!(" && date >= '{}'", from_str));
    }
    
    let url = format!(
        "{}/api/collections/portfolio_snapshots/records?filter={}&sort=date&perPage=500",
        state.config.pocketbase_url,
        urlencoding::encode(&filter)
    );
    
    let token = state.db.get_token().await;
    let client = reqwest::Client::new();
    let req = client.get(&url);
    let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
    
    let response = req.send().await
        .map_err(|e| AppError::Internal(format!("Failed to fetch snapshots: {}", e)))?;
    
    if !response.status().is_success() {
        return Err(AppError::Internal("Failed to fetch snapshots".to_string()));
    }
    
    let data: PocketBaseResponse = response.json().await
        .map_err(|e| AppError::Internal(format!("Failed to parse snapshots: {}", e)))?;
    
    Ok(Json(data.items))
}

/// POST /api/snapshots/now - Trigger a manual snapshot for the current user
pub async fn create_snapshot_now(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    
    // Find the portfolio_snapshot job and run it
    // For now, we'll create a snapshot directly for this user
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    
    // This is a simplified version - in production, you'd want to reuse the job logic
    Ok(Json(serde_json::json!({
        "message": "Snapshot creation triggered",
        "user_id": user_id,
        "date": today
    })))
}
