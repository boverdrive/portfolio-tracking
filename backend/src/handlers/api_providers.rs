use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use crate::error::AppError;
use crate::models::{
    ApiProvider, CreateApiProviderRequest, UpdateApiProviderRequest, 
    ReorderProvidersRequest, ApiCallStats
};
use crate::AppState;

#[derive(Deserialize)]
pub struct LogsQuery {
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}

/// List all API providers
pub async fn list_providers(
    State(state): State<AppState>,
) -> Result<Json<Vec<ApiProvider>>, AppError> {
    let providers = state.db.list_all_providers().await?;
    Ok(Json(providers))
}

/// Get API providers for a specific market
pub async fn get_providers_by_market(
    State(state): State<AppState>,
    Path(market_id): Path<String>,
) -> Result<Json<Vec<ApiProvider>>, AppError> {
    let providers = state.db.get_providers_by_market(&market_id).await?;
    Ok(Json(providers))
}

/// Create a new API provider
pub async fn create_provider(
    State(state): State<AppState>,
    Json(req): Json<CreateApiProviderRequest>,
) -> Result<Json<ApiProvider>, AppError> {
    // Validate required fields
    if req.market_id.trim().is_empty() {
        return Err(AppError::BadRequest("market_id is required".to_string()));
    }
    if req.provider_name.trim().is_empty() {
        return Err(AppError::BadRequest("provider_name is required".to_string()));
    }
    if req.provider_type.trim().is_empty() {
        return Err(AppError::BadRequest("provider_type is required".to_string()));
    }
    if req.priority < 1 {
        return Err(AppError::BadRequest("priority must be >= 1".to_string()));
    }
    
    let provider = state.db.create_provider(req).await?;
    Ok(Json(provider))
}

/// Update an API provider
pub async fn update_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateApiProviderRequest>,
) -> Result<Json<ApiProvider>, AppError> {
    // Validate priority if provided
    if let Some(priority) = req.priority {
        if priority < 1 {
            return Err(AppError::BadRequest("priority must be >= 1".to_string()));
        }
    }
    
    let provider = state.db.update_provider(&id, req).await?;
    Ok(Json(provider))
}

/// Delete an API provider
pub async fn delete_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state.db.delete_provider(&id).await?;
    Ok(Json(serde_json::json!({
        "message": "Provider deleted successfully",
        "id": id
    })))
}

/// Reorder providers for a market
pub async fn reorder_providers(
    State(state): State<AppState>,
    Path(market_id): Path<String>,
    Json(req): Json<ReorderProvidersRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if req.provider_ids.is_empty() {
        return Err(AppError::BadRequest("provider_ids cannot be empty".to_string()));
    }
    
    state.db.reorder_providers(&market_id, req.provider_ids).await?;
    Ok(Json(serde_json::json!({
        "message": "Providers reordered successfully",
        "market_id": market_id
    })))
}

/// Get API call logs with pagination
pub async fn get_api_logs(
    State(state): State<AppState>,
    Query(query): Query<LogsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let page = query.page.unwrap_or(1);
    let per_page = query.per_page.unwrap_or(50).min(200);
    
    let (logs, total) = state.db.get_api_logs(page, per_page).await?;
    Ok(Json(serde_json::json!({
        "items": logs,
        "total": total,
        "page": page,
        "per_page": per_page
    })))
}

/// Get API call statistics
pub async fn get_api_stats(
    State(state): State<AppState>,
) -> Result<Json<Vec<ApiCallStats>>, AppError> {
    let stats = state.db.get_api_stats().await?;
    Ok(Json(stats))
}
