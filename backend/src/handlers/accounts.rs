use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use crate::error::AppError;
use crate::models::{Account, CreateAccountRequest, UpdateAccountRequest};
use crate::AppState;

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

/// List all accounts for the logged-in user
pub async fn list_accounts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Account>>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    let accounts = state.db.list_accounts(&user_id).await?;
    Ok(Json(accounts))
}

/// Create a new account for the logged-in user
pub async fn create_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateAccountRequest>,
) -> Result<Json<Account>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    
    // Validate name
    if req.name.trim().is_empty() {
        return Err(AppError::BadRequest("Account name cannot be empty".to_string()));
    }

    // Validate target_value if provided
    if let Some(target) = req.target_value {
        if target < 0.0 {
            return Err(AppError::BadRequest("Target value cannot be negative".to_string()));
        }
    }

    let account = state.db.create_account(req, &user_id).await?;
    Ok(Json(account))
}

/// Get a single account by ID (only if owned by user)
pub async fn get_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Account>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    let account = state.db.get_account(&id).await?;
    
    // Verify ownership
    if account.user_id != user_id {
        return Err(AppError::NotFound(format!("Account {} not found", id)));
    }
    
    Ok(Json(account))
}

/// Update an account (only if owned by user)
pub async fn update_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<UpdateAccountRequest>,
) -> Result<Json<Account>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    
    // Verify ownership first
    let existing = state.db.get_account(&id).await?;
    if existing.user_id != user_id {
        return Err(AppError::NotFound(format!("Account {} not found", id)));
    }
    
    // Validate name if provided
    if let Some(ref name) = req.name {
        if name.trim().is_empty() {
            return Err(AppError::BadRequest("Account name cannot be empty".to_string()));
        }
    }

    // Validate target_value if provided
    if let Some(target) = req.target_value {
        if target < 0.0 {
            return Err(AppError::BadRequest("Target value cannot be negative".to_string()));
        }
    }

    let account = state.db.update_account(&id, req).await?;
    Ok(Json(account))
}

/// Delete an account (only if owned by user)
pub async fn delete_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    
    // Verify ownership first
    let existing = state.db.get_account(&id).await?;
    if existing.user_id != user_id {
        return Err(AppError::NotFound(format!("Account {} not found", id)));
    }
    
    state.db.delete_account(&id).await?;
    Ok(Json(serde_json::json!({
        "message": "Account deleted successfully",
        "id": id
    })))
}

/// Reorder accounts
pub async fn reorder_accounts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(ids): Json<Vec<String>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    
    // Get all user accounts to verify ownership efficiently
    let user_accounts = state.db.list_accounts(&user_id).await?;
    let owned_ids: std::collections::HashSet<String> = user_accounts.into_iter().map(|a| a.id).collect();
    
    // Update ranks
    for (index, id) in ids.iter().enumerate() {
        if owned_ids.contains(id) {
            let req = UpdateAccountRequest {
                name: None,
                description: None,
                color: None,
                target_value: None,
                target_currency: None,
                rank: Some(index as i32),
            };
            // Ignore errors for individual updates to avoid breaking the whole batch
            // In a real app, might want better error handling
            let _ = state.db.update_account(id, req).await;
        }
    }
    
    Ok(Json(serde_json::json!({
        "message": "Accounts reordered successfully"
    })))
}
