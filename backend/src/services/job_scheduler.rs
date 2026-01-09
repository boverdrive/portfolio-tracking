use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;
use reqwest::Client;

use crate::config::Config;
use crate::models::{JobConfig, JobStatus, ApiStatusResult, ApiStatusCheckResult};
use crate::services::PocketBaseClient;

/// Job scheduler service for background tasks
#[derive(Clone)]
pub struct JobScheduler {
    config: Config,
    http_client: Client,
    pb_client: PocketBaseClient,
    // In-memory job registry (synced with PocketBase)
    jobs: Arc<RwLock<HashMap<String, JobConfig>>>,
    // PocketBase URL for job storage
    pocketbase_url: String,
}

impl JobScheduler {
    pub fn new(config: Config, pb_client: PocketBaseClient) -> Self {
        let pocketbase_url = config.pocketbase_url.clone();
        Self {
            config,
            http_client: Client::new(),
            pb_client,
            jobs: Arc::new(RwLock::new(HashMap::new())),
            pocketbase_url,
        }
    }

    /// Initialize job scheduler - load jobs from PocketBase and create defaults if needed
    pub async fn initialize(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        tracing::info!("📋 Initializing job scheduler...");
        
        // Try to load jobs from PocketBase
        match self.load_jobs_from_db().await {
            Ok(jobs) => {
                if jobs.is_empty() {
                    tracing::info!("📝 No jobs found in database, creating default job...");
                    self.ensure_default_job().await;
                } else {
                    let mut job_map = self.jobs.write().await;
                    for job in jobs {
                        job_map.insert(job.id.clone(), job);
                    }
                    tracing::info!("✅ Loaded {} jobs from database", job_map.len());
                }
            }
            Err(e) => {
                tracing::warn!("⚠️ Could not load jobs from database: {}.", e);
                tracing::info!("📝 Using in-memory default job instead.");
                self.ensure_default_job().await;
            }
        }
        
        Ok(())
    }

    /// Ensure default job exists (in-memory or database)
    async fn ensure_default_job(&self) {
        let mut default_job = JobConfig::default();
        default_job.id = "api_check_01".to_string(); // PocketBase max 15 chars
        let next_run = Utc::now() + chrono::Duration::seconds(default_job.interval_seconds as i64);
        default_job.next_run = Some(next_run.to_rfc3339());
        
        // Try to create in database first
        match self.create_job_in_db(&default_job).await {
            Ok(created_job) => {
                tracing::info!("✅ Created default job in database: {}", created_job.id);
                let mut job_map = self.jobs.write().await;
                job_map.insert(created_job.id.clone(), created_job);
            }
            Err(e) => {
                tracing::warn!("⚠️ Could not create job in database: {}. Using in-memory job.", e);
                // Use in-memory job as fallback
                let mut job_map = self.jobs.write().await;
                job_map.insert(default_job.id.clone(), default_job);
                tracing::info!("✅ Created in-memory default job");
            }
        }
    }

    /// Load jobs from PocketBase
    async fn load_jobs_from_db(&self) -> Result<Vec<JobConfig>, Box<dyn std::error::Error + Send + Sync>> {
        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/jobs/records", self.pocketbase_url);
        
        let req = self.http_client.get(&url);
        let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
        let response = req.send().await?;
        
        if !response.status().is_success() {
            return Err(format!("Failed to load jobs: {}", response.status()).into());
        }
        
        #[derive(serde::Deserialize)]
        struct PocketBaseResponse {
            items: Vec<JobConfig>,
        }
        
        let data: PocketBaseResponse = response.json().await?;
        Ok(data.items)
    }

    /// Create a job in PocketBase
    async fn create_job_in_db(&self, job: &JobConfig) -> Result<JobConfig, Box<dyn std::error::Error + Send + Sync>> {
        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/jobs/records", self.pocketbase_url);
        
        // Don't send 'id' field - let PocketBase auto-generate it
        let payload = serde_json::json!({
            "name": job.name,
            "name_en": job.name_en,
            "job_type": job.job_type,
            "interval_seconds": job.interval_seconds,
            "enabled": job.enabled,
            "status": job.status,
            "last_run": job.last_run,
            "next_run": job.next_run,
            "last_result": job.last_result
        });
        
        let req = self.http_client.post(&url);
        let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
        let response = req.json(&payload).send().await?;
        
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Failed to create job: {} - {}", status, body).into());
        }
        
        let created: JobConfig = response.json().await?;
        Ok(created)
    }

    /// Update a job in PocketBase
    async fn update_job_in_db(&self, job: &JobConfig) -> Result<JobConfig, Box<dyn std::error::Error + Send + Sync>> {
        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/jobs/records/{}", self.pocketbase_url, job.id);
        
        let req = self.http_client.patch(&url);
        let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
        let response = req.json(job).send().await?;
        
        if !response.status().is_success() {
            return Err(format!("Failed to update job: {}", response.status()).into());
        }
        
        let updated: JobConfig = response.json().await?;
        Ok(updated)
    }

    /// Get all jobs
    pub async fn get_jobs(&self) -> Vec<JobConfig> {
        let jobs = self.jobs.read().await;
        jobs.values().cloned().collect()
    }

    /// Get a specific job
    pub async fn get_job(&self, id: &str) -> Option<JobConfig> {
        let jobs = self.jobs.read().await;
        jobs.get(id).cloned()
    }

    /// Update job configuration
    pub async fn update_job(&self, id: &str, interval_seconds: Option<u64>, enabled: Option<bool>) -> Result<JobConfig, String> {
        let mut jobs = self.jobs.write().await;
        
        if let Some(job) = jobs.get_mut(id) {
            if let Some(interval) = interval_seconds {
                job.interval_seconds = interval;
            }
            if let Some(enabled_val) = enabled {
                job.enabled = enabled_val;
                if !enabled_val {
                    job.status = JobStatus::Disabled;
                } else if job.status == JobStatus::Disabled {
                    job.status = JobStatus::Idle;
                }
            }
            
            // Calculate next run time
            if job.enabled {
                let next_run = Utc::now() + chrono::Duration::seconds(job.interval_seconds as i64);
                job.next_run = Some(next_run.to_rfc3339());
            } else {
                job.next_run = None;
            }
            
            // Update in database
            let job_clone = job.clone();
            drop(jobs); // Release lock before async call
            
            match self.update_job_in_db(&job_clone).await {
                Ok(updated) => {
                    let mut jobs = self.jobs.write().await;
                    jobs.insert(id.to_string(), updated.clone());
                    Ok(updated)
                }
                Err(e) => Err(e.to_string())
            }
        } else {
            Err("Job not found".to_string())
        }
    }

    /// Run a job immediately
    pub async fn run_job_now(&self, id: &str) -> Result<serde_json::Value, String> {
        let job = {
            let jobs = self.jobs.read().await;
            jobs.get(id).cloned()
        };

        if let Some(mut job) = job {
            // Update status to running
            job.status = JobStatus::Running;
            {
                let mut jobs = self.jobs.write().await;
                jobs.insert(id.to_string(), job.clone());
            }

            // Execute the job based on type
            let result = match job.job_type.as_str() {
                "api_status_check" => self.run_api_status_check().await,
                "price_fetch" => self.run_price_fetch_job().await,
                _ => Err(format!("Unknown job type: {}", job.job_type)),
            };

            // Update status based on result
            let now = Utc::now();
            let mut jobs = self.jobs.write().await;
            if let Some(job) = jobs.get_mut(id) {
                job.last_run = Some(now.to_rfc3339());
                let next_run = now + chrono::Duration::seconds(job.interval_seconds as i64);
                job.next_run = Some(next_run.to_rfc3339());
                
                match &result {
                    Ok(res) => {
                        job.status = JobStatus::Success;
                        job.last_result = Some(res.clone());
                    }
                    Err(e) => {
                        job.status = JobStatus::Failed;
                        job.last_result = Some(serde_json::json!({ "error": e }));
                    }
                }
                
                // Update in database (fire and forget)
                let job_clone = job.clone();
                let self_clone = self.clone();
                tokio::spawn(async move {
                    let _ = self_clone.update_job_in_db(&job_clone).await;
                });
            }

            result
        } else {
            Err("Job not found".to_string())
        }
    }

    /// Run API status check job
    async fn run_api_status_check(&self) -> Result<serde_json::Value, String> {
        tracing::info!("🔍 Running API status check job...");
        
        // Get markets from frontend settings or database
        // For now, we'll use predefined price sources
        let price_sources = vec![
            ("set", "ตลาดหลักทรัพย์", "https://marketdata.set.or.th"),
            ("nyse", "NYSE", "https://query1.finance.yahoo.com"),
            ("nasdaq", "NASDAQ", "https://query1.finance.yahoo.com"),
            ("binance", "Binance", "https://api.coingecko.com"),
            ("bitkub", "Bitkub", "https://api.bitkub.com"),
            ("goldapi", "Gold API", "https://www.goldapi.io"),
            ("goldtraders", "Thai Gold", "https://www.goldtraders.or.th"),
        ];

        let mut results = Vec::new();
        let mut online_count = 0;
        let mut offline_count = 0;

        for (market_id, market_name, url) in price_sources {
            let start = std::time::Instant::now();
            
            let status_result = match self.http_client
                .head(url)
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await
            {
                Ok(response) => {
                    let response_time = start.elapsed().as_millis() as u64;
                    if response.status().is_success() || response.status().as_u16() == 403 || response.status().as_u16() == 401 {
                        // 403/401 means the server is up but requires auth
                        online_count += 1;
                        ApiStatusResult {
                            market_id: market_id.to_string(),
                            market_name: market_name.to_string(),
                            url: url.to_string(),
                            status: "online".to_string(),
                            response_time_ms: Some(response_time),
                            error_message: None,
                        }
                    } else {
                        offline_count += 1;
                        ApiStatusResult {
                            market_id: market_id.to_string(),
                            market_name: market_name.to_string(),
                            url: url.to_string(),
                            status: "offline".to_string(),
                            response_time_ms: Some(response_time),
                            error_message: Some(format!("HTTP {}", response.status())),
                        }
                    }
                }
                Err(e) => {
                    offline_count += 1;
                    ApiStatusResult {
                        market_id: market_id.to_string(),
                        market_name: market_name.to_string(),
                        url: url.to_string(),
                        status: "offline".to_string(),
                        response_time_ms: None,
                        error_message: Some(e.to_string()),
                    }
                }
            };
            
            results.push(status_result);
        }

        let check_result = ApiStatusCheckResult {
            total_checked: results.len(),
            online_count,
            offline_count,
            results,
        };

        tracing::info!("✅ API status check complete: {}/{} online", online_count, check_result.total_checked);
        
        Ok(serde_json::to_value(check_result).unwrap())
    }

    /// Run price fetch job - fetch prices for all unique symbols and store in PocketBase
    async fn run_price_fetch_job(&self) -> Result<serde_json::Value, String> {
        tracing::info!("💰 Running price fetch job...");
        
        let token = self.pb_client.get_token().await;
        
        // Step 1: Get unique symbols from transactions
        let transactions_url = format!("{}/api/collections/transactions/records?perPage=500", self.pocketbase_url);
        
        #[derive(serde::Deserialize)]
        struct Transaction {
            symbol: String,
            asset_type: String,
            market: Option<String>,
            currency: Option<String>,
        }
        
        #[derive(serde::Deserialize)]
        struct TransactionsResponse {
            items: Vec<Transaction>,
        }
        
        let req = self.http_client.get(&transactions_url);
        let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
        
        let transactions: Vec<Transaction> = match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                resp.json::<TransactionsResponse>().await
                    .map(|r| r.items)
                    .unwrap_or_default()
            }
            _ => {
                tracing::warn!("⚠️ Could not fetch transactions, trying symbols collection...");
                Vec::new()
            }
        };
        
        // Collect unique symbols
        let mut unique_symbols: std::collections::HashMap<String, (String, Option<String>, Option<String>)> = std::collections::HashMap::new();
        for tx in transactions {
            let key = format!("{}-{}", tx.symbol, tx.asset_type);
            if !unique_symbols.contains_key(&key) {
                unique_symbols.insert(key, (tx.asset_type, tx.market, tx.currency));
            }
        }
        
        tracing::info!("📊 Found {} unique symbols to fetch prices for", unique_symbols.len());
        
        let mut fetched = 0;
        let mut errors = 0;
        let now = Utc::now().to_rfc3339();
        
        // Step 2: Fetch price for each symbol and save to PocketBase
        for (key, (asset_type, market, currency)) in unique_symbols.iter() {
            let symbol = key.split('-').next().unwrap_or("");
            
            // Build price API URL
            let market_param = market.as_ref().map(|m| format!("&market={}", m)).unwrap_or_default();
            let price_url = format!(
                "http://localhost:3001/api/prices/{}?asset_type={}{}",
                symbol, asset_type, market_param
            );
            
            // Fetch price
            let price_result = self.http_client.get(&price_url).send().await;
            
            if let Ok(resp) = price_result {
                if resp.status().is_success() {
                    if let Ok(data) = resp.json::<serde_json::Value>().await {
                        if let Some(price) = data.get("price").and_then(|p| p.as_f64()) {
                            // Save or update price in PocketBase
                            let curr = currency.clone().unwrap_or_else(|| "THB".to_string());
                            
                            // Check if price record exists
                            let filter = format!("symbol='{}' && asset_type='{}'", symbol, asset_type);
                            let check_url = format!(
                                "{}/api/collections/asset_prices/records?filter={}",
                                self.pocketbase_url,
                                urlencoding::encode(&filter)
                            );
                            
                            let req = self.http_client.get(&check_url);
                            let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
                            let existing = req.send().await;
                            
                            let payload = serde_json::json!({
                                "symbol": symbol,
                                "asset_type": asset_type,
                                "price": price,
                                "currency": curr,
                                "market": market,
                                "last_updated": now.clone()
                            });
                            
                            let save_result = if let Ok(resp) = existing {
                                if let Ok(data) = resp.json::<serde_json::Value>().await {
                                    if let Some(items) = data.get("items").and_then(|i| i.as_array()) {
                                        if let Some(first) = items.first() {
                                            if let Some(id) = first.get("id").and_then(|i| i.as_str()) {
                                                // Update existing
                                                let update_url = format!(
                                                    "{}/api/collections/asset_prices/records/{}",
                                                    self.pocketbase_url, id
                                                );
                                                let req = self.http_client.patch(&update_url);
                                                let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
                                                req.json(&payload).send().await
                                            } else {
                                                // Create new
                                                let create_url = format!("{}/api/collections/asset_prices/records", self.pocketbase_url);
                                                let req = self.http_client.post(&create_url);
                                                let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
                                                req.json(&payload).send().await
                                            }
                                        } else {
                                            // Create new
                                            let create_url = format!("{}/api/collections/asset_prices/records", self.pocketbase_url);
                                            let req = self.http_client.post(&create_url);
                                            let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
                                            req.json(&payload).send().await
                                        }
                                    } else {
                                        // Create new
                                        let create_url = format!("{}/api/collections/asset_prices/records", self.pocketbase_url);
                                        let req = self.http_client.post(&create_url);
                                        let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
                                        req.json(&payload).send().await
                                    }
                                } else {
                                    // Create new
                                    let create_url = format!("{}/api/collections/asset_prices/records", self.pocketbase_url);
                                    let req = self.http_client.post(&create_url);
                                    let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
                                    req.json(&payload).send().await
                                }
                            } else {
                                // Create new
                                let create_url = format!("{}/api/collections/asset_prices/records", self.pocketbase_url);
                                let req = self.http_client.post(&create_url);
                                let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
                                req.json(&payload).send().await
                            };
                            
                            if save_result.is_ok() {
                                fetched += 1;
                                tracing::debug!("✅ Saved price for {}: {}", symbol, price);
                            }
                        }
                    }
                } else {
                    errors += 1;
                    tracing::debug!("⚠️ Failed to fetch price for {}", symbol);
                }
            } else {
                errors += 1;
            }
        }
        
        let result = serde_json::json!({
            "total_symbols": unique_symbols.len(),
            "fetched": fetched,
            "errors": errors,
            "last_updated": now
        });
        
        tracing::info!("✅ Price fetch complete: {}/{} prices updated", fetched, unique_symbols.len());
        
        Ok(result)
    }
}
