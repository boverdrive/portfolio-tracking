use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::config::Config;
use crate::error::AppError;
use crate::models::{AssetType, Market};

/// Cached price entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceEntry {
    pub symbol: String,
    pub price: f64,
    pub currency: String,
    pub updated_at: DateTime<Utc>,
}

/// Price service for fetching prices from external APIs with caching
#[derive(Clone)]
pub struct PriceService {
    client: reqwest::Client,
    config: Config,
    cache: Arc<RwLock<HashMap<String, PriceEntry>>>,
}

impl PriceService {
    pub fn new(config: Config) -> Self {
        Self {
            client: reqwest::Client::new(),
            config,
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Get price for a symbol, using cache if available and not expired
    pub async fn get_price(
        &self, 
        symbol: &str, 
        asset_type: &AssetType,
        market: Option<&Market>,
    ) -> Result<PriceEntry, AppError> {
        let market_key = market.map(|m| m.to_string()).unwrap_or_default();
        let cache_key = format!("{}:{}:{}", asset_type, market_key, symbol.to_uppercase());
        
        // Check cache first
        {
            let cache = self.cache.read().await;
            if let Some(entry) = cache.get(&cache_key) {
                let age = Utc::now().signed_duration_since(entry.updated_at);
                if age.num_seconds() < self.config.price_cache_ttl_seconds as i64 {
                    tracing::debug!("Cache hit for {}", cache_key);
                    return Ok(entry.clone());
                }
            }
        }

        // Fetch fresh price based on asset type
        let price_entry = match asset_type {
            AssetType::Crypto => self.fetch_crypto_price(symbol, market).await?,
            AssetType::Stock | AssetType::Tfex => self.fetch_thai_stock_price(symbol).await?,
            AssetType::ForeignStock => self.fetch_foreign_stock_price(symbol, market).await?,
            AssetType::Gold => self.fetch_gold_price(symbol).await?,
            AssetType::Commodity => self.fetch_commodity_price(symbol).await?,
        };

        // Update cache
        {
            let mut cache = self.cache.write().await;
            cache.insert(cache_key, price_entry.clone());
        }

        Ok(price_entry)
    }

    /// Get prices for multiple symbols
    pub async fn get_prices_batch(
        &self, 
        symbols: &[(String, AssetType, Option<Market>)]
    ) -> HashMap<String, Result<PriceEntry, String>> {
        let mut results = HashMap::new();
        
        for (symbol, asset_type, market) in symbols {
            let result = self.get_price(symbol, asset_type, market.as_ref()).await;
            results.insert(
                symbol.clone(),
                result.map_err(|e| e.to_string()),
            );
        }
        
        results
    }

    /// Fetch cryptocurrency price - uses market-specific API when available
    async fn fetch_crypto_price(&self, symbol: &str, market: Option<&Market>) -> Result<PriceEntry, AppError> {
        tracing::debug!("fetch_crypto_price for {} with market: {:?}", symbol, market);
        
        if let Some(m) = market {
            tracing::debug!("Checking market match for {:?}", m);
            match m {
                Market::Bitkub => {
                    // Use Bitkub API for Bitkub market (THB pairs)
                    tracing::info!("Using Bitkub API for {} (market: {:?})", symbol, m);
                    match self.fetch_bitkub_price(symbol).await {
                        Ok(entry) => {
                            tracing::info!("Bitkub price for {}: {} {}", symbol, entry.price, entry.currency);
                            return Ok(entry);
                        }
                        Err(e) => {
                            tracing::warn!("Bitkub API failed for {}: {}, falling back to CoinGecko", symbol, e);
                        }
                    }
                }
                Market::Binance => {
                    // Use Binance API for Binance market (USDT pairs)
                    tracing::info!("Using Binance API for {} (market: {:?})", symbol, m);
                    match self.fetch_binance_price(symbol).await {
                        Ok(entry) => {
                            tracing::info!("Binance price for {}: {} {}", symbol, entry.price, entry.currency);
                            return Ok(entry);
                        }
                        Err(e) => {
                            tracing::warn!("Binance API failed for {}: {}, falling back to CoinGecko", symbol, e);
                        }
                    }
                }
                Market::Okx | Market::Htx | Market::Kucoin => {
                    // Use OKX API for OKX, HTX, KuCoin markets (USDT pairs)
                    tracing::info!("Using OKX API for {} (market: {:?})", symbol, m);
                    match self.fetch_okx_price(symbol).await {
                        Ok(entry) => {
                            tracing::info!("OKX price for {}: {} {}", symbol, entry.price, entry.currency);
                            return Ok(entry);
                        }
                        Err(e) => {
                            tracing::warn!("OKX API failed for {}: {}, falling back to CoinGecko", symbol, e);
                        }
                    }
                }
                _ => {
                    tracing::debug!("Market {:?} not using specific API", m);
                }
            }
        }
        
        // Default: CoinGecko API (returns THB)
        tracing::debug!("Using CoinGecko API for {}", symbol);
        self.fetch_coingecko_price(symbol).await
    }

    /// Fetch price from Bitkub API (returns THB price)
    async fn fetch_bitkub_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        // Bitkub uses THB_BTC format
        let pair = format!("THB_{}", symbol.to_uppercase());
        let url = format!(
            "https://api.bitkub.com/api/market/ticker?sym={}",
            pair
        );

        tracing::info!("Fetching crypto price from Bitkub: {}", url);

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::ExternalApiError(format!(
                "Bitkub API error: {}",
                response.status()
            )));
        }

        let data: serde_json::Value = response.json().await?;
        
        // Bitkub response format: { "THB_BTC": { "last": 2904027.00, ... } }
        let thb_price = data
            .get(&pair)
            .and_then(|v| v.get("last"))
            .and_then(|v| v.as_f64())
            .ok_or_else(|| AppError::ExternalApiError(format!(
                "Could not parse Bitkub price for {}",
                symbol
            )))?;

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price: thb_price,
            currency: "THB".to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch price from Binance API (returns USDT price)
    async fn fetch_binance_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        // Binance uses BTCUSDT format
        let pair = format!("{}USDT", symbol.to_uppercase());
        let url = format!(
            "https://api.binance.com/api/v3/ticker/price?symbol={}",
            pair
        );

        tracing::info!("Fetching crypto price from Binance: {}", url);

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::ExternalApiError(format!(
                "Binance API error: {}",
                response.status()
            )));
        }

        let data: serde_json::Value = response.json().await?;
        
        // Binance response format: { "symbol": "BTCUSDT", "price": "94123.50" }
        let usdt_price = data
            .get("price")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or_else(|| AppError::ExternalApiError(format!(
                "Could not parse Binance price for {}",
                symbol
            )))?;

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price: usdt_price,
            currency: "USDT".to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch price from OKX API (returns USD price)
    async fn fetch_okx_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        // OKX uses BTC-USDT format
        let inst_id = format!("{}-USDT", symbol.to_uppercase());
        let url = format!(
            "https://www.okx.com/api/v5/market/ticker?instId={}",
            inst_id
        );

        tracing::info!("Fetching crypto price from OKX: {}", url);

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::ExternalApiError(format!(
                "OKX API error: {}",
                response.status()
            )));
        }

        let data: serde_json::Value = response.json().await?;
        
        // OKX response format: { "code": "0", "data": [{ "last": "94123.5", ... }] }
        let usd_price = data
            .get("data")
            .and_then(|d| d.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("last"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or_else(|| AppError::ExternalApiError(format!(
                "Could not parse OKX price for {}",
                symbol
            )))?;

        // Return USD price since OKX transactions are in USD
        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price: usd_price,
            currency: "USD".to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch cryptocurrency price from CoinGecko API
    async fn fetch_coingecko_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        let coin_id = self.get_coingecko_id(symbol);
        let url = format!(
            "{}/simple/price?ids={}&vs_currencies=thb,usd",
            self.config.coingecko_api_url,
            coin_id
        );

        tracing::info!("Fetching crypto price from CoinGecko: {}", url);

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::ExternalApiError(format!(
                "CoinGecko API error: {}",
                response.status()
            )));
        }

        let data: serde_json::Value = response.json().await?;
        
        let price = data
            .get(&coin_id)
            .and_then(|v| v.get("thb"))
            .and_then(|v| v.as_f64())
            .ok_or_else(|| AppError::ExternalApiError(format!(
                "Could not parse price for {}",
                symbol
            )))?;

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price,
            currency: "THB".to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch Thai stock price (mock - Settrade API requires credentials)
    async fn fetch_thai_stock_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        tracing::warn!(
            "Using mock price for {}. Settrade API integration pending.", 
            symbol
        );

        // Mock prices for common Thai stocks
        let mock_prices: HashMap<&str, f64> = [
            ("PTT", 32.50), ("ADVANC", 245.00), ("CPALL", 58.25),
            ("AOT", 62.00), ("KBANK", 135.50), ("SCB", 98.75),
            ("GULF", 42.25), ("DELTA", 850.00), ("BTS", 5.85),
            ("TRUE", 8.40), ("INTUCH", 72.50), ("BDMS", 27.75),
            ("SCC", 295.00), ("PTTEP", 142.50), ("PTTGC", 42.00),
            // SET50 Index Futures - around 920-930 points
            ("S50", 925.00), 
            ("S50H24", 920.00), ("S50M24", 922.00), ("S50U24", 924.00), ("S50Z24", 926.00),
            ("S50H25", 925.00), ("S50M25", 927.00), ("S50U25", 929.00), ("S50Z25", 931.00),
            ("S50H26", 928.00), ("S50M26", 930.00), ("S50U26", 932.00), ("S50Z26", 934.00),
            // Gold Futures (10 Baht) - around 35,000-36,000 THB
            ("GFH24", 35200.0), ("GFM24", 35300.0), ("GFU24", 35400.0), ("GFZ24", 35500.0),
            ("GFH25", 35600.0), ("GFM25", 35700.0), ("GFU25", 35800.0), ("GFZ25", 35900.0),
            ("GFH26", 36000.0), ("GFM26", 36100.0),
            // Gold-D (50 Baht) - around 175,000-180,000 THB
            ("GDH24", 176000.0), ("GDM24", 176500.0), ("GDU24", 177000.0), ("GDZ24", 177500.0),
            ("GDH25", 178000.0), ("GDM25", 178500.0), ("GDU25", 179000.0), ("GDZ25", 179500.0),
            ("GDH26", 180000.0), ("GDM26", 180500.0),
            // Silver Futures - around 950-1000 THB per oz
            ("SVH24", 955.0), ("SVM24", 960.0), ("SVU24", 965.0), ("SVZ24", 970.0),
            ("SVH25", 975.0), ("SVM25", 980.0), ("SVH26", 990.0),
            // USD Futures - around 34-35 THB
            ("USDH24", 34.50), ("USDM24", 34.55), ("USDU24", 34.60), ("USDZ24", 34.65),
            ("USDH25", 34.70), ("USDM25", 34.75), ("USDU25", 34.80), ("USDZ25", 34.85),
            ("USDH26", 34.90), ("USDM26", 34.95),
            // Sector Futures
            ("BANKH24", 480.0), ("BANKM24", 482.0), ("ENRGH24", 1850.0), ("ENRGM24", 1855.0),
            // Single Stock Futures (SSF) - based on underlying stock prices
            ("PTTH24", 32.80), ("PTTM24", 32.90), ("AOTH24", 62.50), ("AOTM24", 62.80),
            ("CPALLH24", 58.50), ("CPALLM24", 58.80), ("DELTAH24", 855.0), ("DELTAM24", 858.0),
            ("ADVH24", 246.0), ("ADVM24", 247.0), ("SCBH24", 99.0), ("SCBM24", 99.5),
            ("KBANKH24", 136.0), ("KBANKM24", 136.5), ("GULFH24", 42.50), ("GULFM24", 42.80),
            // Brent Crude Oil Futures - around 2,700-2,800 THB
            ("BRNH24", 2750.0), ("BRNM24", 2760.0), ("BRNU24", 2770.0), ("BRNZ24", 2780.0),
            ("BRNH25", 2790.0), ("BRNM25", 2800.0), ("BRNH26", 2820.0), ("BRNM26", 2830.0),
            // Rubber Futures (RSS3) - around 55-60 THB/kg
            ("TSRH24", 56.0), ("TSRM24", 56.5), ("TSRU24", 57.0), ("TSRZ24", 57.5),
            ("TSRH25", 58.0), ("TSRM25", 58.5),
        ].into_iter().collect();

        let price = mock_prices
            .get(symbol.to_uppercase().as_str())
            .copied()
            .unwrap_or(100.0);

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price,
            currency: "THB".to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch foreign stock price (mock - Alpha Vantage API requires key)
    async fn fetch_foreign_stock_price(
        &self, 
        symbol: &str,
        market: Option<&Market>,
    ) -> Result<PriceEntry, AppError> {
        tracing::warn!(
            "Using mock price for foreign stock {}. Alpha Vantage API integration pending.", 
            symbol
        );

        // Mock prices for popular US/foreign stocks
        let mock_prices: HashMap<&str, (f64, &str)> = [
            // US Tech - NYSE/NASDAQ (prices in USD)
            ("AAPL", (175.50, "USD")), ("MSFT", (378.25, "USD")),
            ("GOOGL", (141.80, "USD")), ("GOOG", (142.50, "USD")),
            ("AMZN", (178.75, "USD")), ("NVDA", (495.00, "USD")),
            ("META", (355.20, "USD")), ("TSLA", (248.50, "USD")),
            ("AMD", (145.30, "USD")), ("INTC", (45.80, "USD")),
            // US Finance
            ("JPM", (185.40, "USD")), ("BAC", (34.50, "USD")),
            ("GS", (385.00, "USD")), ("MS", (92.50, "USD")),
            // US Other
            ("JNJ", (158.75, "USD")), ("PG", (150.20, "USD")),
            ("KO", (59.80, "USD")), ("PEP", (172.50, "USD")),
            ("DIS", (92.30, "USD")), ("NFLX", (485.00, "USD")),
            // European stocks
            ("BP", (5.25, "GBP")), ("HSBC", (6.45, "GBP")),
            ("SAP", (178.50, "EUR")), ("ASML", (685.00, "EUR")),
            ("NVO", (105.80, "USD")), // Novo Nordisk ADR
            // Asian stocks
            ("TSM", (105.50, "USD")), // Taiwan Semi ADR
            ("BABA", (78.50, "USD")), ("JD", (28.50, "USD")),
            ("SONY", (85.20, "USD")), ("TM", (185.00, "USD")),
        ].into_iter().collect();

        let (price, currency) = mock_prices
            .get(symbol.to_uppercase().as_str())
            .copied()
            .unwrap_or((100.0, market.map(|m| m.default_currency()).unwrap_or("USD")));

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price,
            currency: currency.to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch gold price (mock - Metals API requires key)
    async fn fetch_gold_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        tracing::warn!(
            "Using mock price for gold {}. Metals API integration pending.", 
            symbol
        );

        // Mock gold prices (XAU = per troy oz, others per gram/baht)
        let mock_prices: HashMap<&str, (f64, &str)> = [
            // International gold (per troy oz)
            ("XAU", (2025.50, "USD")),      // Gold spot USD
            ("XAUUSD", (2025.50, "USD")),   // Gold vs USD
            ("XAUTHB", (72500.00, "THB")),  // Gold vs THB (per oz)
            // Thai gold (per baht weight = 15.244 grams)
            ("GOLD", (35450.00, "THB")),    // Gold general
            ("GOLD96.5", (35450.00, "THB")), // 96.5% purity bar
            ("GOLD99.99", (42500.00, "THB")), // 99.99% purity
            // Other precious metals
            ("XAG", (23.85, "USD")),        // Silver spot
            ("XPT", (920.00, "USD")),       // Platinum
            ("XPD", (1050.00, "USD")),      // Palladium
        ].into_iter().collect();

        let (price, currency) = mock_prices
            .get(symbol.to_uppercase().as_str())
            .copied()
            .unwrap_or((2000.0, "USD"));

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price,
            currency: currency.to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch commodity price (mock)
    async fn fetch_commodity_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        tracing::warn!(
            "Using mock price for commodity {}.", 
            symbol
        );

        let mock_prices: HashMap<&str, (f64, &str)> = [
            ("CL", (75.50, "USD")),   // Crude Oil
            ("NG", (2.85, "USD")),    // Natural Gas
            ("GC", (2025.00, "USD")), // Gold Futures
            ("SI", (23.50, "USD")),   // Silver Futures
            ("HG", (3.85, "USD")),    // Copper
            ("ZC", (485.00, "USD")),  // Corn
            ("ZS", (1250.00, "USD")), // Soybeans
            ("ZW", (625.00, "USD")),  // Wheat
        ].into_iter().collect();

        let (price, currency) = mock_prices
            .get(symbol.to_uppercase().as_str())
            .copied()
            .unwrap_or((100.0, "USD"));

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price,
            currency: currency.to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Map common crypto symbols to CoinGecko IDs
    fn get_coingecko_id(&self, symbol: &str) -> String {
        let symbol_upper = symbol.to_uppercase();
        match symbol_upper.as_str() {
            "BTC" => "bitcoin".to_string(),
            "ETH" => "ethereum".to_string(),
            "BNB" => "binancecoin".to_string(),
            "XRP" => "ripple".to_string(),
            "ADA" => "cardano".to_string(),
            "SOL" => "solana".to_string(),
            "DOGE" => "dogecoin".to_string(),
            "DOT" => "polkadot".to_string(),
            "MATIC" => "matic-network".to_string(),
            "AVAX" => "avalanche-2".to_string(),
            "LINK" => "chainlink".to_string(),
            "UNI" => "uniswap".to_string(),
            "ATOM" => "cosmos".to_string(),
            "LTC" => "litecoin".to_string(),
            "ETC" => "ethereum-classic".to_string(),
            "XLM" => "stellar".to_string(),
            "NEAR" => "near".to_string(),
            "APT" => "aptos".to_string(),
            "ARB" => "arbitrum".to_string(),
            "OP" => "optimism".to_string(),
            "SUI" => "sui".to_string(),
            "SEI" => "sei-network".to_string(),
            "TIA" => "celestia".to_string(),
            _ => symbol.to_lowercase(),
        }
    }

    /// Clear all cached prices
    pub async fn clear_cache(&self) {
        let mut cache = self.cache.write().await;
        cache.clear();
        tracing::info!("Price cache cleared");
    }
}
