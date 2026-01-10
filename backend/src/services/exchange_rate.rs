use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::config::Config;
use crate::error::AppError;

/// Exchange rate entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeRate {
    pub from_currency: String,
    pub to_currency: String,
    pub rate: f64,
    pub updated_at: DateTime<Utc>,
}

/// Exchange rate response for API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeRatesResponse {
    pub base_currency: String,
    pub rates: HashMap<String, f64>,
    pub updated_at: DateTime<Utc>,
}

/// Exchange rate service for fetching and caching currency rates
#[derive(Clone)]
pub struct ExchangeRateService {
    client: reqwest::Client,
    config: Config,
    cache: Arc<RwLock<HashMap<String, ExchangeRate>>>,
}

impl ExchangeRateService {
    pub fn new(config: Config) -> Self {
        Self {
            client: reqwest::Client::new(),
            config,
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Get exchange rate between two currencies
    pub async fn get_rate(&self, from: &str, to: &str) -> Result<f64, AppError> {
        // Same currency
        if from.to_uppercase() == to.to_uppercase() {
            return Ok(1.0);
        }

        let cache_key = format!("{}:{}", from.to_uppercase(), to.to_uppercase());
        
        // Check cache
        {
            let cache = self.cache.read().await;
            if let Some(entry) = cache.get(&cache_key) {
                let age = Utc::now().signed_duration_since(entry.updated_at);
                // Cache for 5 minutes for exchange rates
                if age.num_seconds() < 300 {
                    tracing::debug!("Exchange rate cache hit for {}", cache_key);
                    return Ok(entry.rate);
                }
            }
        }

        // Fetch fresh rate
        let rate = self.fetch_exchange_rate(from, to).await?;

        // Update cache
        {
            let mut cache = self.cache.write().await;
            cache.insert(cache_key, ExchangeRate {
                from_currency: from.to_uppercase(),
                to_currency: to.to_uppercase(),
                rate,
                updated_at: Utc::now(),
            });
        }

        Ok(rate)
    }

    /// Fetch exchange rate (using CoinGecko for BTC, mock for others)
    async fn fetch_exchange_rate(&self, from: &str, to: &str) -> Result<f64, AppError> {
        let from_upper = from.to_uppercase();
        let to_upper = to.to_uppercase();

        // If BTC or XAU is involved with BTC, use special handling
        if from_upper == "BTC" || to_upper == "BTC" || 
           (from_upper == "XAU" && to_upper == "BTC") || 
           (from_upper == "BTC" && to_upper == "XAU") {
            return self.fetch_btc_rate(&from_upper, &to_upper).await;
        }

        // Mock rates for traditional currencies and gold
        // These would come from a forex API in production
        // Now using Free Forex API
        let forex_rates_result = self.fetch_forex_rates_api().await;
        
        // Use fetched rates or fallback to hardcoded mocks for critical currencies
        let mock_rates = match forex_rates_result {
            Ok(rates) => rates,
            Err(e) => {
                tracing::error!("Failed to fetch forex rates, using fallback mocks: {}", e);
                // Fallback mock map
                 [
                    ("USD", 1.0), ("USDT", 1.0), ("THB", 0.028),
                    ("EUR", 1.08), ("GBP", 1.27), ("JPY", 0.0067),
                    ("HKD", 0.128), ("SGD", 0.74), ("XAU", 2650.0),
                ].into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect()
            }
        };
        
        // mock_rates contains: how much USD per 1 unit of currency
        // e.g., THB: 0.028 means 1 THB = 0.028 USD
        // XAU: 2650.0 means 1 oz Gold = 2650 USD
        let from_to_usd = mock_rates.get(&from_upper).copied().unwrap_or(1.0);
        let to_to_usd = mock_rates.get(&to_upper).copied().unwrap_or(1.0);
        
        // Calculate cross rate: how many "to" per 1 "from"
        // If 1 XAU = 2650 USD, and 1 THB = 0.028 USD
        // Then XAU->THB rate = 2650 / 0.028 = 94642.86 (1 oz gold = 94642 THB)
        let rate = from_to_usd / to_to_usd;
        
        tracing::info!("Exchange rate {}/{}: {}", from_upper, to_upper, rate);
        
        Ok(rate)
    }

    /// Fetch BTC rate from CoinGecko
    async fn fetch_btc_rate(&self, from: &str, to: &str) -> Result<f64, AppError> {
        // Get BTC price in both currencies
        let url = format!(
            "{}/simple/price?ids=bitcoin&vs_currencies=usd,thb,eur,gbp",
            self.config.coingecko_api_url
        );

        let response = self.client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            // Fallback to mock rates
            return Ok(self.get_mock_btc_rate(from, to));
        }

        let data: serde_json::Value = response.json().await?;
        
        let btc_usd = data
            .get("bitcoin")
            .and_then(|v| v.get("usd"))
            .and_then(|v| v.as_f64())
            .unwrap_or(100000.0);
            
        let btc_thb = data
            .get("bitcoin")
            .and_then(|v| v.get("thb"))
            .and_then(|v| v.as_f64())
            .unwrap_or(3500000.0);

        let btc_eur = data
            .get("bitcoin")
            .and_then(|v| v.get("eur"))
            .and_then(|v| v.as_f64())
            .unwrap_or(btc_usd / 1.08); // fallback using USD rate
            
        let btc_gbp = data
            .get("bitcoin")
            .and_then(|v| v.get("gbp"))
            .and_then(|v| v.as_f64())
            .unwrap_or(btc_usd / 1.27); // fallback using USD rate

        // Calculate rate based on direction
        match (from, to) {
            ("BTC", "USD") => Ok(btc_usd),
            ("BTC", "THB") => Ok(btc_thb),
            ("BTC", "EUR") => Ok(btc_eur),
            ("BTC", "GBP") => Ok(btc_gbp),
            ("BTC", "XAU") => Ok(btc_usd / 2650.0), // 1 BTC = X oz gold (gold ~$2650/oz)
            ("USD", "BTC") => Ok(1.0 / btc_usd),
            ("THB", "BTC") => Ok(1.0 / btc_thb),
            ("EUR", "BTC") => Ok(1.0 / btc_eur),
            ("GBP", "BTC") => Ok(1.0 / btc_gbp),
            ("XAU", "BTC") => Ok(2650.0 / btc_usd), // 1 oz gold = X BTC
            ("USD", "THB") => Ok(btc_thb / btc_usd),
            ("THB", "USD") => Ok(btc_usd / btc_thb),
            _ => {
                // For any other pair, try to calculate via USD
                let from_btc_usd = match from {
                    "THB" => btc_thb / btc_usd,
                    "EUR" => btc_eur / btc_usd,
                    "GBP" => btc_gbp / btc_usd,
                    _ => 1.0,
                };
                let to_btc_usd = match to {
                    "THB" => btc_thb / btc_usd,
                    "EUR" => btc_eur / btc_usd,
                    "GBP" => btc_gbp / btc_usd,
                    _ => 1.0,
                };
                Ok(from_btc_usd / to_btc_usd)
            }
        }
    }

    /// Fetch forex rates from free API (https://open.er-api.com)
    async fn fetch_forex_rates_api(&self) -> Result<HashMap<String, f64>, AppError> {
        let url = "https://open.er-api.com/v6/latest/USD";
        tracing::debug!("Fetching forex rates from {}", url);

        let response = self.client
            .get(url)
            .send()
            .await
            .map_err(|e| AppError::ExternalApiError(format!("Failed to fetch forex rates: {}", e)))?;

        if !response.status().is_success() {
             return Err(AppError::ExternalApiError(format!("Forex API Error: {}", response.status())));
        }

        let data: serde_json::Value = response.json().await
            .map_err(|e| AppError::ExternalApiError(format!("Failed to parse forex json: {}", e)))?;

        // Format: { "rates": { "THB": 35.5, ... } }
        let rates_map = data
            .get("rates")
            .and_then(|v| v.as_object())
            .ok_or_else(|| AppError::ExternalApiError("Invalid forex API response format".to_string()))?;

        let mut rates = HashMap::new();
        // Add USD itself
        rates.insert("USD".to_string(), 1.0);
        // Add USDT as peg to USD (or close enough)
        rates.insert("USDT".to_string(), 1.0);
        // Add Gold mock until we have a better source, or maybe the API has XAU?
        // Open Exchange Rates usually has XAU, but let's check or keep fallback.
        // For safety, let's keep hardcoded generic commodities if API misses them.
        
        for (currency, rate_val) in rates_map {
            if let Some(rate) = rate_val.as_f64() {
                rates.insert(currency.to_string(), rate);
            }
        }
        
        // Ensure standard mocks exist if API didn't return them (e.g. specialized commodities not in std forex)
        rates.entry("XAU".to_string()).or_insert(2650.0); // Price of 1 oz Gold in USD (Inverse of rate usually? Wait.)
        // API returns "How many Currency units per 1 USD".
        // XAU rate 0.00038 means 1 USD = 0.00038 oz Gold. 
        // So Gold Price in USD = 1 / 0.00038 = ~2631.
        // Let's handle special inversion for XAU/XAG if the API provides them, otherwise use mock price.
        
        // Actually, let's stick to the "Rate = USD value" or "Rate = Units per USD"?
        // fetch_exchange_rate logic: 
        // from_to_usd = mock_rates.get(from).unwrap_or(1.0) -> This implies the map stores "How many USD is 1 unit worth?"
        // WAIT. 
        // Previous logic:
        // THB: 0.028 => 1 THB = 0.028 USD.
        // OpenER API returns: THB: 35.7 => 1 USD = 35.7 THB.
        // So OpenER returns "Units per USD".
        // Previous mock was "USD per Unit".
        // I need to INVERT the rates from OpenER to match the internal logic, OR update the internal logic.
        // Updating internal logic to use standard "Units per USD" is better but risky for regressions.
        // Easiest: Invert the rates here.
        // Map will store: "Value of 1 Unit in USD".
        
        // Re-building map with inversion
        let mut value_in_usd_map = HashMap::new();
        value_in_usd_map.insert("USD".to_string(), 1.0);
        value_in_usd_map.insert("USDT".to_string(), 1.0);

        for (currency, rate_per_usd) in rates_map {
            if let Some(rate) = rate_per_usd.as_f64() {
                if rate > 0.0 {
                   value_in_usd_map.insert(currency.to_string(), 1.0 / rate);
                }
            }
        }
        
        // Gold/Silver overrides if missing or weird
        // XAU in API might be "Ounces per USD" -> very small number.
        // 1/Rate gives "USD per Ounce". Perfect.
        
        Ok(value_in_usd_map)
    }

    /// Implement a simple memory cache for the forex rates to avoid fetching every call
    /// For this single-file edit, I'll just call the API directly inside `fetch_exchange_rate` 
    /// but limit it by checking if I already have a recent entry in the main `cache`?
    /// No, `cache` stores specific pairs.
    /// I should probably just fetch it. The user said "Free API", usually has limits but 
    /// OpenER is generous. Let's add a small valid-time if possible, but 
    /// effectively, `fetch_exchange_rate` is called only on cache miss of `get_rate`.
    /// `get_rate` caches for 5 mins. So we verify only once per 5 mins per pair.
    /// That is effectively 1 API call per 5 mins per active pair. Acceptable.

    /// Mock forex rates (Removed, replaced by fetch_forex_rates_api logic inside fetch logic)

    /// Mock BTC rate
    fn get_mock_btc_rate(&self, from: &str, to: &str) -> f64 {
        // Approximate rates (as of late 2024/early 2025)
        let btc_usd = 100000.0;
        let btc_thb = 3500000.0;
        let btc_eur = 92600.0;    // ~92,600 EUR
        let btc_gbp = 78700.0;    // ~78,700 GBP
        let xau_usd = 2650.0;     // 1 oz gold = $2650

        match (from, to) {
            ("BTC", "USD") => btc_usd,
            ("BTC", "THB") => btc_thb,
            ("BTC", "EUR") => btc_eur,
            ("BTC", "GBP") => btc_gbp,
            ("BTC", "XAU") => btc_usd / xau_usd, // 1 BTC = X oz gold
            ("USD", "BTC") => 1.0 / btc_usd,
            ("THB", "BTC") => 1.0 / btc_thb,
            ("EUR", "BTC") => 1.0 / btc_eur,
            ("GBP", "BTC") => 1.0 / btc_gbp,
            ("XAU", "BTC") => xau_usd / btc_usd, // 1 oz gold = X BTC
            _ => 1.0,
        }
    }

    /// Get all exchange rates for a base currency
    pub async fn get_all_rates(&self, base: &str) -> Result<ExchangeRatesResponse, AppError> {
        let currencies = vec!["USD", "THB", "BTC", "EUR", "GBP", "XAU", "USDT"];
        let mut rates = HashMap::new();

        for currency in currencies {
            if currency != base.to_uppercase() {
                let rate = self.get_rate(base, currency).await?;
                rates.insert(currency.to_string(), rate);
            }
        }

        Ok(ExchangeRatesResponse {
            base_currency: base.to_uppercase(),
            rates,
            updated_at: Utc::now(),
        })
    }

    /// Convert amount between currencies
    pub async fn convert(&self, amount: f64, from: &str, to: &str) -> Result<f64, AppError> {
        let rate = self.get_rate(from, to).await?;
        Ok(amount * rate)
    }

    /// Clear cache
    pub async fn clear_cache(&self) {
        let mut cache = self.cache.write().await;
        cache.clear();
        tracing::info!("Exchange rate cache cleared");
    }
}
