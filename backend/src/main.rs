mod config;
mod error;
mod handlers;
mod models;
mod services;

use axum::{
    routing::{get, post, put, delete, patch},
    Router, Json,
    extract::State,
};
use tower_http::cors::{CorsLayer, Any};
use tower_http::trace::TraceLayer;
use std::sync::Arc;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use config::Config;
use services::{PocketBaseClient, PriceService, ExchangeRateService, AuthService, JobScheduler, SymbolsService};

#[derive(Clone)]
pub struct AppState {
    pub db: PocketBaseClient,
    pub price_service: PriceService,
    pub exchange_rate_service: ExchangeRateService,
    pub auth_service: AuthService,
    pub job_scheduler: JobScheduler,
    pub symbols_service: SymbolsService,
    pub config: Arc<Config>,
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,tower_http=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("🚀 Portfolio Backend Starting...");
    tracing::info!("🔒 Login Logic Version: CHECK_FIX_AUTH_V2 - PocketBase Fallback Enabled");

    // Load configuration
    let config = Config::from_env();
    let addr = config.server_addr();

    // Initialize services
    let db = PocketBaseClient::new(config.clone());
    let price_service = PriceService::new(config.clone());
    let exchange_rate_service = ExchangeRateService::new(config.clone());
    let auth_service = AuthService::new(config.clone(), db.clone()).await;
    let job_scheduler = JobScheduler::new(config.clone(), db.clone());
    let symbols_service = SymbolsService::new(config.pocketbase_url.clone(), db.clone());
    
    // Initialize job scheduler (load jobs from database)
    if let Err(e) = job_scheduler.initialize().await {
        tracing::warn!("Failed to initialize job scheduler: {}", e);
    }

    let state = AppState {
        db,
        price_service,
        exchange_rate_service,
        auth_service,
        job_scheduler,
        symbols_service,
        config: Arc::new(config),
    };

    // Build router
    let app = Router::new()
        // Health check
        .route("/health", get(health_check))
        .route("/api/status", get(system_status))
        
        // Auth routes
        .route("/api/auth/providers", get(handlers::get_available_providers))
        .route("/api/auth/google", get(handlers::google_login))
        .route("/api/auth/google/callback", get(handlers::google_callback))
        .route("/api/auth/oidc", get(handlers::oidc_login))
        .route("/api/auth/oidc/callback", get(handlers::oidc_callback))
        .route("/api/auth/me", get(handlers::get_current_user))
        .route("/api/auth/logout", post(handlers::logout))
        .route("/api/auth/verify", post(handlers::verify_token))
        .route("/api/auth/linked-providers", get(handlers::get_linked_providers))
        .route("/api/auth/unlink/:provider", delete(handlers::unlink_provider))
        .route("/api/auth/local/login", post(handlers::local_login))
        .route("/api/auth/local/register", post(handlers::local_register))
        
        // Transaction routes
        .route("/api/transactions", get(handlers::list_transactions))
        .route("/api/transactions", post(handlers::create_transaction))
        .route("/api/transactions/:id", get(handlers::get_transaction))
        .route("/api/transactions/:id", put(handlers::update_transaction))
        .route("/api/transactions/:id", delete(handlers::delete_transaction))
        .route("/api/transactions/type/:asset_type", get(handlers::get_transactions_by_type))
        
        // Portfolio routes
        .route("/api/portfolio", get(handlers::get_portfolio))
        .route("/api/portfolio/summary", get(handlers::get_portfolio_summary))
        .route("/api/portfolio/type/:asset_type", get(handlers::get_portfolio_by_type))
        .route("/api/portfolio/market/:market", get(handlers::get_portfolio_by_market))
        
        // Price routes
        .route("/api/prices/:symbol", get(handlers::get_price))
        .route("/api/prices/batch", post(handlers::get_prices_batch))
        .route("/api/prices/cache/clear", post(handlers::clear_price_cache))
        
        // Exchange rate routes
        .route("/api/exchange-rate", get(handlers::get_exchange_rate))
        .route("/api/exchange-rate/:base", get(handlers::get_all_exchange_rates))
        .route("/api/exchange-rate/convert", get(handlers::convert_currency))
        .route("/api/exchange-rate/cache/clear", post(handlers::clear_exchange_rate_cache))
        
        // Account routes
        .route("/api/accounts/reorder", put(handlers::reorder_accounts))
        .route("/api/accounts", get(handlers::list_accounts))
        .route("/api/accounts", post(handlers::create_account))
        .route("/api/accounts/:id", get(handlers::get_account))
        .route("/api/accounts/:id", put(handlers::update_account))
        .route("/api/accounts/:id", delete(handlers::delete_account))
        
        // Symbol lookup routes
        .route("/api/symbols/thai-stocks", get(handlers::get_thai_stocks))
        .route("/api/symbols/tfex", get(handlers::get_tfex_symbols))
        .route("/api/symbols/crypto", get(handlers::get_crypto_symbols))
        .route("/api/symbols/foreign-stocks", get(handlers::get_foreign_stocks))
        .route("/api/symbols/seed", post(handlers::seed_symbols))
        
        // Job scheduler routes
        .route("/api/jobs", get(handlers::list_jobs))
        .route("/api/jobs/:id", get(handlers::get_job))
        .route("/api/jobs/:id", put(handlers::update_job))
        .route("/api/jobs/:id/run", post(handlers::run_job))
        
        // Admin user management routes
        .route("/api/admin/users", get(handlers::list_users))
        .route("/api/admin/users", post(handlers::create_user))
        .route("/api/admin/users/:id", get(handlers::get_user))
        .route("/api/admin/users/:id", patch(handlers::update_user))
        .route("/api/admin/users/:id", delete(handlers::delete_user))
        .route("/api/admin/users/:id/reset-password", post(handlers::reset_user_password))
        
        // Add middleware
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin("http://localhost:3000".parse::<axum::http::HeaderValue>().unwrap())
                .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::PUT, axum::http::Method::DELETE, axum::http::Method::PATCH, axum::http::Method::OPTIONS])
                .allow_headers([axum::http::header::CONTENT_TYPE, axum::http::header::AUTHORIZATION, axum::http::header::COOKIE])
                .allow_credentials(true),
        )
        .with_state(state);

    tracing::info!("🚀 Portfolio Backend starting on http://{}", addr);
    tracing::info!("📊 API available at http://{}/api", addr);
    tracing::info!("🔐 Auth endpoints available at http://{}/api/auth", addr);

    // Start server
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> &'static str {
    "OK"
}

/// GET /api/status - Detailed system status including PocketBase connection
async fn system_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    // Check PocketBase connection
    let pb_url = format!("{}/api/health", state.config.pocketbase_url);
    let pb_status = match reqwest::Client::new()
        .get(&pb_url)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    };
    
    Json(serde_json::json!({
        "status": "ok",
        "pocketbase": {
            "url": state.config.pocketbase_url,
            "connected": pb_status
        },
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}
