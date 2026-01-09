//! Symbols service for PocketBase storage

use crate::error::AppError;
use crate::services::PocketBaseClient;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Symbol stored in PocketBase
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Symbol {
    #[serde(default)]
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub asset_type: String,
    #[serde(default)]
    pub market: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub sector: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
}

/// PocketBase list response
#[derive(Debug, Deserialize)]
struct PBListResponse {
    items: Vec<Symbol>,
}

/// Symbols service for PocketBase operations
#[derive(Clone)]
pub struct SymbolsService {
    pocketbase_url: String,
    http_client: reqwest::Client,
    pb_client: PocketBaseClient,
    cache: Arc<RwLock<Vec<Symbol>>>,
    loaded: Arc<RwLock<bool>>,
}

impl SymbolsService {
    pub fn new(pocketbase_url: String, pb_client: PocketBaseClient) -> Self {
        Self {
            pocketbase_url,
            http_client: reqwest::Client::new(),
            pb_client,
            cache: Arc::new(RwLock::new(Vec::new())),
            loaded: Arc::new(RwLock::new(false)),
        }
    }

    /// Load symbols from PocketBase
    pub async fn load_symbols(&self) -> Result<(), AppError> {
        let loaded = *self.loaded.read().await;
        if loaded {
            return Ok(());
        }

        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/symbols/records?perPage=2000", self.pocketbase_url);

        let request = self.http_client.get(&url);
        let request = if !token.is_empty() { request.header("Authorization", token) } else { request };

        match request.send().await {
            Ok(response) => {
                if response.status().is_success() {
                    if let Ok(data) = response.json::<PBListResponse>().await {
                        let mut cache = self.cache.write().await;
                        *cache = data.items;
                        tracing::info!("📦 Loaded {} symbols from PocketBase", cache.len());
                    }
                } else {
                    tracing::warn!("⚠️ Could not load symbols from PocketBase: {}", response.status());
                }
            }
            Err(e) => {
                tracing::warn!("⚠️ Could not connect to PocketBase for symbols: {}", e);
            }
        }

        *self.loaded.write().await = true;
        Ok(())
    }

    /// Get symbols by asset type
    pub async fn get_by_asset_type(&self, asset_type: &str, query: Option<&str>, market: Option<&str>, limit: usize) -> Vec<Symbol> {
        let _ = self.load_symbols().await;
        let cache = self.cache.read().await;

        let filtered: Vec<Symbol> = cache
            .iter()
            .filter(|s| s.asset_type == asset_type)
            .filter(|s| {
                match market {
                    Some(m) if !m.is_empty() => s.market.as_deref() == Some(m),
                    _ => true,
                }
            })
            .filter(|s| {
                match query {
                    Some(q) if !q.is_empty() => {
                        let search = q.to_uppercase();
                        s.symbol.to_uppercase().contains(&search) || s.name.to_uppercase().contains(&search)
                    }
                    _ => true,
                }
            })
            .take(limit)
            .cloned()
            .collect();

        filtered
    }

    /// Check if symbols are loaded
    pub async fn has_symbols(&self) -> bool {
        let _ = self.load_symbols().await;
        let cache = self.cache.read().await;
        !cache.is_empty()
    }

    /// Seed symbols to PocketBase
    pub async fn seed_symbols(&self, symbols: Vec<Symbol>) -> Result<usize, AppError> {
        let url = format!("{}/api/collections/symbols/records", self.pocketbase_url);
        let mut count = 0;
        let pb_client = self.pb_client.clone();
        
        let client = self.http_client.clone();
        
        // We can't use parallel iter here easily with async token fetch per item if we want efficiency.
        // Actually, we can just get token once.
        let token = pb_client.get_token().await;

        for symbol in symbols {
            // Create payload without ID (let PocketBase generate it)
            let payload = serde_json::json!({
                "symbol": symbol.symbol,
                "name": symbol.name,
                "asset_type": symbol.asset_type,
                "market": symbol.market,
                "category": symbol.category,
                "sector": symbol.sector,
                "icon_url": symbol.icon_url,
            });

            let req = client.post(&url);
            let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };

            match req.json(&payload).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        count += 1;
                    }
                }
                Err(_) => continue,
            }
        }

        // Reload cache
        *self.loaded.write().await = false;
        let _ = self.load_symbols().await;

        Ok(count)
    }
}
