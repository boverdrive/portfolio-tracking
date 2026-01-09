use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use crate::error::AppError;
use crate::models::{Transaction, CreateTransactionRequest, UpdateTransactionRequest, AssetType};
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

/// List all transactions with optional filtering
#[derive(Debug, Deserialize)]
pub struct ListTransactionsQuery {
    #[allow(dead_code)]
    pub asset_type: Option<String>,
    #[allow(dead_code)]
    pub symbol: Option<String>,
}

/// List all transactions for the logged-in user
pub async fn list_transactions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Transaction>>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    tracing::info!("📋 Requesting transactions for user_id: {}", user_id);
    let transactions = state.db.list_transactions(&user_id).await?;
    Ok(Json(transactions))
}

/// Create a new transaction for the logged-in user
pub async fn create_transaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateTransactionRequest>,
) -> Result<Json<Transaction>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    
    // Validate quantity and price
    if req.quantity <= 0.0 {
        return Err(AppError::BadRequest("Quantity must be positive".to_string()));
    }
    if req.price <= 0.0 {
        return Err(AppError::BadRequest("Price must be positive".to_string()));
    }
    if req.fees < 0.0 {
        return Err(AppError::BadRequest("Fees cannot be negative".to_string()));
    }

    let transaction = state.db.create_transaction(req, &user_id).await?;
    Ok(Json(transaction))
}

/// Get a single transaction by ID (only if owned by user)
pub async fn get_transaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Transaction>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    let transaction = state.db.get_transaction(&id).await?;
    
    // Verify ownership
    if transaction.user_id != user_id {
        return Err(AppError::NotFound(format!("Transaction {} not found", id)));
    }
    
    Ok(Json(transaction))
}

/// Update a transaction (only if owned by user)
pub async fn update_transaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<UpdateTransactionRequest>,
) -> Result<Json<Transaction>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    
    // Verify ownership first
    let existing = state.db.get_transaction(&id).await?;
    if existing.user_id != user_id {
        return Err(AppError::NotFound(format!("Transaction {} not found", id)));
    }
    
    // Validate if values provided
    if let Some(quantity) = req.quantity {
        if quantity <= 0.0 {
            return Err(AppError::BadRequest("Quantity must be positive".to_string()));
        }
    }
    if let Some(price) = req.price {
        if price <= 0.0 {
            return Err(AppError::BadRequest("Price must be positive".to_string()));
        }
    }
    if let Some(fees) = req.fees {
        if fees < 0.0 {
            return Err(AppError::BadRequest("Fees cannot be negative".to_string()));
        }
    }

    let transaction = state.db.update_transaction(&id, req).await?;
    Ok(Json(transaction))
}

/// Delete a transaction (only if owned by user)
pub async fn delete_transaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    
    // Verify ownership first
    let existing = state.db.get_transaction(&id).await?;
    if existing.user_id != user_id {
        return Err(AppError::NotFound(format!("Transaction {} not found", id)));
    }
    
    state.db.delete_transaction(&id).await?;
    Ok(Json(serde_json::json!({
        "message": "Transaction deleted successfully",
        "id": id
    })))
}

/// Get transactions by asset type (for the logged-in user)
pub async fn get_transactions_by_type(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(asset_type): Path<String>,
) -> Result<Json<Vec<Transaction>>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    
    let asset_type = match asset_type.to_lowercase().as_str() {
        "stock" => AssetType::Stock,
        "tfex" => AssetType::Tfex,
        "crypto" => AssetType::Crypto,
        _ => return Err(AppError::BadRequest("Invalid asset type".to_string())),
    };
    
    // Get all transactions for user, then filter by asset type
    let all = state.db.list_transactions(&user_id).await?;
    let filtered: Vec<Transaction> = all.into_iter()
        .filter(|t| t.asset_type == asset_type)
        .collect();
    
    Ok(Json(filtered))
}
