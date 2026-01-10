use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// API Provider configuration for fetching prices
/// Providers are tried in order of priority (1 = highest priority)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiProvider {
    pub id: String,
    pub market_id: String,
    pub provider_name: String,
    pub provider_type: String,
    pub api_url: String,
    pub priority: i32,
    pub enabled: bool,
    pub timeout_ms: u64,
}

/// Request to create a new API provider
#[derive(Debug, Deserialize)]
pub struct CreateApiProviderRequest {
    pub market_id: String,
    pub provider_name: String,
    pub provider_type: String,
    pub api_url: Option<String>,
    pub priority: i32,
    pub enabled: Option<bool>,
    pub timeout_ms: Option<u64>,
}

/// Request to update an API provider
#[derive(Debug, Deserialize)]
pub struct UpdateApiProviderRequest {
    pub provider_name: Option<String>,
    pub provider_type: Option<String>,
    pub api_url: Option<String>,
    pub priority: Option<i32>,
    pub enabled: Option<bool>,
    pub timeout_ms: Option<u64>,
}

/// Request to reorder providers for a market
#[derive(Debug, Deserialize)]
pub struct ReorderProvidersRequest {
    /// List of provider IDs in desired order (first = highest priority)
    pub provider_ids: Vec<String>,
}

/// API call log entry for monitoring and debugging
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiCallLog {
    pub id: Option<String>,
    pub provider_type: String,
    pub market_id: Option<String>,
    pub symbol: String,
    pub status: String,
    pub response_time_ms: u64,
    pub price: Option<f64>,
    pub currency: Option<String>,
    pub error_message: Option<String>,
    pub request_url: Option<String>,
    pub created: Option<DateTime<Utc>>,
}

/// Request body for creating an API call log
#[derive(Debug, Serialize)]
pub struct CreateApiCallLogRequest {
    pub provider_type: String,
    pub market_id: Option<String>,
    pub symbol: String,
    pub status: String,
    pub response_time_ms: u64,
    pub price: Option<f64>,
    pub currency: Option<String>,
    pub error_message: Option<String>,
    pub request_url: Option<String>,
}

/// Summary statistics for API calls
#[derive(Debug, Serialize)]
pub struct ApiCallStats {
    pub provider_type: String,
    pub total_calls: u64,
    pub success_count: u64,
    pub error_count: u64,
    pub success_rate: f64,
    pub avg_response_time_ms: f64,
}

/// Known provider types that the system supports
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProviderType {
    // Crypto exchanges
    Bitkub,
    Binance,
    BinanceFutures,
    CoinGecko,
    Okx,
    Kucoin,
    Htx,
    // Stock/Finance APIs
    YahooFinance,
    SetMarketData,
    // Gold
    GoldApi,
    GoldTraders,
    // Generic fallback
    Custom,
}

#[allow(dead_code)]
impl ProviderType {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "bitkub" => ProviderType::Bitkub,
            "binance" => ProviderType::Binance,
            "binance_futures" => ProviderType::BinanceFutures,
            "coingecko" => ProviderType::CoinGecko,
            "okx" => ProviderType::Okx,
            "kucoin" => ProviderType::Kucoin,
            "htx" | "huobi" => ProviderType::Htx,
            "yahoo_finance" | "yahoo" => ProviderType::YahooFinance,
            "set_marketdata" | "set" => ProviderType::SetMarketData,
            "goldapi" => ProviderType::GoldApi,
            "goldtraders" => ProviderType::GoldTraders,
            _ => ProviderType::Custom,
        }
    }
    
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderType::Bitkub => "bitkub",
            ProviderType::Binance => "binance",
            ProviderType::BinanceFutures => "binance_futures",
            ProviderType::CoinGecko => "coingecko",
            ProviderType::Okx => "okx",
            ProviderType::Kucoin => "kucoin",
            ProviderType::Htx => "htx",
            ProviderType::YahooFinance => "yahoo_finance",
            ProviderType::SetMarketData => "set_marketdata",
            ProviderType::GoldApi => "goldapi",
            ProviderType::GoldTraders => "goldtraders",
            ProviderType::Custom => "custom",
        }
    }
}
