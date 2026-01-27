use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub server_host: String,
    pub server_port: u16,
    pub pocketbase_url: String,
    pub coingecko_api_url: String,
    pub settrade_api_url: String,
    pub yahoo_finance_service_url: String,
    pub price_cache_ttl_seconds: u64,
    // OAuth configuration
    pub oauth_enabled: bool,
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
    pub oauth_redirect_url: String,
    // Custom OIDC provider (e.g., PocketID, Keycloak, Auth0)
    pub oidc_provider_name: Option<String>,
    pub oidc_issuer_url: Option<String>,
    pub oidc_client_id: Option<String>,
    pub oidc_client_secret: Option<String>,
    pub oidc_scopes: String,
    // JWT configuration
    pub jwt_secret: String,
    pub jwt_expiry_hours: u64,
    // Frontend URL for redirects
    pub frontend_url: String,
    // Local auth (username/password)
    pub local_auth_enabled: Option<bool>,
    // Initial admin user
    pub admin_email: Option<String>,
    pub admin_password: Option<String>,
    // PocketBase connection credentials (infrastructure)
    pub pb_admin_email: Option<String>,
    pub pb_admin_password: Option<String>,
    // CORS configuration
    pub cors_allowed_origins: Vec<String>,
}

impl Config {
    pub fn from_env() -> Self {
        // Try to load .env from current directory first, then parent
        if dotenvy::dotenv().is_err() {
            // Try loading from parent directory explicitly (useful when running from backend/ subdir)
            let _ = dotenvy::from_path(std::path::Path::new("../.env"));
        }

        Self {
            server_host: env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            server_port: env::var("SERVER_PORT")
                .unwrap_or_else(|_| "3001".to_string())
                .parse()
                .expect("SERVER_PORT must be a number"),
            pocketbase_url: env::var("POCKETBASE_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8090".to_string()),
            coingecko_api_url: env::var("COINGECKO_API_URL")
                .unwrap_or_else(|_| "https://api.coingecko.com/api/v3".to_string()),
            settrade_api_url: env::var("SETTRADE_API_URL")
                .unwrap_or_else(|_| "https://open-api.settrade.com/api".to_string()),
            yahoo_finance_service_url: env::var("YAHOO_FINANCE_SERVICE_URL")
                .unwrap_or_else(|_| "http://yahoo-finance:8000".to_string()),
            price_cache_ttl_seconds: env::var("PRICE_CACHE_TTL")
                .unwrap_or_else(|_| "60".to_string())
                .parse()
                .expect("PRICE_CACHE_TTL must be a number"),
            // OAuth configuration
            oauth_enabled: env::var("OAUTH_ENABLED")
                .unwrap_or_else(|_| "true".to_string())
                .parse()
                .unwrap_or(true),
            google_client_id: env::var("GOOGLE_CLIENT_ID").ok(),
            google_client_secret: env::var("GOOGLE_CLIENT_SECRET").ok(),
            oauth_redirect_url: env::var("OAUTH_REDIRECT_URL")
                .unwrap_or_else(|_| "http://localhost:3001/api/auth/callback".to_string()),
            // Custom OIDC provider configuration
            oidc_provider_name: env::var("OIDC_PROVIDER_NAME").ok(),
            oidc_issuer_url: env::var("OIDC_ISSUER_URL").ok(),
            oidc_client_id: env::var("OIDC_CLIENT_ID").ok(),
            oidc_client_secret: env::var("OIDC_CLIENT_SECRET").ok(),
            oidc_scopes: env::var("OIDC_SCOPES")
                .unwrap_or_else(|_| "openid profile email".to_string()),
            // JWT configuration
            jwt_secret: env::var("JWT_SECRET")
                .unwrap_or_else(|_| "your-super-secret-jwt-key-change-in-production".to_string()),
            jwt_expiry_hours: env::var("JWT_EXPIRY_HOURS")
                .unwrap_or_else(|_| "24".to_string())
                .parse()
                .expect("JWT_EXPIRY_HOURS must be a number"),
            // Frontend URL
            frontend_url: env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
            // Local auth
            local_auth_enabled: env::var("LOCAL_AUTH_ENABLED")
                .ok()
                .and_then(|v| v.parse().ok()),
            // Initial admin user
            // Initial admin user (Business Logic)
            admin_email: env::var("ADMIN_EMAIL").ok().filter(|v| !v.is_empty()),
            admin_password: env::var("ADMIN_PASSWORD").ok().filter(|v| !v.is_empty()),
            // PocketBase connection credentials (Infrastructure)
            pb_admin_email: env::var("POCKETBASE_ADMIN_EMAIL").ok().filter(|v| !v.is_empty()),
            pb_admin_password: env::var("POCKETBASE_ADMIN_PASSWORD").ok().filter(|v| !v.is_empty()),
            cors_allowed_origins: env::var("CORS_ALLOWED_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:3000".to_string())
                .split(',')
                .map(|s| s.trim().to_string())
                .collect(),
        }
    }

    pub fn server_addr(&self) -> String {
        format!("{}:{}", self.server_host, self.server_port)
    }
}

