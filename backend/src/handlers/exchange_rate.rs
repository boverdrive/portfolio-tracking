use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use crate::error::AppError;
use crate::services::exchange_rate::ExchangeRatesResponse;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct ConvertQuery {
    pub from: String,
    pub to: String,
    pub amount: Option<f64>,
}

/// Get exchange rate between two currencies
pub async fn get_exchange_rate(
    State(state): State<AppState>,
    Query(query): Query<ConvertQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let amount = query.amount.unwrap_or(1.0);
    let rate = state.exchange_rate_service.get_rate(&query.from, &query.to).await?;
    let converted = amount * rate;

    Ok(Json(serde_json::json!({
        "from": query.from.to_uppercase(),
        "to": query.to.to_uppercase(),
        "rate": rate,
        "amount": amount,
        "converted": converted,
        "updated_at": chrono::Utc::now()
    })))
}

/// Get all exchange rates for a base currency
pub async fn get_all_exchange_rates(
    State(state): State<AppState>,
    Path(base): Path<String>,
) -> Result<Json<ExchangeRatesResponse>, AppError> {
    let rates = state.exchange_rate_service.get_all_rates(&base).await?;
    Ok(Json(rates))
}

/// Convert amount between currencies
pub async fn convert_currency(
    State(state): State<AppState>,
    Query(query): Query<ConvertQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let amount = query.amount.unwrap_or(1.0);
    let converted = state.exchange_rate_service.convert(amount, &query.from, &query.to).await?;
    let rate = state.exchange_rate_service.get_rate(&query.from, &query.to).await?;

    Ok(Json(serde_json::json!({
        "from": query.from.to_uppercase(),
        "to": query.to.to_uppercase(),
        "amount": amount,
        "converted": converted,
        "rate": rate
    })))
}

/// Clear exchange rate cache
pub async fn clear_exchange_rate_cache(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    state.exchange_rate_service.clear_cache().await;
    Ok(Json(serde_json::json!({
        "message": "Exchange rate cache cleared"
    })))
}
