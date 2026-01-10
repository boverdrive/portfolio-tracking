use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::config::Config;
use crate::error::AppError;
use crate::models::{AssetType, Market, CreateApiCallLogRequest};
use crate::services::rate_limiter::RateLimiter;
use crate::services::pocketbase::PocketBaseClient;

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
    rate_limiter: Option<RateLimiter>,
    pb_client: Option<PocketBaseClient>,
}

impl PriceService {
    pub fn new(config: Config) -> Self {
        Self {
            client: reqwest::Client::new(),
            config,
            cache: Arc::new(RwLock::new(HashMap::new())),
            rate_limiter: None,
            pb_client: None,
        }
    }
    
    /// Create PriceService with rate limiter
    pub fn with_rate_limiter(config: Config, rate_limiter: RateLimiter) -> Self {
        Self {
            client: reqwest::Client::new(),
            config,
            cache: Arc::new(RwLock::new(HashMap::new())),
            rate_limiter: Some(rate_limiter),
            pb_client: None,
        }
    }
    
    /// Set PocketBase client for provider configuration and logging
    pub fn set_pb_client(&mut self, pb_client: PocketBaseClient) {
        self.pb_client = Some(pb_client);
    }
    
    /// Set rate limiter after creation
    pub fn set_rate_limiter(&mut self, rate_limiter: RateLimiter) {
        self.rate_limiter = Some(rate_limiter);
    }
    
    /// Log an API call to PocketBase (fire-and-forget)
    fn log_api_call_async(
        &self, 
        provider_type: &str, 
        market_id: Option<&str>,
        symbol: &str,
        status: &str,
        response_time_ms: u64,
        price: Option<f64>,
        currency: Option<&str>,
        error_message: Option<&str>,
        request_url: Option<&str>,
    ) {
        if let Some(ref pb_client) = self.pb_client {
            let log = CreateApiCallLogRequest {
                provider_type: provider_type.to_string(),
                market_id: market_id.map(|s| s.to_string()),
                symbol: symbol.to_string(),
                status: status.to_string(),
                response_time_ms,
                price,
                currency: currency.map(|s| s.to_string()),
                error_message: error_message.map(|s| s.to_string()),
                request_url: request_url.map(|s| s.to_string()),
            };
            pb_client.log_api_call(log);
        }
    }
    
    /// Check rate limit before making API call
    async fn check_rate_limit(&self, api_name: &str) -> Result<(), AppError> {
        if let Some(ref limiter) = self.rate_limiter {
            if !limiter.can_request(api_name).await {
                return Err(AppError::ExternalApiError(format!(
                    "Rate limit exceeded for {}. Please wait before retrying.",
                    api_name
                )));
            }
        }
        Ok(())
    }
    
    /// Record successful API call
    async fn record_api_call(&self, api_name: &str) {
        if let Some(ref limiter) = self.rate_limiter {
            limiter.record_request(api_name).await;

        }
    }
    
    /// Record rate limit hit (429 response)
    async fn record_rate_limit_hit(&self, api_name: &str, retry_after: Option<u64>) {
        if let Some(ref limiter) = self.rate_limiter {
            limiter.record_rate_limit_hit(api_name, retry_after).await;
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
                            tracing::warn!("Binance Spot API failed for {}: {}, trying Futures...", symbol, e);
                            // Try Futures API
                            match self.fetch_binance_futures_price(symbol).await {
                                Ok(entry) => {
                                    tracing::info!("Binance Futures price for {}: {} {}", symbol, entry.price, entry.currency);
                                    return Ok(entry);
                                }
                                Err(e2) => {
                                    tracing::warn!("Binance Futures API failed for {}: {}, falling back to CoinGecko", symbol, e2);
                                }
                            }
                        }
                    }
                }
                Market::Okx => {
                    // Use OKX API for OKX market (USDT pairs)
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
                Market::Kucoin => {
                    // Use KuCoin API for KuCoin market (USDT pairs)
                    tracing::info!("Using KuCoin API for {} (market: {:?})", symbol, m);
                    match self.fetch_kucoin_price(symbol).await {
                        Ok(entry) => {
                            tracing::info!("KuCoin price for {}: {} {}", symbol, entry.price, entry.currency);
                            return Ok(entry);
                        }
                        Err(e) => {
                            tracing::warn!("KuCoin API failed for {}: {}, falling back to CoinGecko", symbol, e);
                        }
                    }
                }
                Market::Htx => {
                    // Use HTX (Huobi) API for HTX market (USDT pairs)
                    tracing::info!("Using HTX API for {} (market: {:?})", symbol, m);
                    match self.fetch_htx_price(symbol).await {
                        Ok(entry) => {
                            tracing::info!("HTX price for {}: {} {}", symbol, entry.price, entry.currency);
                            return Ok(entry);
                        }
                        Err(e) => {
                            tracing::warn!("HTX API failed for {}: {}, falling back to CoinGecko", symbol, e);
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
        // Check rate limit first
        self.check_rate_limit("bitkub").await?;
        
        // Bitkub uses THB_BTC format
        let pair = format!("THB_{}", symbol.to_uppercase());
        let url = format!(
            "https://api.bitkub.com/api/market/ticker?sym={}",
            pair
        );

        tracing::info!("Fetching crypto price from Bitkub: {}", url);
        
        let start = Instant::now();

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;
        
        // Record the API call
        self.record_api_call("bitkub").await;
        
        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().as_u16() == 429 {
            self.record_rate_limit_hit("bitkub", None).await;
            self.log_api_call_async("bitkub", None, symbol, "error", elapsed_ms, None, None, Some("Rate limit exceeded"), Some(&url));
            return Err(AppError::ExternalApiError("Bitkub rate limit exceeded".to_string()));
        }
        
        if !response.status().is_success() {
            let error_msg = format!("Bitkub API error: {}", response.status());
            self.log_api_call_async("bitkub", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
            return Err(AppError::ExternalApiError(error_msg));
        }

        let data: serde_json::Value = response.json().await?;
        
        // Bitkub response format: { "THB_BTC": { "last": 2904027.00, ... } }
        let thb_price = data
            .get(&pair)
            .and_then(|v| v.get("last"))
            .and_then(|v| v.as_f64())
            .ok_or_else(|| {
                let error_msg = format!("Could not parse Bitkub price for {}", symbol);
                self.log_api_call_async("bitkub", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
                AppError::ExternalApiError(error_msg)
            })?;

        // Log successful API call
        self.log_api_call_async("bitkub", None, symbol, "success", elapsed_ms, Some(thb_price), Some("THB"), None, Some(&url));

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price: thb_price,
            currency: "THB".to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch price from Binance API (returns USDT price)
    async fn fetch_binance_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        // Special case: Gold (XAU) and Silver (XAG) are only available on Binance Futures
        // Redirect to futures API transparently
        if symbol.eq_ignore_ascii_case("XAG") || symbol.eq_ignore_ascii_case("XAU") {
            tracing::info!("Redirecting {} to Binance Futures (not available on Spot)", symbol);
            return self.fetch_binance_futures_price(symbol).await;
        }

        // Check rate limit first
        self.check_rate_limit("binance").await?;
        
        let symbol_upper = symbol.to_uppercase(); // Binance uses BTCUSDT format
        let pair = format!("{}USDT", symbol_upper);
        let url = format!(
            "https://api.binance.com/api/v3/ticker/price?symbol={}",
            pair
        );

        tracing::info!("Fetching crypto price from Binance: {}", url);
        
        let start = Instant::now();

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;
        
        // Record the API call
        self.record_api_call("binance").await;
        
        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().as_u16() == 429 {
            self.record_rate_limit_hit("binance", None).await;
            self.log_api_call_async("binance", None, symbol, "error", elapsed_ms, None, None, Some("Rate limit exceeded"), Some(&url));
            return Err(AppError::ExternalApiError("Binance rate limit exceeded".to_string()));
        }
        
        if !response.status().is_success() {
            let error_msg = format!("Binance API error: {}", response.status());
            self.log_api_call_async("binance", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
            return Err(AppError::ExternalApiError(error_msg));
        }

        let data: serde_json::Value = response.json().await?;
        
        // Binance response format: { "symbol": "BTCUSDT", "price": "94123.50" }
        let usdt_price = data
            .get("price")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or_else(|| {
                let error_msg = format!("Could not parse Binance price for {}", symbol);
                self.log_api_call_async("binance", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
                AppError::ExternalApiError(error_msg)
            })?;

        // Log successful API call
        self.log_api_call_async("binance", None, symbol, "success", elapsed_ms, Some(usdt_price), Some("USDT"), None, Some(&url));

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price: usdt_price,
            currency: "USDT".to_string(),
            updated_at: Utc::now(),
        })
    }
    
    /// Fetch price from Binance Futures API (Perpetual contracts)
    async fn fetch_binance_futures_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        // Check rate limit (use same binance limit)
        self.check_rate_limit("binance").await?;
        
        // Binance Futures uses BTCUSDT format for perps
        let symbol_upper = symbol.to_uppercase();
        let pair = if symbol_upper.ends_with("USDT") {
            symbol_upper.clone()
        } else {
            format!("{}USDT", symbol_upper)
        };
        
        let url = format!(
            "https://fapi.binance.com/fapi/v1/ticker/price?symbol={}",
            pair
        );

        tracing::info!("Fetching futures price from Binance Futures: {}", url);

        let start = Instant::now();

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;
        
        // Record the API call
        self.record_api_call("binance").await;
        
        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().as_u16() == 429 {
            self.record_rate_limit_hit("binance", None).await;
            self.log_api_call_async("binance_futures", Some("FUTURES"), symbol, "error", elapsed_ms, None, None, Some("Rate limit exceeded"), Some(&url));
            return Err(AppError::ExternalApiError("Binance Futures rate limit exceeded".to_string()));
        }
        
        if !response.status().is_success() {
            let error_msg = format!("Binance Futures API error: {}", response.status());
            self.log_api_call_async("binance_futures", Some("FUTURES"), symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
            return Err(AppError::ExternalApiError(error_msg));
        }

        let data: serde_json::Value = response.json().await?;
        
        // Binance Futures response: { "symbol": "XAGUSDT", "price": "76.9300", "time": 123... }
        let usdt_price = data
            .get("price")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or_else(|| {
                let error_msg = format!("Could not parse Binance Futures price for {}", symbol);
                self.log_api_call_async("binance_futures", Some("FUTURES"), symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
                AppError::ExternalApiError(error_msg)
            })?;
        
        // Log successful API call
        self.log_api_call_async("binance_futures", Some("FUTURES"), symbol, "success", elapsed_ms, Some(usdt_price), Some("USDT"), None, Some(&url));

        tracing::info!("Binance Futures price for {}: {} USDT", symbol, usdt_price);

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price: usdt_price,
            currency: "USDT".to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch price from OKX API (returns USD price)
    async fn fetch_okx_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        // Check rate limit first
        self.check_rate_limit("okx").await?;
        
        // OKX uses BTC-USDT format
        let inst_id = format!("{}-USDT", symbol.to_uppercase());
        let url = format!(
            "https://www.okx.com/api/v5/market/ticker?instId={}",
            inst_id
        );

        tracing::info!("Fetching crypto price from OKX: {}", url);

        let start = Instant::now();

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;
        
        // Record the API call
        self.record_api_call("okx").await;
        
        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().as_u16() == 429 {
            self.record_rate_limit_hit("okx", None).await;
            self.log_api_call_async("okx", None, symbol, "error", elapsed_ms, None, None, Some("Rate limit exceeded"), Some(&url));
            return Err(AppError::ExternalApiError("OKX rate limit exceeded".to_string()));
        }

        if !response.status().is_success() {
            let error_msg = format!("OKX API error: {}", response.status());
            self.log_api_call_async("okx", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
            return Err(AppError::ExternalApiError(error_msg));
        }

        let data: serde_json::Value = response.json().await?;
        
        // OKX response format: { "code": "0", "data": [{ "last": "94123.5", ... }] }
        if let Some(code) = data.get("code").and_then(|c| c.as_str()) {
            if code != "0" {
                let msg = data.get("msg").and_then(|m| m.as_str()).unwrap_or("Unknown error");
                let error_msg = format!("OKX API error code {}: {}", code, msg);
                self.log_api_call_async("okx", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
                return Err(AppError::ExternalApiError(error_msg));
            }
        }
        let usd_price = data
            .get("data")
            .and_then(|d| d.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("last"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or_else(|| {
                let error_msg = format!("Could not parse OKX price for {}", symbol);
                self.log_api_call_async("okx", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
                AppError::ExternalApiError(error_msg)
            })?;

        // Log successful API call
        self.log_api_call_async("okx", None, symbol, "success", elapsed_ms, Some(usd_price), Some("USD"), None, Some(&url));

        // Return USD price since OKX transactions are in USD
        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price: usd_price,
            currency: "USD".to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch price from KuCoin API (returns USDT price)
    async fn fetch_kucoin_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        // Check rate limit first
        self.check_rate_limit("kucoin").await?;
        
        // KuCoin uses BTC-USDT format
        let pair = format!("{}-USDT", symbol.to_uppercase());
        let url = format!(
            "https://api.kucoin.com/api/v1/market/orderbook/level1?symbol={}",
            pair
        );

        tracing::info!("Fetching crypto price from KuCoin: {}", url);

        let start = Instant::now();

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;
        
        // Record the API call
        self.record_api_call("kucoin").await;
        
        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().as_u16() == 429 {
            self.record_rate_limit_hit("kucoin", None).await;
            self.log_api_call_async("kucoin", None, symbol, "error", elapsed_ms, None, None, Some("Rate limit exceeded"), Some(&url));
            return Err(AppError::ExternalApiError("KuCoin rate limit exceeded".to_string()));
        }
        
        if !response.status().is_success() {
            let error_msg = format!("KuCoin API error: {}", response.status());
            self.log_api_call_async("kucoin", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
            return Err(AppError::ExternalApiError(error_msg));
        }

        let data: serde_json::Value = response.json().await?;
        
        // KuCoin response format: { "code": "200000", "data": { "price": "91136", ... } }
        let usdt_price = data
            .get("data")
            .and_then(|d| d.get("price"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or_else(|| {
                let error_msg = format!("Could not parse KuCoin price for {}", symbol);
                self.log_api_call_async("kucoin", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
                AppError::ExternalApiError(error_msg)
            })?;

        // Log successful API call
        self.log_api_call_async("kucoin", None, symbol, "success", elapsed_ms, Some(usdt_price), Some("USDT"), None, Some(&url));

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price: usdt_price,
            currency: "USDT".to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch price from HTX (Huobi) API (returns USDT price)
    async fn fetch_htx_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        // Check rate limit first
        self.check_rate_limit("htx").await?;
        
        // HTX uses btcusdt format (lowercase)
        let pair = format!("{}usdt", symbol.to_lowercase());
        let url = format!(
            "https://api.huobi.pro/market/detail/merged?symbol={}",
            pair
        );

        tracing::info!("Fetching crypto price from HTX: {}", url);

        let start = Instant::now();

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;
        
        // Record the API call
        self.record_api_call("htx").await;
        
        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().as_u16() == 429 {
            self.record_rate_limit_hit("htx", None).await;
            self.log_api_call_async("htx", None, symbol, "error", elapsed_ms, None, None, Some("Rate limit exceeded"), Some(&url));
            return Err(AppError::ExternalApiError("HTX rate limit exceeded".to_string()));
        }
        
        if !response.status().is_success() {
            let error_msg = format!("HTX API error: {}", response.status());
            self.log_api_call_async("htx", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
            return Err(AppError::ExternalApiError(error_msg));
        }

        let data: serde_json::Value = response.json().await?;
        
        // HTX response format: { "status": "ok", "tick": { "close": 91116.86, ... } }
        let usdt_price = data
            .get("tick")
            .and_then(|t| t.get("close"))
            .and_then(|v| v.as_f64())
            .ok_or_else(|| {
                let error_msg = format!("Could not parse HTX price for {}", symbol);
                self.log_api_call_async("htx", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
                AppError::ExternalApiError(error_msg)
            })?;

        // Log successful API call
        self.log_api_call_async("htx", None, symbol, "success", elapsed_ms, Some(usdt_price), Some("USDT"), None, Some(&url));

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price: usdt_price,
            currency: "USDT".to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch cryptocurrency price from CoinGecko API
    async fn fetch_coingecko_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        // Check rate limit first - CoinGecko Free tier is very strict!
        self.check_rate_limit("coingecko").await?;
        
        let coin_id = self.get_coingecko_id(symbol);
        let url = format!(
            "{}/simple/price?ids={}&vs_currencies=thb,usd",
            self.config.coingecko_api_url,
            coin_id
        );

        tracing::info!("Fetching crypto price from CoinGecko: {}", url);

        let start = Instant::now();

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;
        
        // Record the API call
        self.record_api_call("coingecko").await;
        
        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().as_u16() == 429 {
            // CoinGecko rate limit - block for 60 seconds
            self.record_rate_limit_hit("coingecko", Some(60)).await;
            self.log_api_call_async("coingecko", None, symbol, "error", elapsed_ms, None, None, Some("Rate limit exceeded"), Some(&url));
            return Err(AppError::ExternalApiError("CoinGecko rate limit exceeded. Please wait 60 seconds.".to_string()));
        }
        
        if !response.status().is_success() {
            let error_msg = format!("CoinGecko API error: {}", response.status());
            self.log_api_call_async("coingecko", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
            return Err(AppError::ExternalApiError(error_msg));
        }

        let data: serde_json::Value = response.json().await?;
        
        let price = data
            .get(&coin_id)
            .and_then(|v| v.get("thb"))
            .and_then(|v| v.as_f64())
            .ok_or_else(|| {
                let error_msg = format!("Could not parse price for {}", symbol);
                self.log_api_call_async("coingecko", None, symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
                AppError::ExternalApiError(error_msg)
            })?;
        
        // Log successful API call
        self.log_api_call_async("coingecko", None, symbol, "success", elapsed_ms, Some(price), Some("THB"), None, Some(&url));

        Ok(PriceEntry {
            symbol: symbol.to_uppercase(),
            price,
            currency: "THB".to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch Thai stock price from Yahoo Finance API
    /// Uses symbol.BK format (e.g., PTT.BK, ADVANC.BK)
    async fn fetch_thai_stock_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        // Check rate limit first
        self.check_rate_limit("yahoo_finance").await?;
        
        // Determine if it's a stock or futures/derivatives
        let symbol_upper = symbol.to_uppercase();
        
        // TFEX symbols (Futures) - use mock prices as Yahoo doesn't have them
        if symbol_upper.starts_with("S50") || symbol_upper.starts_with("GF") || 
           symbol_upper.starts_with("GD") || symbol_upper.starts_with("SV") ||
           symbol_upper.starts_with("USD") || symbol_upper.starts_with("BRN") ||
           symbol_upper.starts_with("TSR") || symbol_upper.starts_with("BANK") ||
           symbol_upper.starts_with("ENRG") || symbol_upper.ends_with("H24") ||
           symbol_upper.ends_with("M24") || symbol_upper.ends_with("U24") ||
           symbol_upper.ends_with("Z24") || symbol_upper.ends_with("H25") ||
           symbol_upper.ends_with("M25") || symbol_upper.ends_with("U25") ||
           symbol_upper.ends_with("Z25") || symbol_upper.ends_with("H26") ||
           symbol_upper.ends_with("M26") {
            return self.fetch_tfex_mock_price(&symbol_upper).await;
        }
        
        // For SET stocks, use Yahoo Finance with .BK suffix
        let yahoo_symbol = format!("{}.BK", symbol_upper);
        let url = format!(
            "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval=1d&range=1d",
            yahoo_symbol
        );

        tracing::info!("Fetching Thai stock price from Yahoo Finance: {}", url);

        let start = Instant::now();

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .send()
            .await?;
        
        // Record the API call
        self.record_api_call("yahoo_finance").await;
        
        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().as_u16() == 429 {
            self.record_rate_limit_hit("yahoo_finance", Some(60)).await;
            self.log_api_call_async("yahoo_finance", Some("SET"), symbol, "error", elapsed_ms, None, None, Some("Rate limit exceeded"), Some(&url));
            return Err(AppError::ExternalApiError("Yahoo Finance rate limit exceeded".to_string()));
        }

        if !response.status().is_success() {
            let error_msg = format!("Yahoo Finance API failed for {}, using mock", symbol);
            tracing::warn!("{}", error_msg);
            self.log_api_call_async("yahoo_finance", Some("SET"), symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
            return self.fetch_tfex_mock_price(&symbol_upper).await;
        }

        let data: serde_json::Value = response.json().await?;
        
        // Yahoo Finance response format: chart.result[0].meta.regularMarketPrice
        let price = data
            .get("chart")
            .and_then(|c| c.get("result"))
            .and_then(|r| r.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("meta"))
            .and_then(|meta| meta.get("regularMarketPrice"))
            .and_then(|v| v.as_f64())
            .ok_or_else(|| {
                let error_msg = format!("Could not parse Yahoo Finance price for {}", symbol);
                tracing::warn!("{}", error_msg);
                self.log_api_call_async("yahoo_finance", Some("SET"), symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
                AppError::ExternalApiError(format!("Could not parse price for {}", symbol))
            })?;

        tracing::info!("Yahoo Finance price for {}: {} THB", symbol, price);
        
        // Log successful API call
        self.log_api_call_async("yahoo_finance", Some("SET"), symbol, "success", elapsed_ms, Some(price), Some("THB"), None, Some(&url));

        Ok(PriceEntry {
            symbol: symbol_upper,
            price,
            currency: "THB".to_string(),
            updated_at: Utc::now(),
        })
    }
    
    /// Fetch TFEX prices - tries Yahoo Finance first, then falls back to mock
    async fn fetch_tfex_mock_price(&self, symbol: &str) -> Result<PriceEntry, AppError> {
        // Try to fetch from Yahoo Finance first for supported symbols
        if let Some((yahoo_symbol, currency)) = self.get_tfex_yahoo_symbol(symbol) {
            if let Ok(entry) = self.fetch_yahoo_futures_price(symbol, &yahoo_symbol, currency).await {
                return Ok(entry);
            }
        }
        
        // Fallback to mock prices
        tracing::debug!("Using mock price for TFEX symbol: {}", symbol);
        
        // Mock prices for TFEX symbols
        let mock_prices: HashMap<&str, f64> = [
            // SET50 Index Futures
            ("S50", 925.00), 
            ("S50H24", 920.00), ("S50M24", 922.00), ("S50U24", 924.00), ("S50Z24", 926.00),
            ("S50H25", 925.00), ("S50M25", 927.00), ("S50U25", 929.00), ("S50Z25", 931.00),
            ("S50H26", 928.00), ("S50M26", 930.00), ("S50U26", 932.00), ("S50Z26", 934.00),
            // Gold Futures (10 Baht)
            ("GFH24", 35200.0), ("GFM24", 35300.0), ("GFU24", 35400.0), ("GFZ24", 35500.0),
            ("GFH25", 35600.0), ("GFM25", 35700.0), ("GFU25", 35800.0), ("GFZ25", 35900.0),
            ("GFH26", 36000.0), ("GFM26", 36100.0),
            // Gold-D (50 Baht)
            ("GDH24", 176000.0), ("GDM24", 176500.0), ("GDU24", 177000.0), ("GDZ24", 177500.0),
            ("GDH25", 178000.0), ("GDM25", 178500.0), ("GDU25", 179000.0), ("GDZ25", 179500.0),
            ("GDH26", 180000.0), ("GDM26", 180500.0),
            // Silver Futures
            ("SVH24", 955.0), ("SVM24", 960.0), ("SVU24", 965.0), ("SVZ24", 970.0),
            ("SVH25", 975.0), ("SVM25", 980.0), ("SVH26", 990.0),
            // USD Futures
            ("USDH24", 34.50), ("USDM24", 34.55), ("USDU24", 34.60), ("USDZ24", 34.65),
            ("USDH25", 34.70), ("USDM25", 34.75), ("USDU25", 34.80), ("USDZ25", 34.85),
            ("USDH26", 34.90), ("USDM26", 34.95),
            // Sector Futures
            ("BANKH24", 480.0), ("BANKM24", 482.0), ("ENRGH24", 1850.0), ("ENRGM24", 1855.0),
            // Brent Crude Oil Futures
            ("BRNH24", 2750.0), ("BRNM24", 2760.0), ("BRNU24", 2770.0), ("BRNZ24", 2780.0),
            ("BRNH25", 2790.0), ("BRNM25", 2800.0), ("BRNH26", 2820.0), ("BRNM26", 2830.0),
            // Rubber Futures
            ("TSRH24", 56.0), ("TSRM24", 56.5), ("TSRU24", 57.0), ("TSRZ24", 57.5),
            ("TSRH25", 58.0), ("TSRM25", 58.5),
        ].into_iter().collect();

        let price = mock_prices
            .get(symbol)
            .copied()
            .unwrap_or(100.0);

        Ok(PriceEntry {
            symbol: symbol.to_string(),
            price,
            currency: "THB".to_string(),
            updated_at: Utc::now(),
        })
    }
    
    /// Map TFEX symbols to Yahoo Finance symbols
    fn get_tfex_yahoo_symbol(&self, symbol: &str) -> Option<(String, &'static str)> {
        // Map TFEX symbols to Yahoo Finance equivalents
        match symbol {
            // SET50 Index/Futures - use SET50 Index
            s if s.starts_with("S50") => Some(("^SET50.BK".to_string(), "THB")),
            // Gold Futures - use international gold futures
            s if s.starts_with("GF") || s.starts_with("GD") => Some(("GC=F".to_string(), "USD")),
            // Silver Futures
            s if s.starts_with("SV") => Some(("SI=F".to_string(), "USD")),
            // Brent Crude Oil
            s if s.starts_with("BRN") => Some(("BZ=F".to_string(), "USD")),
            // USD/THB - no direct equivalent, fallback to mock
            _ => None,
        }
    }
    
    /// Fetch futures price from Yahoo Finance
    async fn fetch_yahoo_futures_price(
        &self, 
        original_symbol: &str,
        yahoo_symbol: &str, 
        currency: &str
    ) -> Result<PriceEntry, AppError> {
        self.check_rate_limit("yahoo_finance").await?;
        
        let url = format!(
            "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval=1d&range=1d",
            yahoo_symbol
        );

        tracing::info!("Fetching TFEX price from Yahoo Finance: {} -> {}", original_symbol, url);
        
        let start = Instant::now();

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .send()
            .await?;
        
        self.record_api_call("yahoo_finance").await;
        
        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().as_u16() == 429 {
            self.record_rate_limit_hit("yahoo_finance", Some(60)).await;
            self.log_api_call_async("yahoo_finance", Some("TFEX"), original_symbol, "error", elapsed_ms, None, None, Some("Rate limit exceeded"), Some(&url));
            return Err(AppError::ExternalApiError("Yahoo Finance rate limit exceeded".to_string()));
        }

        if !response.status().is_success() {
            let error_msg = format!("Yahoo Finance API error: {}", response.status());
            self.log_api_call_async("yahoo_finance", Some("TFEX"), original_symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
            return Err(AppError::ExternalApiError(error_msg));
        }

        let data: serde_json::Value = response.json().await?;
        
        let price = data
            .get("chart")
            .and_then(|c| c.get("result"))
            .and_then(|r| r.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("meta"))
            .and_then(|meta| meta.get("regularMarketPrice"))
            .and_then(|v| v.as_f64())
            .ok_or_else(|| {
                                let error_msg = format!("Could not parse price for {}", original_symbol);
                self.log_api_call_async("yahoo_finance", Some("TFEX"), original_symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
                AppError::ExternalApiError(error_msg)
            })?;

        tracing::info!("Yahoo Finance {} price for {}: {} {}", yahoo_symbol, original_symbol, price, currency);
        
        // Log successful API call
        self.log_api_call_async("yahoo_finance", Some("TFEX"), original_symbol, "success", elapsed_ms, Some(price), Some(currency), None, Some(&url));

        Ok(PriceEntry {
            symbol: original_symbol.to_string(),
            price,
            currency: currency.to_string(),
            updated_at: Utc::now(),
        })
    }

    /// Fetch foreign stock price from Yahoo Finance
    async fn fetch_foreign_stock_price(
        &self, 
        symbol: &str,
        market: Option<&Market>,
    ) -> Result<PriceEntry, AppError> {
        // Check rate limit first
        self.check_rate_limit("yahoo_finance").await?;
        
        let symbol_upper = symbol.to_uppercase();
        
        // Try Yahoo Finance first
        let url = format!(
            "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval=1d&range=1d",
            symbol_upper
        );

        tracing::info!("Fetching foreign stock price from Yahoo Finance: {}", url);
        
        let start = Instant::now();

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .send()
            .await?;
        
        // Record the API call
        self.record_api_call("yahoo_finance").await;
        
        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().as_u16() == 429 {
            self.record_rate_limit_hit("yahoo_finance", Some(60)).await;
            self.log_api_call_async("yahoo_finance", Some("Foreign"), symbol, "error", elapsed_ms, None, None, Some("Rate limit exceeded"), Some(&url));
            return Err(AppError::ExternalApiError("Yahoo Finance rate limit exceeded".to_string()));
        }

        if !response.status().is_success() {
            let error_msg = format!("Yahoo Finance API failed for {}, using mock", symbol);
            tracing::warn!("{}", error_msg);
            self.log_api_call_async("yahoo_finance", Some("Foreign"), symbol, "error", elapsed_ms, None, None, Some(&error_msg), Some(&url));
            return self.fetch_foreign_stock_mock(&symbol_upper, market);
        }

        let data: serde_json::Value = response.json().await?;
        
        // Yahoo Finance response format: chart.result[0].meta
        let meta = data
            .get("chart")
            .and_then(|c| c.get("result"))
            .and_then(|r| r.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("meta"));
            
        if let Some(meta) = meta {
            let price = meta.get("regularMarketPrice")
                .and_then(|v| v.as_f64());
            let currency = meta.get("currency")
                .and_then(|v| v.as_str())
                .unwrap_or("USD");
                
            if let Some(price) = price {
                tracing::info!("Yahoo Finance price for {}: {} {}", symbol, price, currency);
                
                // Log successful API call
                self.log_api_call_async("yahoo_finance", Some("Foreign"), symbol, "success", elapsed_ms, Some(price), Some(currency), None, Some(&url));
                
                return Ok(PriceEntry {
                    symbol: symbol_upper,
                    price,
                    currency: currency.to_string(),
                    updated_at: Utc::now(),
                });
            }
        }
        
        // Fallback to mock if parsing fails
        tracing::warn!("Could not parse Yahoo Finance response for {}, using mock", symbol);
        self.fetch_foreign_stock_mock(&symbol_upper, market)
    }
    
    /// Fallback mock prices for foreign stocks
    fn fetch_foreign_stock_mock(&self, symbol: &str, market: Option<&Market>) -> Result<PriceEntry, AppError> {
        tracing::debug!("Using mock price for foreign stock: {}", symbol);
        
        // Mock prices for popular stocks
        let mock_prices: HashMap<&str, (f64, &str)> = [
            ("AAPL", (175.50, "USD")), ("MSFT", (378.25, "USD")),
            ("GOOGL", (141.80, "USD")), ("NVDA", (495.00, "USD")),
            ("TSLA", (248.50, "USD")), ("META", (355.20, "USD")),
        ].into_iter().collect();

        let (price, currency) = mock_prices
            .get(symbol)
            .copied()
            .unwrap_or((100.0, market.map(|m| m.default_currency()).unwrap_or("USD")));

        Ok(PriceEntry {
            symbol: symbol.to_string(),
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
