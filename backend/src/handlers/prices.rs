use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use std::collections::HashMap;
use crate::error::AppError;
use crate::models::{AssetType, Market};
use crate::services::price_service::PriceEntry;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct GetPriceQuery {
    pub asset_type: String,
    pub market: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BatchPriceRequest {
    pub symbols: Vec<BatchPriceSymbol>,
}

#[derive(Debug, Deserialize)]
pub struct BatchPriceSymbol {
    pub symbol: String,
    pub asset_type: String,
    pub market: Option<String>,
}

/// Get current price for a single symbol
/// First tries external API, saves to PocketBase, then falls back to manual price if API fails
pub async fn get_price(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
    Query(query): Query<GetPriceQuery>,
) -> Result<Json<PriceEntry>, AppError> {
    let asset_type = parse_asset_type(&query.asset_type)?;
    let market = query.market.as_ref().map(|m| parse_market(m)).transpose()?;
    let pb_url = &state.config.pocketbase_url;
    
    // First, try to get price from external API
    match state.price_service.get_price(&symbol, &asset_type, market.as_ref()).await {
        Ok(price_entry) => {
            tracing::debug!("📊 API price for {}: {} {}", symbol, price_entry.price, price_entry.currency);
            
            // Save/update price in PocketBase (upsert based on symbol+asset_type+market)
            // Normalize market to lowercase to prevent duplicates
            let market_str = market.as_ref().map(|m| m.to_string().to_lowercase()).unwrap_or_default();
            let _ = save_price_to_pocketbase(
                pb_url,
                &symbol.to_uppercase(),
                &query.asset_type.to_lowercase(),
                &market_str,
                price_entry.price,
                &price_entry.currency,
            ).await;
            
            return Ok(Json(price_entry));
        }
        Err(e) => {
            tracing::warn!("API price fetch failed for {}: {}, trying manual price", symbol, e);
        }
    }
    
    // Fallback: try to get price from PocketBase asset_prices collection
    let market_filter = if let Some(m) = &market {
        format!(" && market='{}'", m.to_string().to_lowercase())
    } else {
        String::new()
    };
    let filter = format!("symbol='{}' && asset_type='{}'{}", symbol.to_uppercase(), query.asset_type.to_lowercase(), market_filter);
    let check_url = format!(
        "{}/api/collections/asset_prices/records?filter={}",
        pb_url,
        urlencoding::encode(&filter)
    );
    
    if let Ok(response) = reqwest::Client::new().get(&check_url).send().await {
        if response.status().is_success() {
            if let Ok(data) = response.json::<serde_json::Value>().await {
                if let Some(items) = data.get("items").and_then(|i| i.as_array()) {
                    if let Some(first) = items.first() {
                        if let Some(price) = first.get("price").and_then(|p| p.as_f64()) {
                            let currency = first.get("currency")
                                .and_then(|c| c.as_str())
                                .unwrap_or("THB")
                                .to_string();
                            
                            tracing::debug!("📊 Using manual price for {}: {} {}", symbol, price, currency);
                            
                            return Ok(Json(PriceEntry {
                                symbol: symbol.clone(),
                                price,
                                currency,
                                updated_at: chrono::Utc::now(),
                            }));
                        }
                    }
                }
            }
        }
    }
    
    Err(AppError::ExternalApiError(format!("Could not get price for {}", symbol)))
}

/// Save price to PocketBase asset_prices collection
async fn save_price_to_pocketbase(
    pb_url: &str,
    symbol: &str,
    asset_type: &str,
    market: &str,
    price: f64,
    currency: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    
    // Check if record exists
    let filter = if market.is_empty() {
        format!("symbol='{}' && asset_type='{}'", symbol, asset_type)
    } else {
        format!("symbol='{}' && asset_type='{}' && market='{}'", symbol, asset_type, market)
    };
    let check_url = format!(
        "{}/api/collections/asset_prices/records?filter={}",
        pb_url,
        urlencoding::encode(&filter)
    );
    
    let body = serde_json::json!({
        "symbol": symbol,
        "asset_type": asset_type,
        "market": if market.is_empty() { None } else { Some(market) },
        "price": price,
        "currency": currency,
        "updated_at": chrono::Utc::now().to_rfc3339()
    });
    
    if let Ok(response) = client.get(&check_url).send().await {
        if response.status().is_success() {
            if let Ok(data) = response.json::<serde_json::Value>().await {
                if let Some(items) = data.get("items").and_then(|i| i.as_array()) {
                    if let Some(first) = items.first() {
                        if let Some(id) = first.get("id").and_then(|i| i.as_str()) {
                            // Update existing record
                            let update_url = format!("{}/api/collections/asset_prices/records/{}", pb_url, id);
                            let _ = client.patch(&update_url)
                                .json(&body)
                                .send()
                                .await;
                            tracing::debug!("Updated price in PocketBase for {} ({})", symbol, market);
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
    
    // Create new record
    let create_url = format!("{}/api/collections/asset_prices/records", pb_url);
    let _ = client.post(&create_url)
        .json(&body)
        .send()
        .await;
    tracing::debug!("Created price in PocketBase for {} ({})", symbol, market);
    
    Ok(())
}

/// Get prices for multiple symbols in batch
pub async fn get_prices_batch(
    State(state): State<AppState>,
    Json(req): Json<BatchPriceRequest>,
) -> Result<Json<HashMap<String, serde_json::Value>>, AppError> {
    let mut results = HashMap::new();
    
    for item in req.symbols {
        let asset_type = match parse_asset_type(&item.asset_type) {
            Ok(t) => t,
            Err(e) => {
                results.insert(
                    item.symbol.clone(),
                    serde_json::json!({ "error": e.to_string() }),
                );
                continue;
            }
        };
        
        let market = item.market.as_ref()
            .map(|m| parse_market(m))
            .transpose()
            .ok()
            .flatten();
        
        match state.price_service.get_price(&item.symbol, &asset_type, market.as_ref()).await {
            Ok(price) => {
                results.insert(
                    item.symbol.clone(),
                    serde_json::to_value(price).unwrap_or_default(),
                );
            }
            Err(e) => {
                results.insert(
                    item.symbol.clone(),
                    serde_json::json!({ "error": e.to_string() }),
                );
            }
        }
    }
    
    Ok(Json(results))
}

/// Clear price cache
pub async fn clear_price_cache(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    state.price_service.clear_cache().await;
    Ok(Json(serde_json::json!({
        "message": "Price cache cleared"
    })))
}

fn parse_asset_type(s: &str) -> Result<AssetType, AppError> {
    match s.to_lowercase().as_str() {
        "stock" => Ok(AssetType::Stock),
        "tfex" => Ok(AssetType::Tfex),
        "crypto" => Ok(AssetType::Crypto),
        "foreign_stock" | "foreignstock" => Ok(AssetType::ForeignStock),
        "gold" => Ok(AssetType::Gold),
        "commodity" => Ok(AssetType::Commodity),
        _ => Err(AppError::BadRequest(format!(
            "Invalid asset type: {}. Must be one of: stock, tfex, crypto, foreign_stock, gold, commodity",
            s
        ))),
    }
}

fn parse_market(s: &str) -> Result<Market, AppError> {
    match s.to_lowercase().as_str() {
        "set" => Ok(Market::Set),
        "mai" => Ok(Market::Mai),
        "tfex" => Ok(Market::Tfex),
        "nyse" => Ok(Market::Nyse),
        "nasdaq" => Ok(Market::Nasdaq),
        "amex" => Ok(Market::Amex),
        "lse" => Ok(Market::Lse),
        "euronext" => Ok(Market::Euronext),
        "xetra" => Ok(Market::Xetra),
        "hkex" => Ok(Market::Hkex),
        "tse" => Ok(Market::Tse),
        "sgx" => Ok(Market::Sgx),
        "krx" => Ok(Market::Krx),
        "binance" => Ok(Market::Binance),
        "coinbase" => Ok(Market::Coinbase),
        "bitkub" => Ok(Market::Bitkub),
        "okx" => Ok(Market::Okx),
        "htx" => Ok(Market::Htx),
        "kucoin" => Ok(Market::Kucoin),
        "comex" => Ok(Market::Comex),
        "lbma" => Ok(Market::Lbma),
        _ => Err(AppError::BadRequest(format!("Invalid market: {}", s))),
    }
}
