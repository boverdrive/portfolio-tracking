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
        let mock_rates = self.get_mock_forex_rates();
        
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

    /// Mock forex rates (1 unit = X USD)
    fn get_mock_forex_rates(&self) -> HashMap<String, f64> {
        [
            ("USD", 1.0),
            ("USDT", 1.0),        // 1 USDT = 1 USD (stablecoin)
            ("THB", 0.028),      // 1 THB = 0.028 USD (35 THB = 1 USD)
            ("EUR", 1.08),       // 1 EUR = 1.08 USD
            ("GBP", 1.27),       // 1 GBP = 1.27 USD
            ("JPY", 0.0067),     // 1 JPY = 0.0067 USD
            ("HKD", 0.128),      // 1 HKD = 0.128 USD
            ("SGD", 0.74),       // 1 SGD = 0.74 USD
            ("XAU", 2650.0),     // 1 oz Gold = 2650 USD
        ].into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect()
    }

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
