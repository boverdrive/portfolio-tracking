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
            pocketbase_url: config.pocketbase_url,
            client: reqwest::Client::new(),
            transactions: Arc::new(RwLock::new(HashMap::new())),
            accounts: Arc::new(RwLock::new(HashMap::new())),
            loaded_transactions: Arc::new(RwLock::new(false)),
            loaded_accounts: Arc::new(RwLock::new(false)),
        }
    }

    // ==================== Transaction Operations ====================

    /// Load transactions from PocketBase (called once on first access)
    async fn load_transactions_from_pb(&self) -> Result<(), AppError> {
        let loaded = *self.loaded_transactions.read().await;
        if loaded {
            return Ok(());
        }

        let url = format!("{}/api/collections/transactions/records?perPage=500", self.pocketbase_url);
        
        match self.client.get(&url).send().await {
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
        
        tokio::spawn(async move {
            tracing::info!("🔄 Syncing transaction to PocketBase: {}", tx_clone.id);
            match client.post(&url).json(&tx_clone).send().await {
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
        
        transaction.updated_at = Utc::now();
        let updated = transaction.clone();

        // Sync to PocketBase
        let url = format!("{}/api/collections/transactions/records/{}", self.pocketbase_url, id);
        let tx_clone = updated.clone();
        let client = self.client.clone();
        
        tokio::spawn(async move {
            match client.patch(&url).json(&tx_clone).send().await {
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
        
        tokio::spawn(async move {
            match client.delete(&url).send().await {
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

        let url = format!("{}/api/collections/accounts/records?perPage=500", self.pocketbase_url);
        
        match self.client.get(&url).send().await {
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
        
        tokio::spawn(async move {
            tracing::info!("🔄 Syncing account to PocketBase: {}", acc_clone.id);
            match client.post(&url).json(&acc_clone).send().await {
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
        
        tokio::spawn(async move {
            match client.patch(&url).json(&acc_clone).send().await {
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
        
        tokio::spawn(async move {
            match client.delete(&url).send().await {
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
}
