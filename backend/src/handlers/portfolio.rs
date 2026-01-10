use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use std::collections::HashMap;
use serde::Serialize;
use crate::error::AppError;
use crate::models::{PortfolioAsset, PortfolioSummary, TradeAction, AssetType, Market};
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct PortfolioResponse {
    pub summary: PortfolioSummary,
    pub assets: Vec<PortfolioAsset>,
}

#[derive(Debug, serde::Deserialize)]
pub struct PortfolioQuery {
    #[serde(default)]
    pub include_closed: bool,
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

/// Get complete portfolio with P&L calculations for the logged-in user
pub async fn get_portfolio(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<PortfolioQuery>,
) -> Result<Json<PortfolioResponse>, AppError> {
    let user_id = extract_user_id(&state, &headers)?;
    let transactions = state.db.list_transactions(&user_id).await?;
    
    // Sort transactions by timestamp ascending (oldest first) for correct P&L calculation
    let mut sorted_transactions = transactions.clone();
    sorted_transactions.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    
    // Group transactions by symbol+type+market and calculate holdings
    let mut holdings: HashMap<String, PortfolioAsset> = HashMap::new();
    let mut realized_pnl = 0.0; // Keep for backward compatibility (sum of all raw values)
    let mut realized_pnl_breakdown: HashMap<String, f64> = HashMap::new();
    
    for tx in &sorted_transactions {
        // Determine position "bucket" to support Hedge Mode (separating Spot, Long, Short)
        let position_bucket = match tx.action {
            TradeAction::Buy | TradeAction::Sell => "spot",
            TradeAction::Long | TradeAction::CloseLong => "long",
            TradeAction::Short | TradeAction::CloseShort => "short",
        };
        
        let market_key = tx.market.as_ref().map(|m| m.to_string()).unwrap_or_default();
        // Key now includes position_bucket to separate distinct positions (Hedge Mode)
        let key = format!("{}:{}:{}:{}", tx.asset_type, market_key, tx.symbol, position_bucket);
        
        let asset = holdings.entry(key.clone()).or_insert_with(|| {
            let currency = tx.currency.clone()
                .or_else(|| tx.market.as_ref().map(|m| m.default_currency().to_string()))
                .unwrap_or_else(|| "THB".to_string());
            let mut new_asset = PortfolioAsset::new(
                tx.symbol.clone(), 
                tx.asset_type.clone(),
                tx.market.clone(),
                currency,
            );
            new_asset.position_type = position_bucket.to_string(); // Set the position type
            
            // Set leverage from first transaction
            if let Some(lev) = tx.leverage {
                new_asset.leverage = lev;
            }
            new_asset
        });
        
        // Update leverage if transaction has one (take the latest)
        if let Some(lev) = tx.leverage {
            asset.leverage = lev;
        }
        
        match tx.action {
            TradeAction::Buy | TradeAction::Long => {
                // Buy, Long (open buy) - increase long position
                let new_quantity = asset.quantity + tx.quantity;
                let purchase_cost = tx.quantity * tx.price;  // Cost without fees
                
                // Calculate weighted average cost (without fees)
                let total_purchase_cost = (asset.quantity.abs() * asset.avg_cost) + purchase_cost;
                asset.avg_cost = if new_quantity.abs() > 0.0 {
                    total_purchase_cost / new_quantity.abs()
                } else {
                    tx.price
                };
                
                // Track fees separately
                asset.total_fees += tx.fees;
                
                // Total cost includes fees for P&L calculation
                asset.quantity = new_quantity;
                asset.total_cost = (asset.quantity.abs() * asset.avg_cost) + asset.total_fees;
            }
            TradeAction::Short => {
                // Open Short - create/increase negative position
                // Note: In Hedge mode, this bucket contains ONLY Short positions.
                // quantity will be negative.
                let new_quantity = asset.quantity - tx.quantity;  // Goes more negative
                let short_value = tx.quantity * tx.price;
                
                // For short, avg_cost is the price at which we shorted.
                // We add the new short value to the existing basis.
                let total_short_cost = (asset.quantity.abs() * asset.avg_cost) + short_value;
                asset.avg_cost = if new_quantity.abs() > 0.0 {
                    total_short_cost / new_quantity.abs()
                } else {
                    tx.price
                };
                
                asset.total_fees += tx.fees;
                asset.quantity = new_quantity;
                asset.total_cost = (asset.quantity.abs() * asset.avg_cost) + asset.total_fees;
            }
            TradeAction::Sell | TradeAction::CloseLong => {
                // Sell, CloseLong - close long position
                // This logic runs on "spot" or "long" buckets.
                if asset.quantity > 0.0 {
                    let sell_value = tx.quantity * tx.price - tx.fees;
                    let cost_basis = tx.quantity * asset.avg_cost;
                    let pnl = sell_value - cost_basis;
                    realized_pnl += pnl;
                    
                    // Accumulate breakdown by currency
                    let currency = tx.currency.clone()
                        .or_else(|| tx.market.as_ref().map(|m| m.default_currency().to_string()))
                        .unwrap_or_else(|| "THB".to_string());
                    *realized_pnl_breakdown.entry(currency).or_insert(0.0) += pnl;
                    
                    asset.realized_pnl += pnl;
                    
                    // Reduce quantity and proportionally reduce fees
                    // Logic: Removing a portion of the holding removes a portion of the "Open Cost" fees.
                    let ratio = tx.quantity / asset.quantity;
                    asset.total_fees -= asset.total_fees * ratio;
                    
                    asset.quantity -= tx.quantity;
                    asset.total_cost = (asset.quantity * asset.avg_cost) + asset.total_fees;
                }
            }
            TradeAction::CloseShort => {
                // CloseShort - buy to close short position
                // This logic runs on "short" bucket where quantity is negative.
                if asset.quantity < 0.0 {
                    let buy_cost = tx.quantity * tx.price + tx.fees;
                    let short_value = tx.quantity * asset.avg_cost;  // Price we sold at * qty
                    let pnl = short_value - buy_cost;
                    realized_pnl += pnl;
                    
                    // Accumulate breakdown by currency
                    let currency = tx.currency.clone()
                        .or_else(|| tx.market.as_ref().map(|m| m.default_currency().to_string()))
                        .unwrap_or_else(|| "THB".to_string());
                    *realized_pnl_breakdown.entry(currency).or_insert(0.0) += pnl;

                    asset.realized_pnl += pnl;
                    
                    // Reduce negative quantity (towards 0)
                    let ratio = tx.quantity / asset.quantity.abs();
                    asset.total_fees -= asset.total_fees * ratio;
                    
                    asset.quantity += tx.quantity;  // Add to reduce negative
                    asset.total_cost = (asset.quantity.abs() * asset.avg_cost) + asset.total_fees;
                }
            }
        }
    }
    
    // Filter out zero holdings unless include_closed is true
    // Use abs() to include both long (positive) and short (negative) positions
    let mut active_holdings: Vec<PortfolioAsset> = if query.include_closed {
        holdings.into_values().collect()
    } else {
        holdings
            .into_values()
            .filter(|a| a.quantity.abs() > 0.00000001) // Support both long and short positions
            .collect()
    };
    
    // Fetch current prices for all holdings
    // Fetch current prices for all holdings
    // For SET/TFEX: check PocketBase first (Settrade API not available)
    // For others: check price_service (API) first, then PocketBase fallback
    let http_client = reqwest::Client::new();
    let pb_url = &state.config.pocketbase_url;
    
    for asset in &mut active_holdings {
        let asset_type_str = match asset.asset_type {
            crate::models::AssetType::Stock => "stock",
            crate::models::AssetType::Tfex => "tfex",
            crate::models::AssetType::ForeignStock => "foreign_stock",
            crate::models::AssetType::Crypto => "crypto",
            crate::models::AssetType::Gold => "gold",
            crate::models::AssetType::Commodity => "commodity",
        };
        
        let market_filter = if let Some(m) = &asset.market {
            // Use case-insensitive matching (~) since PocketBase may store different cases
            format!(" && market~'{}'", m.to_string().to_lowercase())
        } else {
            String::new()
        };
        let filter = format!("symbol='{}' && asset_type='{}'{}", asset.symbol, asset_type_str, market_filter);
        
        // Debug: log filter for XAG
        if asset.symbol == "XAG" {
            tracing::info!("XAG PocketBase filter: {}", filter);
        }
        
        let check_url = format!(
            "{}/api/collections/asset_prices/records?filter={}",
            pb_url,
            urlencoding::encode(&filter)
        );
        
        // Helper: Try to get price from PocketBase
        let pb_price = async {
            if let Ok(response) = http_client.get(&check_url).send().await {
                if response.status().is_success() {
                    if let Ok(data) = response.json::<serde_json::Value>().await {
                        if let Some(items) = data.get("items").and_then(|i| i.as_array()) {
                            if let Some(first) = items.first() {
                                return first.get("price").and_then(|p| p.as_f64());
                            }
                        }
                    }
                }
            }
            None
        }.await;
        
        // Determine price fetch strategy based on asset type
        // For Thai stocks, TFEX, and Foreign stocks: use PocketBase first
        let use_pb_first = matches!(
            asset.asset_type,
            crate::models::AssetType::Stock | crate::models::AssetType::Tfex | crate::models::AssetType::ForeignStock
        );
        
        let mut found_price = false;
        
        if use_pb_first {
            // Thai stocks/TFEX/Foreign stocks: PocketBase first, then API fallback
            if let Some(price) = pb_price {
                tracing::debug!("📊 Using PB price for {}: {}", asset.symbol, price);
                asset.update_pnl(price);
                found_price = true;
            } else {
                // Try API as fallback
                if let Ok(price_entry) = state.price_service.get_price(&asset.symbol, &asset.asset_type, asset.market.as_ref()).await {
                    tracing::debug!("📊 API price for {}: {} {}", asset.symbol, price_entry.price, price_entry.currency);
                    asset.update_pnl(price_entry.price);
                    asset.currency = price_entry.currency.clone();  // Update currency to match price source
                    found_price = true;
                }
            }
        } else {
            // Other assets: API first, then PocketBase fallback
            match state.price_service.get_price(&asset.symbol, &asset.asset_type, asset.market.as_ref()).await {
                Ok(price_entry) => {
                    tracing::debug!("📊 API price for {}: {} {}", asset.symbol, price_entry.price, price_entry.currency);
                    asset.update_pnl(price_entry.price);
                    asset.currency = price_entry.currency.clone();  // Update currency to match price source
                    found_price = true;
                }
                Err(e) => {
                    tracing::warn!("API price fetch failed for {}: {}, trying PB", asset.symbol, e);
                    if let Some(price) = pb_price {
                        tracing::debug!("📊 Using PB price for {}: {}", asset.symbol, price);
                        asset.update_pnl(price);
                        found_price = true;
                    }
                }
            }
        }
        
        // Final fallback: use avg_cost so P&L shows as 0
        if !found_price {
            tracing::warn!("No price found for {}, using avg_cost as fallback", asset.symbol);
            asset.update_pnl(asset.avg_cost);
        }
    }
    
    // Sort by current value descending
    active_holdings.sort_by(|a, b| {
        b.current_value.partial_cmp(&a.current_value).unwrap_or(std::cmp::Ordering::Equal)
    });
    
    // Calculate portfolio summary
    let mut summary = PortfolioSummary::new();
    summary.total_realized_pnl = realized_pnl;
    summary.realized_pnl_breakdown = realized_pnl_breakdown;
    summary.assets_count = active_holdings.len();
    
    for asset in &active_holdings {
        summary.total_invested += asset.total_cost;
        summary.total_current_value += asset.current_value;
        summary.total_unrealized_pnl += asset.unrealized_pnl;
    }
    
    summary.calculate_percent();
    
    Ok(Json(PortfolioResponse {
        summary,
        assets: active_holdings,
    }))
}

/// Get portfolio summary only
pub async fn get_portfolio_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<PortfolioSummary>, AppError> {
    let portfolio = get_portfolio(State(state), headers, axum::extract::Query(PortfolioQuery { include_closed: false })).await?;
    Ok(Json(portfolio.summary.clone()))
}

/// Get holdings by asset type (for logged-in user)
pub async fn get_portfolio_by_type(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(asset_type): Path<String>,
) -> Result<Json<PortfolioResponse>, AppError> {
    let asset_type_enum = parse_asset_type(&asset_type)?;
    
    let portfolio = get_portfolio(State(state), headers, axum::extract::Query(PortfolioQuery { include_closed: false })).await?;
    
    let filtered_assets: Vec<PortfolioAsset> = portfolio.assets
        .iter()
        .filter(|a| a.asset_type == asset_type_enum)
        .cloned()
        .collect();
    
    let mut summary = PortfolioSummary::new();
    summary.assets_count = filtered_assets.len();
    
    for asset in &filtered_assets {
        summary.total_invested += asset.total_cost;
        summary.total_current_value += asset.current_value;
        summary.total_unrealized_pnl += asset.unrealized_pnl;
    }
    
    summary.calculate_percent();
    
    Ok(Json(PortfolioResponse {
        summary,
        assets: filtered_assets,
    }))
}

/// Get holdings by market (for logged-in user)
pub async fn get_portfolio_by_market(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(market): Path<String>,
) -> Result<Json<PortfolioResponse>, AppError> {
    let market_enum = parse_market(&market)?;
    
    let portfolio = get_portfolio(State(state), headers, axum::extract::Query(PortfolioQuery { include_closed: false })).await?;
    
    let filtered_assets: Vec<PortfolioAsset> = portfolio.assets
        .iter()
        .filter(|a| a.market.as_ref() == Some(&market_enum))
        .cloned()
        .collect();
    
    let mut summary = PortfolioSummary::new();
    summary.assets_count = filtered_assets.len();
    
    for asset in &filtered_assets {
        summary.total_invested += asset.total_cost;
        summary.total_current_value += asset.current_value;
        summary.total_unrealized_pnl += asset.unrealized_pnl;
    }
    
    summary.calculate_percent();
    
    Ok(Json(PortfolioResponse {
        summary,
        assets: filtered_assets,
    }))
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
