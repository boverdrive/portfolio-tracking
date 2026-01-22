use axum::{
    extract::State,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::AppState;

/// Seed data structure (matches seed-data.json format)
#[derive(Debug, Deserialize)]
pub struct SeedData {
    #[serde(default)]
    pub users: Vec<serde_json::Value>,
    #[serde(default)]
    pub api_rate_limits: Vec<serde_json::Value>,
    #[serde(default)]
    pub jobs: Vec<serde_json::Value>,
    #[serde(default)]
    pub api_providers: Vec<serde_json::Value>,
    #[serde(default)]
    pub symbols: Vec<serde_json::Value>,
    #[serde(default)]
    pub asset_prices: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct SeedResult {
    pub collection: String,
    pub created: usize,
    pub skipped: usize,
    pub errors: usize,
    pub error_messages: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SeedResponse {
    pub success: bool,
    pub message: String,
    pub results: Vec<SeedResult>,
}

/// POST /api/seed/upload - Upload and process seed data
pub async fn upload_seed(
    State(state): State<AppState>,
    Json(seed_data): Json<SeedData>,
) -> Json<SeedResponse> {
    tracing::info!("🌱 Starting seed upload process...");
    
    let pb_url = &state.config.pocketbase_url;
    let mut results = Vec::new();
    
    // Collection order matters for dependencies
    let collections = vec![
        ("users", &seed_data.users, vec!["email"]),
        ("api_rate_limits", &seed_data.api_rate_limits, vec!["api_name"]),
        ("jobs", &seed_data.jobs, vec!["job_type"]),
        ("api_providers", &seed_data.api_providers, vec!["provider_type"]),
        ("symbols", &seed_data.symbols, vec!["symbol"]),
        ("asset_prices", &seed_data.asset_prices, vec!["symbol"]),
    ];
    
    for (collection_name, records, unique_fields) in collections {
        if records.is_empty() {
            continue;
        }
        
        tracing::info!("📥 Seeding {} ({} records)...", collection_name, records.len());
        
        let result = seed_collection(
            pb_url,
            collection_name,
            records,
            &unique_fields,
        ).await;
        
        results.push(result);
    }
    
    let total_created: usize = results.iter().map(|r| r.created).sum();
    let total_skipped: usize = results.iter().map(|r| r.skipped).sum();
    let total_errors: usize = results.iter().map(|r| r.errors).sum();
    
    tracing::info!("🎉 Seed complete: {} created, {} skipped, {} errors", 
        total_created, total_skipped, total_errors);
    
    Json(SeedResponse {
        success: total_errors == 0,
        message: format!(
            "Seed complete: {} created, {} skipped, {} errors",
            total_created, total_skipped, total_errors
        ),
        results,
    })
}

async fn seed_collection(
    pb_url: &str,
    collection_name: &str,
    records: &[serde_json::Value],
    unique_fields: &[&str],
) -> SeedResult {
    let client = reqwest::Client::new();
    let mut created = 0;
    let mut skipped = 0;
    let mut errors = 0;
    let mut error_messages = Vec::new();
    
    for record in records {
        // Build filter to check for existing record
        let filter = build_filter(record, unique_fields);
        
        if !filter.is_empty() {
            // Check if record already exists
            let check_url = format!(
                "{}/api/collections/{}/records?filter=({})",
                pb_url, collection_name, filter
            );
            
            match client.get(&check_url).send().await {
                Ok(resp) => {
                    if let Ok(json) = resp.json::<serde_json::Value>().await {
                        if let Some(items) = json.get("items").and_then(|v| v.as_array()) {
                            if !items.is_empty() {
                                skipped += 1;
                                continue;
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to check existing record: {}", e);
                }
            }
        }
        
        // Create record
        let create_url = format!("{}/api/collections/{}/records", pb_url, collection_name);
        
        match client
            .post(&create_url)
            .json(record)
            .send()
            .await
        {
            Ok(resp) => {
                if resp.status().is_success() {
                    created += 1;
                } else {
                    let err_text = resp.text().await.unwrap_or_default();
                    let short_err = if err_text.len() > 100 {
                        format!("{}...", &err_text[..100])
                    } else {
                        err_text
                    };
                    error_messages.push(short_err);
                    errors += 1;
                }
            }
            Err(e) => {
                error_messages.push(e.to_string());
                errors += 1;
            }
        }
    }
    
    SeedResult {
        collection: collection_name.to_string(),
        created,
        skipped,
        errors,
        error_messages,
    }
}

fn build_filter(record: &serde_json::Value, unique_fields: &[&str]) -> String {
    let mut parts = Vec::new();
    
    // Check for id first
    if let Some(id) = record.get("id").and_then(|v| v.as_str()) {
        return format!("id='{}'", id);
    }
    
    // Build filter from unique fields
    for field in unique_fields {
        if let Some(value) = record.get(*field) {
            if let Some(s) = value.as_str() {
                parts.push(format!("{}='{}'", field, s));
            }
        }
    }
    
    parts.join(" && ")
}

/// Export seed data structure
#[derive(Debug, Serialize)]
pub struct ExportSeedData {
    pub users: Vec<serde_json::Value>,
    pub api_rate_limits: Vec<serde_json::Value>,
    pub jobs: Vec<serde_json::Value>,
    pub api_providers: Vec<serde_json::Value>,
    pub symbols: Vec<serde_json::Value>,
    pub asset_prices: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct ExportResponse {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<ExportSeedData>,
    pub stats: ExportStats,
}

#[derive(Debug, Serialize)]
pub struct ExportStats {
    pub users: usize,
    pub api_rate_limits: usize,
    pub jobs: usize,
    pub api_providers: usize,
    pub symbols: usize,
    pub asset_prices: usize,
}

/// GET /api/seed/export - Export current seed data
pub async fn export_seed(
    State(state): State<AppState>,
) -> Json<ExportResponse> {
    tracing::info!("📤 Starting seed export process...");
    
    let pb_url = &state.config.pocketbase_url;
    let client = reqwest::Client::new();
    
    // Collections to export (same order as upload)
    let collections = vec![
        "users",
        "api_rate_limits", 
        "jobs",
        "api_providers",
        "symbols",
        "asset_prices",
    ];
    
    let mut export_data = ExportSeedData {
        users: Vec::new(),
        api_rate_limits: Vec::new(),
        jobs: Vec::new(),
        api_providers: Vec::new(),
        symbols: Vec::new(),
        asset_prices: Vec::new(),
    };
    
    for collection_name in &collections {
        let records = fetch_collection(&client, pb_url, collection_name).await;
        let cleaned: Vec<serde_json::Value> = records
            .into_iter()
            .map(|r| clean_record(r, collection_name))
            .collect();
        
        match *collection_name {
            "users" => export_data.users = cleaned,
            "api_rate_limits" => export_data.api_rate_limits = cleaned,
            "jobs" => export_data.jobs = cleaned,
            "api_providers" => export_data.api_providers = cleaned,
            "symbols" => export_data.symbols = cleaned,
            "asset_prices" => export_data.asset_prices = cleaned,
            _ => {}
        }
    }
    
    let stats = ExportStats {
        users: export_data.users.len(),
        api_rate_limits: export_data.api_rate_limits.len(),
        jobs: export_data.jobs.len(),
        api_providers: export_data.api_providers.len(),
        symbols: export_data.symbols.len(),
        asset_prices: export_data.asset_prices.len(),
    };
    
    let total: usize = stats.users + stats.api_rate_limits + stats.jobs 
        + stats.api_providers + stats.symbols + stats.asset_prices;
    
    tracing::info!("📤 Export complete: {} total records", total);
    
    Json(ExportResponse {
        success: true,
        message: format!("Exported {} records", total),
        data: Some(export_data),
        stats,
    })
}

async fn fetch_collection(
    client: &reqwest::Client,
    pb_url: &str,
    collection_name: &str,
) -> Vec<serde_json::Value> {
    let mut all_records = Vec::new();
    let mut page = 1;
    
    loop {
        let url = format!(
            "{}/api/collections/{}/records?page={}&perPage=500",
            pb_url, collection_name, page
        );
        
        match client.get(&url).send().await {
            Ok(resp) => {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(items) = json.get("items").and_then(|v| v.as_array()) {
                        if items.is_empty() {
                            break;
                        }
                        all_records.extend(items.clone());
                        
                        let total_pages = json.get("totalPages")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(1) as i32;
                        
                        if page >= total_pages {
                            break;
                        }
                        page += 1;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            Err(e) => {
                tracing::warn!("Failed to fetch {}: {}", collection_name, e);
                break;
            }
        }
    }
    
    tracing::info!("   ✅ Fetched {} records from {}", all_records.len(), collection_name);
    all_records
}

fn clean_record(mut record: serde_json::Value, collection_name: &str) -> serde_json::Value {
    // Remove system fields
    if let Some(obj) = record.as_object_mut() {
        obj.remove("created");
        obj.remove("updated");
        obj.remove("collectionId");
        obj.remove("collectionName");
        obj.remove("expand");
        
        // For users, replace password hash with default password
        if collection_name == "users" {
            obj.remove("passwordHash");
            obj.insert("password".to_string(), serde_json::json!("password123"));
            obj.insert("passwordConfirm".to_string(), serde_json::json!("password123"));
        }
    }
    record
}
