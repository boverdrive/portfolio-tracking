use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AssetType {
    Stock,           // Thai stocks (SET)
    Tfex,            // Thai Futures Exchange
    Crypto,          // Cryptocurrency
    ForeignStock,    // Foreign stocks (US, EU, etc.)
    Gold,            // Gold (XAU)
    Commodity,       // Other commodities
}

impl std::fmt::Display for AssetType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AssetType::Stock => write!(f, "stock"),
            AssetType::Tfex => write!(f, "tfex"),
            AssetType::Crypto => write!(f, "crypto"),
            AssetType::ForeignStock => write!(f, "foreign_stock"),
            AssetType::Gold => write!(f, "gold"),
            AssetType::Commodity => write!(f, "commodity"),
        }
    }
}

/// Market/Exchange categorization
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Market {
    // Thai markets
    Set,             // Stock Exchange of Thailand
    Mai,             // Market for Alternative Investment
    Tfex,            // Thailand Futures Exchange
    
    // US markets
    Nyse,            // New York Stock Exchange
    Nasdaq,          // NASDAQ
    Amex,            // NYSE American
    
    // European markets
    Lse,             // London Stock Exchange
    Euronext,        // Euronext (Paris, Amsterdam, Brussels)
    Xetra,           // Frankfurt Stock Exchange
    
    // Asian markets
    Hkex,            // Hong Kong Exchange
    Tse,             // Tokyo Stock Exchange
    Sgx,             // Singapore Exchange
    Krx,             // Korea Exchange
    
    // Crypto exchanges
    Binance,
    Coinbase,
    Bitkub,
    Htx,              // HTX (formerly Huobi)
    Okx,              // OKX Exchange
    Kucoin,           // KuCoin Exchange
    
    // Commodities
    Comex,           // COMEX (Gold, Silver)
    Lbma,            // London Bullion Market
    
    // Other
    Other,
}

impl std::fmt::Display for Market {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Market::Set => write!(f, "SET"),
            Market::Mai => write!(f, "MAI"),
            Market::Tfex => write!(f, "TFEX"),
            Market::Nyse => write!(f, "NYSE"),
            Market::Nasdaq => write!(f, "NASDAQ"),
            Market::Amex => write!(f, "AMEX"),
            Market::Lse => write!(f, "LSE"),
            Market::Euronext => write!(f, "EURONEXT"),
            Market::Xetra => write!(f, "XETRA"),
            Market::Hkex => write!(f, "HKEX"),
            Market::Tse => write!(f, "TSE"),
            Market::Sgx => write!(f, "SGX"),
            Market::Krx => write!(f, "KRX"),
            Market::Binance => write!(f, "BINANCE"),
            Market::Coinbase => write!(f, "COINBASE"),
            Market::Bitkub => write!(f, "BITKUB"),
            Market::Htx => write!(f, "HTX"),
            Market::Okx => write!(f, "OKX"),
            Market::Kucoin => write!(f, "KUCOIN"),
            Market::Comex => write!(f, "COMEX"),
            Market::Lbma => write!(f, "LBMA"),
            Market::Other => write!(f, "OTHER"),
        }
    }
}

impl Market {
    /// Get the default currency for this market
    pub fn default_currency(&self) -> &str {
        match self {
            Market::Set | Market::Mai | Market::Tfex | Market::Bitkub => "THB",
            Market::Nyse | Market::Nasdaq | Market::Amex | Market::Coinbase | Market::Comex => "USD",
            Market::Lse => "GBP",
            Market::Euronext | Market::Xetra => "EUR",
            Market::Hkex => "HKD",
            Market::Tse => "JPY",
            Market::Sgx => "SGD",
            Market::Krx => "KRW",
            Market::Binance | Market::Htx | Market::Okx | Market::Kucoin => "USDT",
            Market::Lbma => "USD",
            Market::Other => "USD",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TradeAction {
    Buy,
    Sell,
    // TFEX-specific actions
    Long,
    Short,
    CloseLong,
    CloseShort,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub user_id: String,  // Owner of this transaction
    pub asset_type: AssetType,
    pub symbol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol_name: Option<String>,
    pub action: TradeAction,
    pub quantity: f64,
    pub price: f64,
    #[serde(default)]
    pub fees: f64,
    pub timestamp: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub market: Option<Market>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_null_as_empty", skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leverage: Option<f64>,         // Leverage multiplier for futures (e.g., 10x, 20x)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_margin: Option<f64>,   // Actual money used for futures
    #[serde(default, skip_serializing)]
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTransactionRequest {
    pub asset_type: AssetType,
    pub symbol: String,
    pub symbol_name: Option<String>,
    pub action: TradeAction,
    pub quantity: f64,
    pub price: f64,
    #[serde(default)]
    pub fees: f64,
    #[serde(default = "Utc::now")]
    pub timestamp: DateTime<Utc>,
    pub market: Option<Market>,
    pub currency: Option<String>,
    pub notes: Option<String>,
    pub account_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub leverage: Option<f64>,
    pub initial_margin: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTransactionRequest {
    pub asset_type: Option<AssetType>,
    pub symbol: Option<String>,
    pub symbol_name: Option<String>,
    pub action: Option<TradeAction>,
    pub quantity: Option<f64>,
    pub price: Option<f64>,
    pub fees: Option<f64>,
    pub timestamp: Option<DateTime<Utc>>,
    pub market: Option<Market>,
    pub currency: Option<String>,
    pub notes: Option<String>,
    pub account_id: Option<String>,
    pub tags: Option<Vec<String>>,
    pub leverage: Option<f64>,
    pub initial_margin: Option<f64>,
}

impl Transaction {
    pub fn new(req: CreateTransactionRequest) -> Self {
        Self::new_with_user(req, String::new())
    }

    pub fn new_with_user(req: CreateTransactionRequest, user_id: String) -> Self {
        let now = Utc::now();
        let currency = req.currency.or_else(|| {
            req.market.as_ref().map(|m| m.default_currency().to_string())
        });
        
        Self {
            id: generate_pb_id(),
            user_id,
            asset_type: req.asset_type,
            symbol: req.symbol.to_uppercase(),
            symbol_name: req.symbol_name,
            action: req.action,
            quantity: req.quantity,
            price: req.price,
            fees: req.fees,
            timestamp: req.timestamp,
            market: req.market,
            currency,
            notes: req.notes,
            account_id: req.account_id,
            tags: req.tags,
            leverage: req.leverage,
            initial_margin: req.initial_margin,
            created_at: now,
            updated_at: now,
        }
    }
}

/// Generate a PocketBase compatible ID (15 chars, a-z0-9)
fn generate_pb_id() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::rng();
    (0..15)
        .map(|_| {
            let idx = rng.random_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

fn deserialize_null_as_empty<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt = Option::<Vec<String>>::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}
