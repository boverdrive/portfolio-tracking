use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;
use reqwest::Client;

use crate::config::Config;
use crate::models::{JobConfig, JobStatus, ApiStatusResult, ApiStatusCheckResult, AssetType, Market};
use crate::services::{PocketBaseClient, PriceService};

/// Job scheduler service for background tasks
#[derive(Clone)]
pub struct JobScheduler {
    #[allow(dead_code)]
    config: Config,
    http_client: Client,
    pb_client: PocketBaseClient,
    jobs: Arc<RwLock<HashMap<String, JobConfig>>>,
    pocketbase_url: String,
    price_service: PriceService,
}

impl JobScheduler {
    pub fn new(config: Config, pb_client: PocketBaseClient, price_service: PriceService) -> Self {
        let pocketbase_url = config.pocketbase_url.clone();
        Self {
            config,
            http_client: Client::new(),
            pb_client,
            jobs: Arc::new(RwLock::new(HashMap::new())),
            pocketbase_url,
            price_service,
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
                "price_fetch" => self.run_price_update_job().await,
                "portfolio_snapshot" => self.run_portfolio_snapshot_job().await,
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

    /// Run price update job - fetch latest prices for all assets in portfolio
    async fn run_price_update_job(&self) -> Result<serde_json::Value, String> {
        tracing::info!("🔄 Running price update job...");
        
        // Step 1: Get all unique assets from transactions
        // We need to query all transactions to find out what assets users hold
        // In a real app with many users, this should be optimized
        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/transactions/records?perPage=500&sort=-created", self.pocketbase_url);
        
        let req = self.http_client.get(&url);
        let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
        
        #[derive(serde::Deserialize)]
        struct TransactionMinimal {
            symbol: String,
            asset_type: String,
            market: Option<String>,
            currency: Option<String>,
        }
        
        #[derive(serde::Deserialize)]
        struct TxResponse {
            items: Vec<TransactionMinimal>,
        }
        
        let transactions: Vec<TransactionMinimal> = match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                resp.json::<TxResponse>().await
                    .map(|r| r.items)
                    .unwrap_or_default()
            }
            _ => {
                tracing::warn!("⚠️ Could not fetch transactions, trying symbols collection...");
                // Fallback: Try to get symbols from the 'symbols' collection if transactions fail
                let symbols_url = format!("{}/api/collections/symbols/records?perPage=500", self.pocketbase_url);
                #[derive(serde::Deserialize)]
                struct SymbolRecord {
                    symbol: String,
                    asset_type: String,
                    market: Option<String>,
                    currency: Option<String>,
                }
                #[derive(serde::Deserialize)]
                struct SymbolsResponse {
                    items: Vec<SymbolRecord>,
                }
                let req = self.http_client.get(&symbols_url);
                let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
                match req.send().await {
                    Ok(resp) if resp.status().is_success() => {
                        resp.json::<SymbolsResponse>().await
                            .map(|r| r.items.into_iter().map(|s| TransactionMinimal {
                                symbol: s.symbol,
                                asset_type: s.asset_type,
                                market: s.market,
                                currency: s.currency,
                            }).collect())
                            .unwrap_or_default()
                    }
                    Err(e) => {
                        tracing::error!("Failed to fetch symbols from transactions or symbols collection: {}", e);
                        Vec::new()
                    }
                    _ => {
                        tracing::error!("Failed to fetch symbols from transactions or symbols collection.");
                        Vec::new()
                    }
                }
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
        for (key, (asset_type_str, market_str, currency)) in unique_symbols.iter() {
            let symbol = key.split('-').next().unwrap_or("");
            
            // Parse enums
            let asset_type = match self.parse_asset_type(asset_type_str) {
                Ok(a) => a,
                Err(_) => {
                    tracing::warn!("⚠️ Unknown asset type: {}", asset_type_str);
                    continue;
                }
            };
            
            let market = market_str.as_ref()
                .map(|m| self.parse_market(m))
                .transpose()
                .unwrap_or(None);

            // Fetch price using PriceService directly
            match self.price_service.get_price(symbol, &asset_type, market.as_ref()).await {
                Ok(price_entry) => {
                    // Save or update price in PocketBase
                    let curr = currency.clone().unwrap_or_else(|| price_entry.currency.clone());
                    
                    // Check if price record exists
                    let filter = format!("symbol='{}' && asset_type='{}'", symbol, asset_type_str);
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
                        "asset_type": asset_type_str,
                        "price": price_entry.price,
                        "currency": curr,
                        "market": market_str,
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
                    
                    if let Ok(resp) = save_result {
                        if resp.status().is_success() {
                            fetched += 1;
                        } else {
                            errors += 1;
                            tracing::warn!("⚠️ Failed to save price for {}", symbol);
                        }
                    } else {
                        errors += 1;
                    }
                }
                Err(e) => {
                    errors += 1;
                    tracing::debug!("⚠️ Failed to fetch price for {}: {}", symbol, e);
                }
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

    fn parse_asset_type(&self, s: &str) -> Result<AssetType, String> {
        match s.to_lowercase().as_str() {
            "stock" => Ok(AssetType::Stock),
            "tfex" => Ok(AssetType::Tfex),
            "crypto" => Ok(AssetType::Crypto),
            "foreign_stock" | "foreignstock" => Ok(AssetType::ForeignStock),
            "gold" => Ok(AssetType::Gold),
            "commodity" => Ok(AssetType::Commodity),
            _ => Err(format!("Invalid asset type: {}", s)),
        }
    }

    fn parse_market(&self, s: &str) -> Result<Market, String> {
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
            _ => Err(format!("Invalid market: {}", s)),
        }
    }

    /// Run portfolio snapshot job - capture daily portfolio performance for all users
    async fn run_portfolio_snapshot_job(&self) -> Result<serde_json::Value, String> {
        tracing::info!("📸 Running portfolio snapshot job...");
        
        let token = self.pb_client.get_token().await;
        let today = Utc::now().format("%Y-%m-%d").to_string();
        
        // Step 1: Get all users
        let users_url = format!("{}/api/collections/users/records?perPage=500", self.pocketbase_url);
        
        #[derive(serde::Deserialize)]
        struct User {
            id: String,
        }
        
        #[derive(serde::Deserialize)]
        struct UsersResponse {
            items: Vec<User>,
        }
        
        let req = self.http_client.get(&users_url);
        let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
        
        let users: Vec<User> = match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                resp.json::<UsersResponse>().await
                    .map(|r| r.items)
                    .unwrap_or_default()
            }
            _ => {
                tracing::warn!("⚠️ Could not fetch users for snapshot");
                return Err("Failed to fetch users".to_string());
            }
        };
        
        tracing::info!("📊 Found {} users for snapshot", users.len());
        
        let mut created = 0;
        let mut updated = 0;
        let mut errors = 0;
        
        // Step 2: For each user, calculate portfolio and save snapshot
        for user in &users {
            match self.create_user_snapshot(&user.id, &today, &token).await {
                Ok(is_new) => {
                    if is_new { created += 1; } else { updated += 1; }
                }
                Err(e) => {
                    tracing::warn!("⚠️ Failed to create snapshot for user {}: {}", user.id, e);
                    errors += 1;
                }
            }
        }
        
        let result = serde_json::json!({
            "date": today,
            "users_processed": users.len(),
            "snapshots_created": created,
            "snapshots_updated": updated,
            "errors": errors
        });
        
        tracing::info!("✅ Portfolio snapshot complete: {} created, {} updated, {} errors", created, updated, errors);
        
        Ok(result)
    }

    /// Create snapshot for a single user
    async fn create_user_snapshot(&self, user_id: &str, date: &str, token: &str) -> Result<bool, String> {
        // Fetch transactions for user
        let tx_filter = format!("user_id='{}'", user_id);
        let tx_url = format!(
            "{}/api/collections/transactions/records?filter={}&perPage=500",
            self.pocketbase_url,
            urlencoding::encode(&tx_filter)
        );
        
        #[derive(serde::Deserialize, Clone)]
        struct Transaction {
            symbol: String,
            asset_type: String,
            market: Option<String>,
            action: String,
            quantity: f64,
            price: f64,
            fees: f64,
            #[allow(dead_code)]
            currency: Option<String>,
            #[allow(dead_code)]
            leverage: Option<f64>,
            #[allow(dead_code)]
            account_id: Option<String>,
        }
        
        #[derive(serde::Deserialize)]
        struct TxResponse {
            items: Vec<Transaction>,
        }
        
        let req = self.http_client.get(&tx_url);
        let req = if !token.is_empty() { req.header("Authorization", token) } else { req };
        
        let transactions: Vec<Transaction> = match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                resp.json::<TxResponse>().await
                    .map(|r| r.items)
                    .unwrap_or_default()
            }
            _ => return Ok(true), // No transactions, skip
        };
        
        if transactions.is_empty() {
            return Ok(true); // No transactions
        }
        
        // Calculate portfolio holdings
        let mut holdings: std::collections::HashMap<String, (f64, f64, f64, String, Option<String>)> = std::collections::HashMap::new();
        // Key: symbol:asset_type:market, Value: (quantity, total_cost, avg_cost, asset_type, market)
        
        for tx in &transactions {
            let market_key = tx.market.clone().unwrap_or_default();
            let key = format!("{}:{}:{}", tx.symbol, tx.asset_type, market_key);
            
            let entry = holdings.entry(key.clone()).or_insert((0.0, 0.0, 0.0, tx.asset_type.clone(), tx.market.clone()));
            
            match tx.action.as_str() {
                "buy" | "long" => {
                    let cost = tx.quantity * tx.price + tx.fees;
                    let new_qty = entry.0 + tx.quantity;
                    let new_cost = entry.1 + cost;
                    entry.2 = if new_qty > 0.0 { new_cost / new_qty } else { tx.price };
                    entry.0 = new_qty;
                    entry.1 = new_cost;
                }
                "sell" | "close_long" => {
                    entry.0 -= tx.quantity;
                    if entry.0 > 0.0 {
                        entry.1 = entry.0 * entry.2;
                    } else {
                        entry.1 = 0.0;
                    }
                }
                "short" => {
                    entry.0 -= tx.quantity;
                    entry.1 += tx.quantity * tx.price;
                    entry.2 = tx.price;
                }
                "close_short" => {
                    entry.0 += tx.quantity;
                    if entry.0 < 0.0 {
                        entry.1 = entry.0.abs() * entry.2;
                    } else {
                        entry.1 = 0.0;
                    }
                }
                _ => {}
            }
        }
        
        // Fetch current prices and build assets array
        let mut assets_json: Vec<serde_json::Value> = Vec::new();
        let mut total_invested = 0.0;
        let mut total_current_value = 0.0;
        let mut total_unrealized_pnl = 0.0;
        
        for (key, (quantity, _total_cost, avg_cost, asset_type, market)) in &holdings {
            if quantity.abs() < 0.00000001 {
                continue;
            }
            
            let symbol = key.split(':').next().unwrap_or("");
            
            // Try to fetch price from asset_prices collection
            let price_filter = format!("symbol='{}' && asset_type='{}'", symbol, asset_type);
            let price_url = format!(
                "{}/api/collections/asset_prices/records?filter={}",
                self.pocketbase_url,
                urlencoding::encode(&price_filter)
            );
            
            let req = self.http_client.get(&price_url);
            let req = if !token.is_empty() { req.header("Authorization", token) } else { req };
            
            let current_price: f64 = match req.send().await {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(data) = resp.json::<serde_json::Value>().await {
                        if let Some(items) = data.get("items").and_then(|i| i.as_array()) {
                            if let Some(first) = items.first() {
                                first.get("price").and_then(|p| p.as_f64()).unwrap_or(*avg_cost)
                            } else { *avg_cost }
                        } else { *avg_cost }
                    } else { *avg_cost }
                }
                _ => *avg_cost
            };
            
            let current_value = quantity.abs() * current_price;
            let cost_basis = quantity.abs() * avg_cost;
            let unrealized_pnl = if *quantity > 0.0 {
                current_value - cost_basis
            } else {
                cost_basis - current_value // Short position
            };
            let pnl_percent = if cost_basis > 0.0 { (unrealized_pnl / cost_basis) * 100.0 } else { 0.0 };
            
            total_invested += cost_basis;
            total_current_value += current_value;
            total_unrealized_pnl += unrealized_pnl;
            
            let mut asset_obj = serde_json::json!({
                "symbol": symbol,
                "asset_type": asset_type,
                "quantity": quantity,
                "avg_cost": avg_cost,
                "current_price": current_price,
                "current_value": current_value,
                "unrealized_pnl": unrealized_pnl,
                "unrealized_pnl_percent": pnl_percent
            });
            
            if let Some(m) = market {
                asset_obj["market"] = serde_json::json!(m);
            }
            
            assets_json.push(asset_obj);
        }
        
        let pnl_percent = if total_invested > 0.0 { (total_unrealized_pnl / total_invested) * 100.0 } else { 0.0 };
        
        // Check if snapshot for today already exists
        let snapshot_filter = format!("user_id='{}' && date~'{}'", user_id, date);
        let check_url = format!(
            "{}/api/collections/portfolio_snapshots/records?filter={}",
            self.pocketbase_url,
            urlencoding::encode(&snapshot_filter)
        );
        
        let req = self.http_client.get(&check_url);
        let req = if !token.is_empty() { req.header("Authorization", token) } else { req };
        
        let existing_id: Option<String> = match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    if let Some(items) = data.get("items").and_then(|i| i.as_array()) {
                        items.first().and_then(|i| i.get("id")).and_then(|i| i.as_str()).map(String::from)
                    } else { None }
                } else { None }
            }
            _ => None
        };
        
        // Build snapshot payload
        let payload = serde_json::json!({
            "user_id": user_id,
            "date": format!("{} 00:00:00.000Z", date),
            "total_invested": total_invested,
            "total_current_value": total_current_value,
            "total_unrealized_pnl": total_unrealized_pnl,
            "total_unrealized_pnl_percent": pnl_percent,
            "total_realized_pnl": 0.0, // TODO: Calculate from closed positions
            "assets_count": assets_json.len(),
            "currency": "THB",
            "assets": assets_json
        });
        
        // Create or update snapshot
        let is_new = existing_id.is_none();
        
        let result = if let Some(id) = existing_id {
            let update_url = format!("{}/api/collections/portfolio_snapshots/records/{}", self.pocketbase_url, id);
            let req = self.http_client.patch(&update_url);
            let req = if !token.is_empty() { req.header("Authorization", token) } else { req };
            req.json(&payload).send().await
        } else {
            let create_url = format!("{}/api/collections/portfolio_snapshots/records", self.pocketbase_url);
            let req = self.http_client.post(&create_url);
            let req = if !token.is_empty() { req.header("Authorization", token) } else { req };
            req.json(&payload).send().await
        };
        
        match result {
            Ok(resp) if resp.status().is_success() => Ok(is_new),
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                Err(format!("HTTP {}: {}", status, body))
            }
            Err(e) => Err(e.to_string())
        }
    }
}
