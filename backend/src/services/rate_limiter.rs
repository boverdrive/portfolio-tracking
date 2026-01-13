use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::services::pocketbase::PocketBaseClient;

/// Rate limit configuration for an API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitConfig {
    #[serde(default)]
    pub id: String,
    pub api_name: String,
    #[serde(default = "default_rpm")]
    pub requests_per_minute: i32,
    #[serde(default)]
    pub requests_per_day: Option<i32>,
    #[serde(default)]
    pub current_minute_count: i32,
    #[serde(default)]
    pub current_day_count: i32,
    #[serde(default)]
    pub minute_reset_at: Option<String>,
    #[serde(default)]
    pub requests_per_hour: Option<i32>,
    #[serde(default)]
    pub current_hour_count: i32,
    #[serde(default)]
    pub hour_reset_at: Option<String>,
    #[serde(default)]
    pub day_reset_at: Option<String>,
    #[serde(default)]
    pub last_request_at: Option<String>,
    #[serde(default)]
    pub is_blocked: bool,
    #[serde(default)]
    pub blocked_until: Option<String>,
    // PocketBase fields
    #[serde(default, skip_serializing)]
    pub created: Option<String>,
    #[serde(default, skip_serializing)]
    pub updated: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

fn default_rpm() -> i32 { 30 }

/// Rate limiter service
#[derive(Clone)]
pub struct RateLimiter {
    pb_client: PocketBaseClient,
    pocketbase_url: String,
    http_client: reqwest::Client,
    // In-memory cache for fast lookups
    cache: Arc<RwLock<HashMap<String, RateLimitConfig>>>,
}

#[derive(Debug, Deserialize)]
struct PocketBaseResponse {
    items: Vec<RateLimitConfig>,
}

impl RateLimiter {
    pub fn new(pb_client: PocketBaseClient, pocketbase_url: String) -> Self {
        Self {
            pb_client,
            pocketbase_url,
            http_client: reqwest::Client::new(),
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Initialize rate limits - load from PocketBase
    pub async fn initialize(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        tracing::info!("🚦 Initializing rate limiter...");
        
        let url = format!("{}/api/collections/api_rate_limits/records?perPage=100", self.pocketbase_url);
        let token = self.pb_client.get_token().await;
        
        let req = self.http_client.get(&url);
        let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
        
        match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<PocketBaseResponse>().await {
                    let mut cache = self.cache.write().await;
                    for config in data.items {
                        tracing::info!("📊 Loaded rate limit for {}: {}/min", config.api_name, config.requests_per_minute);
                        cache.insert(config.api_name.clone(), config);
                    }
                }
            }
            Ok(resp) => {
                tracing::warn!("⚠️ Could not load rate limits: HTTP {}", resp.status());
            }
            Err(e) => {
                tracing::warn!("⚠️ Could not load rate limits: {}", e);
            }
        }
        
        // Always check and seed defaults (upsert missing)
        self.seed_defaults().await?;
        
        Ok(())
    }

    /// Seed default rate limits
    async fn seed_defaults(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let defaults = vec![
            ("coingecko", 10, Some(10000), None),  // CoinGecko Free tier: very conservative
            ("bitkub", 100, None, None),
            ("binance", 120, None, None),
            ("okx", 60, None, None),
            ("kucoin", 100, None, None),           // KuCoin: ~100 req/min for public API
            ("htx", 100, None, None),               // HTX (Huobi): ~100 req/min
            ("yahoo_finance", 60, Some(2000), None),
            ("thaigold", 60, None, Some(10)),       // Thai Gold: 10 req/hour
        ];
        
        let token = self.pb_client.get_token().await;
        
        // Read cache to see what's missing
        let cache_read = self.cache.read().await;
        let existing_keys: Vec<String> = cache_read.keys().cloned().collect();
        drop(cache_read);

        for (api_name, rpm, rpd, rph) in defaults {
            if existing_keys.contains(&api_name.to_string()) {
                continue;
            }

            tracing::info!("🌱 Seeding missing rate limit for {}", api_name);

            let now = Utc::now();
            let minute_reset = now + Duration::minutes(1);
            let hour_reset = now + Duration::hours(1);
            let day_reset = now + Duration::days(1);
            
            let config = serde_json::json!({
                "api_name": api_name,
                "requests_per_minute": rpm,
                "requests_per_hour": rph,
                "requests_per_day": rpd,
                "current_minute_count": 0,
                "current_hour_count": 0,
                "current_day_count": 0,
                "minute_reset_at": minute_reset.to_rfc3339(),
                "hour_reset_at": hour_reset.to_rfc3339(),
                "day_reset_at": day_reset.to_rfc3339(),
                "is_blocked": false
            });
            
            let url = format!("{}/api/collections/api_rate_limits/records", self.pocketbase_url);
            let req = self.http_client.post(&url);
            let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
            
            match req.json(&config).send().await {
                Ok(resp) if resp.status().is_success() => {
                    // Parse response to get the record ID
                    let record_id = if let Ok(data) = resp.json::<serde_json::Value>().await {
                        data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string()
                    } else {
                        String::new()
                    };
                    
                    tracing::info!("✅ Seeded rate limit for {} (id: {})", api_name, record_id);
                    
                    // Add to cache with the actual ID
                    let mut cache = self.cache.write().await;
                    cache.insert(api_name.to_string(), RateLimitConfig {
                        id: record_id,
                        api_name: api_name.to_string(),
                        requests_per_minute: rpm,
                        requests_per_day: rpd,
                        current_minute_count: 0,
                        current_hour_count: 0,
                        current_day_count: 0,
                        requests_per_hour: rph,
                        minute_reset_at: Some(minute_reset.to_rfc3339()),
                        hour_reset_at: Some(hour_reset.to_rfc3339()),
                        day_reset_at: Some(day_reset.to_rfc3339()),
                        last_request_at: None,
                        is_blocked: false,
                        blocked_until: None,
                        created: None,
                        updated: None,
                        extra: HashMap::new(),
                    });
                }
                Ok(resp) => {
                    let body = resp.text().await.unwrap_or_default();
                    tracing::warn!("⚠️ Could not seed rate limit for {}: {}", api_name, body);
                }
                Err(e) => {
                    tracing::warn!("⚠️ Could not seed rate limit for {}: {}", api_name, e);
                }
            }
        }
        
        Ok(())
    }

    /// Check if we can make a request to this API
    pub async fn can_request(&self, api_name: &str) -> bool {
        let mut cache = self.cache.write().await;
        
        if let Some(config) = cache.get_mut(api_name) {
            let now = Utc::now();
            
            // Check if blocked
            if config.is_blocked {
                if let Some(blocked_until) = &config.blocked_until {
                    if let Ok(until) = DateTime::parse_from_rfc3339(blocked_until) {
                        if now < until.with_timezone(&Utc) {
                            tracing::warn!("🚫 {} is blocked until {}", api_name, blocked_until);
                            return false;
                        }
                        // Unblock
                        config.is_blocked = false;
                        config.blocked_until = None;
                    }
                }
            }
            
            // Reset minute counter if needed
            if let Some(reset_at) = &config.minute_reset_at {
                if let Ok(reset) = DateTime::parse_from_rfc3339(reset_at) {
                    if now >= reset.with_timezone(&Utc) {
                        config.current_minute_count = 0;
                        config.minute_reset_at = Some((now + Duration::minutes(1)).to_rfc3339());
                    }
                }
            }
            

            
            // Reset hour counter if needed
            if let Some(reset_at) = &config.hour_reset_at {
                if let Ok(reset) = DateTime::parse_from_rfc3339(reset_at) {
                    if now >= reset.with_timezone(&Utc) {
                        config.current_hour_count = 0;
                        config.hour_reset_at = Some((now + Duration::hours(1)).to_rfc3339());
                    }
                }
            }
            
            // Reset day counter if needed
            if let Some(reset_at) = &config.day_reset_at {
                if let Ok(reset) = DateTime::parse_from_rfc3339(reset_at) {
                    if now >= reset.with_timezone(&Utc) {
                        config.current_day_count = 0;
                        config.day_reset_at = Some((now + Duration::days(1)).to_rfc3339());
                    }
                }
            }
            
            // Check minute limit
            if config.current_minute_count >= config.requests_per_minute {
                tracing::warn!("⚠️ {} rate limit reached: {}/{} per minute", 
                    api_name, config.current_minute_count, config.requests_per_minute);
                return false;
            }
            
            // Check hour limit
            if let Some(hour_limit) = config.requests_per_hour {
                if hour_limit > 0 && config.current_hour_count >= hour_limit {
                    tracing::warn!("⚠️ {} hourly limit reached: {}/{}", 
                        api_name, config.current_hour_count, hour_limit);
                    return false;
                }
            }
            
            
            // Check day limit (0 means unlimited)
            if let Some(day_limit) = config.requests_per_day {
                if day_limit > 0 && config.current_day_count >= day_limit {
                    tracing::warn!("⚠️ {} daily limit reached: {}/{}", 
                        api_name, config.current_day_count, day_limit);
                    return false;
                }
            }
            
            true
        } else {
            // Unknown API - allow but log warning
            tracing::warn!("⚠️ Unknown API for rate limiting: {}", api_name);
            true
        }
    }

    /// Record that a request was made
    pub async fn record_request(&self, api_name: &str) {
        let mut cache = self.cache.write().await;
        
        if let Some(config) = cache.get_mut(api_name) {
            let now = Utc::now();
            config.current_minute_count += 1;
            config.current_hour_count += 1;
            config.current_day_count += 1;
            config.last_request_at = Some(now.to_rfc3339());
            
            // Update in PocketBase (fire and forget)
            if !config.id.is_empty() {
                let url = format!("{}/api/collections/api_rate_limits/records/{}", self.pocketbase_url, config.id);
                let token = self.pb_client.get_token().await;
                let update = serde_json::json!({
                    "current_minute_count": config.current_minute_count,
                    "current_hour_count": config.current_hour_count,
                    "current_day_count": config.current_day_count,
                    "last_request_at": config.last_request_at,
                    "minute_reset_at": config.minute_reset_at,
                    "hour_reset_at": config.hour_reset_at,
                    "day_reset_at": config.day_reset_at
                });
                
                let http_client = self.http_client.clone();
                tokio::spawn(async move {
                    let req = http_client.patch(&url);
                    let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
                    let _ = req.json(&update).send().await;
                });
            }
            
            tracing::debug!("📊 {} request recorded: {}/{} this minute", 
                api_name, config.current_minute_count, config.requests_per_minute);
        }
    }

    /// Record that we hit a rate limit (e.g., got 429 response)
    pub async fn record_rate_limit_hit(&self, api_name: &str, retry_after_secs: Option<u64>) {
        let mut cache = self.cache.write().await;
        
        if let Some(config) = cache.get_mut(api_name) {
            let now = Utc::now();
            let block_duration = retry_after_secs.unwrap_or(60);
            let blocked_until = now + Duration::seconds(block_duration as i64);
            
            config.is_blocked = true;
            config.blocked_until = Some(blocked_until.to_rfc3339());
            
            tracing::warn!("🚫 {} blocked for {} seconds due to rate limit", api_name, block_duration);
            
            // Update in PocketBase
            if !config.id.is_empty() {
                let url = format!("{}/api/collections/api_rate_limits/records/{}", self.pocketbase_url, config.id);
                let token = self.pb_client.get_token().await;
                let update = serde_json::json!({
                    "is_blocked": true,
                    "blocked_until": config.blocked_until
                });
                
                let http_client = self.http_client.clone();
                tokio::spawn(async move {
                    let req = http_client.patch(&url);
                    let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
                    let _ = req.json(&update).send().await;
                });
            }
        }
    }

    /// Get all rate limit statuses
    pub async fn get_all_limits(&self) -> Vec<RateLimitConfig> {
        let cache = self.cache.read().await;
        cache.values().cloned().collect()
    }

    /// Get rate limit status for a specific API
    pub async fn get_limit(&self, api_name: &str) -> Option<RateLimitConfig> {
        let cache = self.cache.read().await;
        cache.get(api_name).cloned()
    }
}
