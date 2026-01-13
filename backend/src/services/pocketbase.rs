use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use crate::config::Config;
use crate::error::AppError;
use crate::models::{Transaction, CreateTransactionRequest, UpdateTransactionRequest, Account, CreateAccountRequest, UpdateAccountRequest};

/// PocketBase client for database operations
/// Syncs data to PocketBase API with in-memory cache for performance
#[derive(Clone)]
pub struct PocketBaseClient {
    pocketbase_url: String,
    client: reqwest::Client,
    // In-memory cache
    transactions: Arc<RwLock<HashMap<String, Transaction>>>,
    accounts: Arc<RwLock<HashMap<String, Account>>>,
    // Track if initial load is done
    loaded_transactions: Arc<RwLock<bool>>,
    loaded_accounts: Arc<RwLock<bool>>,
    // Admin token
    token: Arc<RwLock<Option<String>>>,
    config: Config,
}

#[derive(Debug, Deserialize)]
struct AdminAuthResponse {
    token: String,
    #[allow(dead_code)]
    admin: Option<AdminData>,
}

#[derive(Debug, Deserialize)]
struct AdminData {
    #[allow(dead_code)]
    id: String,
    #[allow(dead_code)]
    email: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PBListResponse<T> {
    page: u32,
    #[serde(rename = "perPage")]
    per_page: u32,
    #[serde(rename = "totalItems")]
    total_items: u32,
    #[serde(rename = "totalPages")]
    total_pages: u32,
    items: Vec<T>,
}

impl PocketBaseClient {
    pub fn new(config: Config) -> Self {
        Self {
            pocketbase_url: config.pocketbase_url.clone(),
            client: reqwest::Client::new(),
            transactions: Arc::new(RwLock::new(HashMap::new())),
            accounts: Arc::new(RwLock::new(HashMap::new())),
            loaded_transactions: Arc::new(RwLock::new(false)),
            loaded_accounts: Arc::new(RwLock::new(false)),
            token: Arc::new(RwLock::new(None)),
            config,
        }
    }

    /// Authenticate as Admin to PocketBase
    async fn authenticate(&self) -> Result<String, AppError> {
        let email = self.config.pb_admin_email.as_deref().unwrap_or("");
        let password = self.config.pb_admin_password.as_deref().unwrap_or("");

        if email.is_empty() {
             tracing::warn!("⚠️ POCKETBASE_ADMIN_EMAIL not set. Skipping admin authentication.");
             return Ok("".to_string());
        }

        let url = format!("{}/api/collections/_superusers/auth-with-password", self.pocketbase_url);

        let body = serde_json::json!({
            "identity": email,
            "password": password,
        });

        match self.client.post(&url).json(&body).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    let data = resp.json::<AdminAuthResponse>().await
                        .map_err(|e| AppError::Internal(format!("Failed to parse admin auth response: {}", e)))?;
                    
                    tracing::info!("🔐 Authenticated as Admin to PocketBase");
                    
                    let mut token_lock = self.token.write().await;
                    *token_lock = Some(data.token.clone());
                    
                    Ok(data.token)
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    tracing::error!("❌ Failed to authenticate as Admin: {} - {}", status, body);
                    Err(AppError::Unauthorized("Failed to authenticate as Admin".to_string()))
                }
            }
            Err(e) => {
                tracing::error!("❌ Could not connect to PocketBase for auth: {}", e);
                Err(AppError::Internal(format!("PocketBase auth connection error: {}", e)))
            }
        }
    }

    /// Get valid admin token (authenticates if needed)
    pub async fn get_token(&self) -> String {
        // optimistically read
        {
            let token = self.token.read().await;
            if let Some(t) = &*token {
                return t.clone();
            }
        }
        
        // if no token, authenticate
        match self.authenticate().await {
            Ok(t) => t,
            Err(_) => "".to_string(), // Return empty string if auth fails (fallback to public/guest)
        }
    }

    // ==================== Transaction Operations ====================

    /// Load transactions from PocketBase (called once on first access)
    async fn load_transactions_from_pb(&self) -> Result<(), AppError> {
        let loaded = *self.loaded_transactions.read().await;
        if loaded {
            return Ok(());
        }

        let token = self.get_token().await;
        let url = format!("{}/api/collections/transactions/records?perPage=500", self.pocketbase_url);
        
        let request = self.client.get(&url);
        let request = if !token.is_empty() {
            request.header("Authorization", token)
        } else {
            request
        };
        
        match request.send().await {
            Ok(response) => {
                if response.status().is_success() {
                    let body_text = response.text().await.unwrap_or_default();
                    // tracing::info!("📦 Raw PB Response: {}", body_text); // Uncomment for full debug

                    match serde_json::from_str::<PBListResponse<Transaction>>(&body_text) {
                        Ok(data) => {
                            let mut cache = self.transactions.write().await;
                            if !data.items.is_empty() {
                                tracing::info!("🔍 Sample transaction ID: {}, User ID: {}", data.items[0].id, data.items[0].user_id);
                            }

                            for tx in data.items {
                                cache.insert(tx.id.clone(), tx);
                            }
                            tracing::info!("📦 Loaded {} transactions from PocketBase", cache.len());
                            *self.loaded_transactions.write().await = true;
                        },
                        Err(e) => {
                             tracing::error!("❌ Failed to deserialize transactions: {}", e);
                             tracing::error!("📄 Response Body: {}", body_text);
                        }
                    }
                } else {
                    tracing::warn!("⚠️ Could not load transactions from PocketBase: {}", response.status());
                }
            }
            Err(e) => {
                tracing::warn!("⚠️ Could not connect to PocketBase: {}", e);
            }
        }

        Ok(())
    }

    /// Create a new transaction for a specific user
    pub async fn create_transaction(
        &self,
        req: CreateTransactionRequest,
        user_id: &str,
    ) -> Result<Transaction, AppError> {
        let transaction = Transaction::new_with_user(req, user_id.to_string());
        
        // Save to cache
        {
            let mut cache = self.transactions.write().await;
            cache.insert(transaction.id.clone(), transaction.clone());
        }

        // Sync to PocketBase (async, don't block)
        let url = format!("{}/api/collections/transactions/records", self.pocketbase_url);
        let tx_clone = transaction.clone();
        let client = self.client.clone();
        
        // Need to get token before spawning if we want to use it, 
        // OR spawn a task that gets the token. 
        // Since get_token is async and needs self, better to get it here or clone self.
        let me = self.clone();
        
        tokio::spawn(async move {
            let token = me.get_token().await;
            tracing::info!("🔄 Syncing transaction to PocketBase: {}", tx_clone.id);
            
            let req = client.post(&url);
            let req = if !token.is_empty() { req.header("Authorization", token) } else { req };
            
            match req.json(&tx_clone).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        tracing::info!("✅ Transaction synced to PocketBase: {}", tx_clone.id);
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        tracing::warn!("⚠️ Failed to sync transaction: {} - {}", status, body);
                    }
                }
                Err(e) => tracing::warn!("⚠️ Could not sync transaction: {}", e),
            }
        });
        
        tracing::info!("Created transaction: {} for user: {}", transaction.id, user_id);
        Ok(transaction)
    }

    /// Get all transactions for a specific user
    pub async fn list_transactions(&self, user_id: &str) -> Result<Vec<Transaction>, AppError> {
        // Ensure data is loaded from PocketBase
        self.load_transactions_from_pb().await?;
        
        let cache = self.transactions.read().await;
        let mut list: Vec<Transaction> = cache
            .values()
            .filter(|t| {
                 let match_user = t.user_id == user_id;
                 if !match_user {
                     // tracing::debug!("Skipping transaction {} for user {} (want {})", t.id, t.user_id, user_id);
                 }
                 match_user
            })
            .cloned()
            .collect();
        
        tracing::info!("👤 User {} has {} transactions (out of {} total)", user_id, list.len(), cache.len());
        
        // Sort by timestamp descending (newest first)
        list.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        
        Ok(list)
    }

    /// Get a transaction by ID
    pub async fn get_transaction(&self, id: &str) -> Result<Transaction, AppError> {
        self.load_transactions_from_pb().await?;
        
        let cache = self.transactions.read().await;
        cache
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Transaction {} not found", id)))
    }

    /// Update a transaction
    pub async fn update_transaction(
        &self,
        id: &str,
        req: UpdateTransactionRequest,
    ) -> Result<Transaction, AppError> {
        let mut cache = self.transactions.write().await;
        
        let transaction = cache
            .get_mut(id)
            .ok_or_else(|| AppError::NotFound(format!("Transaction {} not found", id)))?;

        // Apply updates
        if let Some(asset_type) = req.asset_type {
            transaction.asset_type = asset_type;
        }
        if let Some(symbol) = req.symbol {
            transaction.symbol = symbol.to_uppercase();
        }
        if let Some(symbol_name) = req.symbol_name {
            transaction.symbol_name = Some(symbol_name);
        }
        if let Some(action) = req.action {
            transaction.action = action;
        }
        if let Some(quantity) = req.quantity {
            transaction.quantity = quantity;
        }
        if let Some(price) = req.price {
            transaction.price = price;
        }
        if let Some(fees) = req.fees {
            transaction.fees = fees;
        }
        if let Some(currency) = req.currency {
            transaction.currency = Some(currency);
        }
        if let Some(timestamp) = req.timestamp {
            transaction.timestamp = timestamp;
        }
        if let Some(notes) = req.notes {
            transaction.notes = Some(notes);
        }
        if let Some(account_id) = req.account_id {
            transaction.account_id = Some(account_id);
        }
        if let Some(tags) = req.tags {
            transaction.tags = tags;
        }
        if let Some(initial_margin) = req.initial_margin {
            transaction.initial_margin = Some(initial_margin);
        }
        
        transaction.updated_at = Utc::now();
        let updated = transaction.clone();

        // Sync to PocketBase
        let url = format!("{}/api/collections/transactions/records/{}", self.pocketbase_url, id);
        let tx_clone = updated.clone();
        let client = self.client.clone();
        let me = self.clone();
        
        tokio::spawn(async move {
            let token = me.get_token().await;
            
            let req = client.patch(&url);
            let req = if !token.is_empty() { req.header("Authorization", token) } else { req };
            
            match req.json(&tx_clone).send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        tracing::warn!("⚠️ Failed to sync transaction update: {}", resp.status());
                    }
                }
                Err(e) => tracing::warn!("⚠️ Could not sync transaction update: {}", e),
            }
        });
        
        tracing::info!("Updated transaction: {}", id);
        Ok(updated)
    }

    /// Delete a transaction
    pub async fn delete_transaction(&self, id: &str) -> Result<(), AppError> {
        let mut cache = self.transactions.write().await;
        
        if cache.remove(id).is_none() {
            return Err(AppError::NotFound(format!("Transaction {} not found", id)));
        }

        // Sync to PocketBase
        let url = format!("{}/api/collections/transactions/records/{}", self.pocketbase_url, id);
        let client = self.client.clone();
        let me = self.clone();
        
        tokio::spawn(async move {
            let token = me.get_token().await;
            
            let req = client.delete(&url);
            let req = if !token.is_empty() { req.header("Authorization", token) } else { req };
            
            match req.send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        tracing::warn!("⚠️ Failed to sync transaction delete: {}", resp.status());
                    }
                }
                Err(e) => tracing::warn!("⚠️ Could not sync transaction delete: {}", e),
            }
        });
        
        tracing::info!("Deleted transaction: {}", id);
        Ok(())
    }

    /// Get transactions filtered by asset type
    pub async fn get_transactions_by_type(
        &self,
        asset_type: &crate::models::AssetType,
    ) -> Result<Vec<Transaction>, AppError> {
        self.load_transactions_from_pb().await?;
        
        let cache = self.transactions.read().await;
        let filtered: Vec<Transaction> = cache
            .values()
            .filter(|t| t.asset_type == *asset_type)
            .cloned()
            .collect();
        
        Ok(filtered)
    }

    /// Get transactions for a specific symbol
    pub async fn get_transactions_by_symbol(
        &self,
        symbol: &str,
    ) -> Result<Vec<Transaction>, AppError> {
        self.load_transactions_from_pb().await?;
        
        let cache = self.transactions.read().await;
        let symbol_upper = symbol.to_uppercase();
        
        let filtered: Vec<Transaction> = cache
            .values()
            .filter(|t| t.symbol == symbol_upper)
            .cloned()
            .collect();
        
        Ok(filtered)
    }

    // ==================== Account Operations ====================

    /// Load accounts from PocketBase (called once on first access)
    async fn load_accounts_from_pb(&self) -> Result<(), AppError> {
        let loaded = *self.loaded_accounts.read().await;
        if loaded {
            return Ok(());
        }

        let token = self.get_token().await;
        let url = format!("{}/api/collections/accounts/records?perPage=500", self.pocketbase_url);
        
        let request = self.client.get(&url);
        let request = if !token.is_empty() {
            request.header("Authorization", token)
        } else {
            request
        };
        
        match request.send().await {
            Ok(response) => {
                if response.status().is_success() {
                    if let Ok(data) = response.json::<PBListResponse<Account>>().await {
                        let mut cache = self.accounts.write().await;
                        for account in data.items {
                            cache.insert(account.id.clone(), account);
                        }
                        tracing::info!("📦 Loaded {} accounts from PocketBase", cache.len());
                    }
                } else {
                    tracing::warn!("⚠️ Could not load accounts from PocketBase: {}", response.status());
                }
            }
            Err(e) => {
                tracing::warn!("⚠️ Could not connect to PocketBase for accounts: {}", e);
            }
        }

        *self.loaded_accounts.write().await = true;
        Ok(())
    }

    /// Create a new account for a specific user
    pub async fn create_account(
        &self,
        req: CreateAccountRequest,
        user_id: &str,
    ) -> Result<Account, AppError> {
        let account = Account::new_with_user(req, user_id.to_string());
        
        // Save to cache
        {
            let mut cache = self.accounts.write().await;
            cache.insert(account.id.clone(), account.clone());
        }

        // Sync to PocketBase
        let url = format!("{}/api/collections/accounts/records", self.pocketbase_url);
        let acc_clone = account.clone();
        let client = self.client.clone();
        let me = self.clone();
        
        tokio::spawn(async move {
            let token = me.get_token().await;
            tracing::info!("🔄 Syncing account to PocketBase: {}", acc_clone.id);
            
            let req = client.post(&url);
            let req = if !token.is_empty() { req.header("Authorization", token) } else { req };
            
            match req.json(&acc_clone).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        tracing::info!("✅ Account synced to PocketBase: {}", acc_clone.id);
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        tracing::warn!("⚠️ Failed to sync account: {} - {}", status, body);
                    }
                }
                Err(e) => tracing::warn!("⚠️ Could not sync account: {}", e),
            }
        });
        
        tracing::info!("Created account: {} for user: {}", account.id, user_id);
        Ok(account)
    }

    /// Get all accounts for a specific user
    pub async fn list_accounts(&self, user_id: &str) -> Result<Vec<Account>, AppError> {
        self.load_accounts_from_pb().await?;
        
        let cache = self.accounts.read().await;
        let mut list: Vec<Account> = cache
            .values()
            .filter(|a| a.user_id == user_id)
            .cloned()
            .collect();
        
        // Sort by rank ascending, then created_at descending (newest first)
        list.sort_by(|a, b| {
            a.rank.cmp(&b.rank).then(b.created_at.cmp(&a.created_at))
        });
        
        Ok(list)
    }

    /// Get an account by ID
    pub async fn get_account(&self, id: &str) -> Result<Account, AppError> {
        self.load_accounts_from_pb().await?;
        
        let cache = self.accounts.read().await;
        cache
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Account {} not found", id)))
    }

    /// Update an account
    pub async fn update_account(
        &self,
        id: &str,
        req: UpdateAccountRequest,
    ) -> Result<Account, AppError> {
        let mut cache = self.accounts.write().await;
        
        let account = cache
            .get_mut(id)
            .ok_or_else(|| AppError::NotFound(format!("Account {} not found", id)))?;

        // Apply updates
        if let Some(name) = req.name {
            account.name = name;
        }
        if let Some(description) = req.description {
            account.description = Some(description);
        }
        if let Some(color) = req.color {
            account.color = Some(color);
        }
        if let Some(target_value) = req.target_value {
            account.target_value = Some(target_value);
        }
        if let Some(target_currency) = req.target_currency {
            account.target_currency = target_currency;
        }
        if let Some(rank) = req.rank {
            account.rank = rank;
        }
        
        account.updated_at = Utc::now();
        let updated = account.clone();

        // Sync to PocketBase
        let url = format!("{}/api/collections/accounts/records/{}", self.pocketbase_url, id);
        let acc_clone = updated.clone();
        let client = self.client.clone();
        let me = self.clone();
        
        tokio::spawn(async move {
            let token = me.get_token().await;
            
            let req = client.patch(&url);
            let req = if !token.is_empty() { req.header("Authorization", token) } else { req };
            
            match req.json(&acc_clone).send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        tracing::warn!("⚠️ Failed to sync account update: {}", resp.status());
                    }
                }
                Err(e) => tracing::warn!("⚠️ Could not sync account update: {}", e),
            }
        });
        
        tracing::info!("Updated account: {}", id);
        Ok(updated)
    }

    /// Delete an account
    pub async fn delete_account(&self, id: &str) -> Result<(), AppError> {
        let mut cache = self.accounts.write().await;
        
        if cache.remove(id).is_none() {
            return Err(AppError::NotFound(format!("Account {} not found", id)));
        }

        // Sync to PocketBase
        let url = format!("{}/api/collections/accounts/records/{}", self.pocketbase_url, id);
        let client = self.client.clone();
        let me = self.clone();
        
        tokio::spawn(async move {
            let token = me.get_token().await;
            
            let req = client.delete(&url);
            let req = if !token.is_empty() { req.header("Authorization", token) } else { req };
            
            match req.send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        tracing::warn!("⚠️ Failed to sync account delete: {}", resp.status());
                    }
                }
                Err(e) => tracing::warn!("⚠️ Could not sync account delete: {}", e),
            }
        });
        
        tracing::info!("Deleted account: {}", id);
        Ok(())
    }

    /// Get transactions filtered by account ID
    pub async fn get_transactions_by_account(
        &self,
        account_id: &str,
    ) -> Result<Vec<Transaction>, AppError> {
        self.load_transactions_from_pb().await?;
        
        let cache = self.transactions.read().await;
        let filtered: Vec<Transaction> = cache
            .values()
            .filter(|t| t.account_id.as_deref() == Some(account_id))
            .cloned()
            .collect();
        
        Ok(filtered)
    }

    // ==================== API Provider Operations ====================

    /// Get all API providers for a market, sorted by priority
    pub async fn get_providers_by_market(&self, market_id: &str) -> Result<Vec<crate::models::ApiProvider>, AppError> {
        let token = self.get_token().await;
        let url = format!(
            "{}/api/collections/api_providers/records?filter=(market_id='{}')&sort=priority",
            self.pocketbase_url,
            market_id
        );
        
        let request = self.client.get(&url);
        let request = if !token.is_empty() {
            request.header("Authorization", token)
        } else {
            request
        };
        
        let response = request.send().await
            .map_err(|e| AppError::Internal(format!("Failed to fetch providers: {}", e)))?;
        
        if response.status().is_success() {
            let data: PBListResponse<crate::models::ApiProvider> = response.json().await
                .map_err(|e| AppError::Internal(format!("Failed to parse providers: {}", e)))?;
            Ok(data.items)
        } else {
            tracing::warn!("No providers found for market {}", market_id);
            Ok(vec![])
        }
    }

    /// Get all API providers
    pub async fn list_all_providers(&self) -> Result<Vec<crate::models::ApiProvider>, AppError> {
        let token = self.get_token().await;
        let url = format!(
            "{}/api/collections/api_providers/records?sort=market_id,priority&perPage=500",
            self.pocketbase_url
        );
        
        let request = self.client.get(&url);
        let request = if !token.is_empty() {
            request.header("Authorization", token)
        } else {
            request
        };
        
        let response = request.send().await
            .map_err(|e| AppError::Internal(format!("Failed to fetch providers: {}", e)))?;
        
        if response.status().is_success() {
            let data: PBListResponse<crate::models::ApiProvider> = response.json().await
                .map_err(|e| AppError::Internal(format!("Failed to parse providers: {}", e)))?;
            Ok(data.items)
        } else {
            Ok(vec![])
        }
    }

    /// Create a new API provider
    pub async fn create_provider(&self, req: crate::models::CreateApiProviderRequest) -> Result<crate::models::ApiProvider, AppError> {
        let token = self.get_token().await;
        let url = format!("{}/api/collections/api_providers/records", self.pocketbase_url);
        
        let body = serde_json::json!({
            "market_id": req.market_id,
            "provider_name": req.provider_name,
            "provider_type": req.provider_type,
            "api_url": req.api_url.unwrap_or_default(),
            "priority": req.priority,
            "enabled": req.enabled.unwrap_or(true),
            "timeout_ms": req.timeout_ms.unwrap_or(10000),
        });
        
        let request = self.client.post(&url).json(&body);
        let request = if !token.is_empty() {
            request.header("Authorization", token)
        } else {
            request
        };
        
        let response = request.send().await
            .map_err(|e| AppError::Internal(format!("Failed to create provider: {}", e)))?;
        
        if response.status().is_success() {
            let provider: crate::models::ApiProvider = response.json().await
                .map_err(|e| AppError::Internal(format!("Failed to parse provider: {}", e)))?;
            tracing::info!("✅ Created API provider: {} for market {}", provider.provider_name, provider.market_id);
            Ok(provider)
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(AppError::Internal(format!("Failed to create provider: {} - {}", status, body)))
        }
    }

    /// Update an API provider
    pub async fn update_provider(&self, id: &str, req: crate::models::UpdateApiProviderRequest) -> Result<crate::models::ApiProvider, AppError> {
        let token = self.get_token().await;
        let url = format!("{}/api/collections/api_providers/records/{}", self.pocketbase_url, id);
        
        let mut body = serde_json::Map::new();
        if let Some(name) = req.provider_name {
            body.insert("provider_name".to_string(), serde_json::Value::String(name));
        }
        if let Some(ptype) = req.provider_type {
            body.insert("provider_type".to_string(), serde_json::Value::String(ptype));
        }
        if let Some(api_url) = req.api_url {
            body.insert("api_url".to_string(), serde_json::Value::String(api_url));
        }
        if let Some(priority) = req.priority {
            body.insert("priority".to_string(), serde_json::Value::Number(priority.into()));
        }
        if let Some(enabled) = req.enabled {
            body.insert("enabled".to_string(), serde_json::Value::Bool(enabled));
        }
        if let Some(timeout_ms) = req.timeout_ms {
            body.insert("timeout_ms".to_string(), serde_json::Value::Number(timeout_ms.into()));
        }
        
        let request = self.client.patch(&url).json(&serde_json::Value::Object(body));
        let request = if !token.is_empty() {
            request.header("Authorization", token)
        } else {
            request
        };
        
        let response = request.send().await
            .map_err(|e| AppError::Internal(format!("Failed to update provider: {}", e)))?;
        
        if response.status().is_success() {
            let provider: crate::models::ApiProvider = response.json().await
                .map_err(|e| AppError::Internal(format!("Failed to parse provider: {}", e)))?;
            tracing::info!("✅ Updated API provider: {}", id);
            Ok(provider)
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(AppError::Internal(format!("Failed to update provider: {} - {}", status, body)))
        }
    }

    /// Delete an API provider
    pub async fn delete_provider(&self, id: &str) -> Result<(), AppError> {
        let token = self.get_token().await;
        let url = format!("{}/api/collections/api_providers/records/{}", self.pocketbase_url, id);
        
        let request = self.client.delete(&url);
        let request = if !token.is_empty() {
            request.header("Authorization", token)
        } else {
            request
        };
        
        let response = request.send().await
            .map_err(|e| AppError::Internal(format!("Failed to delete provider: {}", e)))?;
        
        if response.status().is_success() {
            tracing::info!("✅ Deleted API provider: {}", id);
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(AppError::Internal(format!("Failed to delete provider: {} - {}", status, body)))
        }
    }

    // ==================== Asset Price Operations ====================

    /// Delete asset price by symbol
    pub async fn delete_asset_price(&self, symbol: &str) -> Result<(), AppError> {
        let token = self.get_token().await;
        
        // 1. Find the record ID
        let find_url = format!(
            "{}/api/collections/asset_prices/records?filter=(symbol='{}')",
            self.pocketbase_url,
            symbol
        );
        
        let request = self.client.get(&find_url);
        let request = if !token.is_empty() {
            request.header("Authorization", &token)
        } else {
            request
        };
        
        let response = request.send().await
            .map_err(|e| AppError::Internal(format!("Failed to find asset price: {}", e)))?;
            
        if !response.status().is_success() {
             return Ok(()); // Ignore if not found or error
        }
        
        #[derive(Deserialize)]
        struct PriceRecord { id: String }
        
        let data: PBListResponse<PriceRecord> = response.json().await
             .map_err(|e| AppError::Internal(format!("Failed to parse asset price search: {}", e)))?;
             
        if data.items.is_empty() {
            return Ok(());
        }
        
        // 2. Delete all matching records
        for item in data.items {
            let delete_url = format!("{}/api/collections/asset_prices/records/{}", self.pocketbase_url, item.id);
            let req = self.client.delete(&delete_url);
            let req = if !token.is_empty() {
                req.header("Authorization", &token)
            } else {
                req
            };
            
            let _ = req.send().await;
            tracing::info!("🗑️ Deleted stale asset_price record for {}", symbol);
        }
        
        Ok(())
    }

    /// Reorder providers for a market (update priorities)
    pub async fn reorder_providers(&self, market_id: &str, provider_ids: Vec<String>) -> Result<(), AppError> {
        for (index, provider_id) in provider_ids.iter().enumerate() {
            let priority = (index + 1) as i32;
            let req = crate::models::UpdateApiProviderRequest {
                provider_name: None,
                provider_type: None,
                api_url: None,
                priority: Some(priority),
                enabled: None,
                timeout_ms: None,
            };
            self.update_provider(provider_id, req).await?;
        }
        tracing::info!("✅ Reordered {} providers for market {}", provider_ids.len(), market_id);
        Ok(())
    }

    // ==================== API Call Log Operations ====================

    /// Log an API call (fire-and-forget, does not block)
    pub fn log_api_call(&self, log: crate::models::CreateApiCallLogRequest) {
        let url = format!("{}/api/collections/api_call_logs/records", self.pocketbase_url);
        let client = self.client.clone();
        let me = self.clone();
        
        tokio::spawn(async move {
            let token = me.get_token().await;
            
            let request = client.post(&url).json(&log);
            let request = if !token.is_empty() {
                request.header("Authorization", token)
            } else {
                request
            };
            
            match request.send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        tracing::warn!("⚠️ Failed to log API call: {}", resp.status());
                    }
                }
                Err(e) => tracing::warn!("⚠️ Could not log API call: {}", e),
            }
        });
    }

    /// Get recent API call logs (with pagination)
    pub async fn get_api_logs(&self, page: u32, per_page: u32) -> Result<(Vec<crate::models::ApiCallLog>, u32), AppError> {
        let token = self.get_token().await;
        let url = format!(
            "{}/api/collections/api_call_logs/records?page={}&perPage={}&sort=-created",
            self.pocketbase_url, page, per_page
        );
        
        let request = self.client.get(&url);
        let request = if !token.is_empty() {
            request.header("Authorization", token)
        } else {
            request
        };
        
        let response = request.send().await
            .map_err(|e| AppError::Internal(format!("Failed to fetch logs: {}", e)))?;
        
        if response.status().is_success() {
            let data: PBListResponse<crate::models::ApiCallLog> = response.json().await
                .map_err(|e| AppError::Internal(format!("Failed to parse logs: {}", e)))?;
            Ok((data.items, data.total_items))
        } else {
            Ok((vec![], 0))
        }
    }

    /// Get API call statistics by provider
    pub async fn get_api_stats(&self) -> Result<Vec<crate::models::ApiCallStats>, AppError> {
        // Simple implementation: fetch recent logs and aggregate
        let (logs, _) = self.get_api_logs(1, 1000).await?;
        
        let mut stats_map: std::collections::HashMap<String, (u64, u64, u64, u64)> = std::collections::HashMap::new();
        
        for log in logs {
            let entry = stats_map.entry(log.provider_type.clone()).or_insert((0, 0, 0, 0));
            entry.0 += 1; // total
            if log.status == "success" {
                entry.1 += 1; // success
            } else {
                entry.2 += 1; // error
            }
            entry.3 += log.response_time_ms; // total time
        }
        
        let stats: Vec<crate::models::ApiCallStats> = stats_map.into_iter()
            .map(|(provider, (total, success, error, total_time))| {
                crate::models::ApiCallStats {
                    provider_type: provider,
                    total_calls: total,
                    success_count: success,
                    error_count: error,
                    success_rate: if total > 0 { (success as f64 / total as f64) * 100.0 } else { 0.0 },
                    avg_response_time_ms: if total > 0 { total_time as f64 / total as f64 } else { 0.0 },
                }
            })
            .collect();
        
        Ok(stats)
    }
}
