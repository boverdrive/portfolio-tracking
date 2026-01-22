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
