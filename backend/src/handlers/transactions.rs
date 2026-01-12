use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use crate::error::AppError;
use crate::models::{
    Transaction, CreateTransactionRequest, UpdateTransactionRequest, AssetType, TradeAction
};
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
    if req.quantity <= 0.0 && req.action != TradeAction::Dividend {
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
        // We only check quantity > 0 if we know the action, but here we only have UpdateRequest.
        // If action is NOT being updated, we check against existing.
        // If action IS being updated, we check against new action.
        // For simplicity, we check if quantity <= 0 AND (action is not Dividend).
        // Fetch existing first to check action if not provided.
        let action = req.action.clone().unwrap_or(existing.action.clone());
        
        if quantity <= 0.0 && action != TradeAction::Dividend {
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
/// Bulk create transactions
pub async fn create_transactions_bulk(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(reqs): Json<Vec<CreateTransactionRequest>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    let mut success_count = 0;
    let mut errors = Vec::new();

    // Limit batch size to prevent overloading
    if reqs.len() > 1000 {
        return Err(AppError::BadRequest("Batch size exceeds limit (1000)".to_string()));
    }

    // Pre-load symbols once to ensure cache is warm
    let _ = state.symbols_service.load_symbols().await;
    tracing::info!("Starting bulk import of {} transactions", reqs.len());

    for (index, mut req) in reqs.into_iter().enumerate() {
        // Basic validation
        if req.quantity <= 0.0 && req.action != TradeAction::Dividend {
            errors.push(format!("Row {}: Quantity must be positive", index + 1));
            continue;
        }
        if req.price <= 0.0 {
            errors.push(format!("Row {}: Price must be positive", index + 1));
            continue;
        }

        // Auto-populate symbol_name if missing
        if req.symbol_name.is_none() || req.symbol_name.as_ref().is_some_and(|n| n.is_empty()) {
            if let Some(symbol_data) = state.symbols_service.lookup_symbol(&req.symbol).await {
                req.symbol_name = Some(symbol_data.name);
            }
        }

        match state.db.create_transaction(req, &user_id).await {
            Ok(_) => success_count += 1,
            Err(e) => errors.push(format!("Row {}: {}", index + 1, e)),
        }
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "count": success_count,
        "errors": errors
    })))
}
