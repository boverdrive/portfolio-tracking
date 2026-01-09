use chrono::{Duration, Utc};
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use oauth2::{
    AuthorizationCode, AuthUrl, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, TokenUrl,
    basic::BasicClient, reqwest::async_http_client,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::Config;
use crate::error::AppError;
use crate::models::{
    User, OAuthAccount, OAuthProvider, Claims, GoogleUserInfo, AuthResponse,
    LinkedProvider, UserResponse,
};

use crate::services::PocketBaseClient;

/// Auth service for handling OAuth/OIDC authentication
#[derive(Clone)]
pub struct AuthService {
    config: Config,
    http_client: reqwest::Client,
    pocketbase_url: String,
    pb_client: PocketBaseClient,
    // In-memory storage for users (cache + fallback)
    users: Arc<RwLock<HashMap<String, User>>>,
    loaded_users: Arc<RwLock<bool>>,
    // OAuth accounts storage
    oauth_accounts: Arc<RwLock<HashMap<String, OAuthAccount>>>,
    // PKCE verifiers storage (csrf_token -> verifier)
    pkce_verifiers: Arc<RwLock<HashMap<String, String>>>,
}

/// OIDC Discovery document
#[derive(Debug, Clone, serde::Deserialize)]
pub struct OidcDiscovery {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub userinfo_endpoint: Option<String>,
    #[allow(dead_code)]
    pub jwks_uri: Option<String>,
}

/// Generic OIDC user info response
#[derive(Debug, Clone, serde::Deserialize)]
pub struct OidcUserInfo {
    pub sub: String,
    pub email: Option<String>,
    #[allow(dead_code)]
    pub email_verified: Option<bool>,
    pub name: Option<String>,
    pub preferred_username: Option<String>,
    pub picture: Option<String>,
}

/// OAuth callback parameters
#[derive(Debug, Clone, serde::Deserialize)]
pub struct OAuthCallbackParams {
    pub code: String,
    pub state: String,
}

impl AuthService {
    pub async fn new(config: Config, pb_client: PocketBaseClient) -> Self {
        let pocketbase_url = config.pocketbase_url.clone();
        let service = Self {
            config: config.clone(),
            http_client: reqwest::Client::new(),
            pocketbase_url,
            pb_client,
            users: Arc::new(RwLock::new(HashMap::new())),
            loaded_users: Arc::new(RwLock::new(false)),
            oauth_accounts: Arc::new(RwLock::new(HashMap::new())),
            pkce_verifiers: Arc::new(RwLock::new(HashMap::new())),
        };
        
        // Load users from PocketBase
        if let Err(e) = service.load_users_from_pb().await {
            tracing::warn!("⚠️ Could not load users from PocketBase: {}", e);
        }
        
        // Create initial admin user if configured
        tracing::info!("🧐 Checking admin config: Email={:?}, Password present={}", 
            config.admin_email, 
            config.admin_password.is_some()
        );

        if let (Some(email), Some(password)) = (&config.admin_email, &config.admin_password) {
            match service.register_local_user(email, password, Some("Admin".to_string()), true).await {
                Ok(user) => {
                    tracing::info!("Created initial admin user: {} ({}) with role: {}", user.email, user.id, user.role);
                }
                Err(e) => {
                    // User might already exist, that's okay, but let's log it clearly if it's not a conflict
                    match &e {
                        AppError::Conflict(_) => tracing::info!("Admin user already exists locally"),
                        _ => tracing::error!("❌ Failed to create initial admin user: {:?}", e),
                    }
                }
            }
        }
        
        service
    }

    // ==================== PocketBase Sync ====================

    /// Load users from PocketBase
    async fn load_users_from_pb(&self) -> Result<(), AppError> {
        // Always reload users from PocketBase on startup
        tracing::info!("📦 Loading users from PocketBase...");

        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/users/records?perPage=500", self.pocketbase_url);
        
        #[derive(serde::Deserialize)]
        struct PBListResponse<T> {
            items: Vec<T>,
        }
        
        #[derive(serde::Deserialize)]
        struct PBUser {
            id: String,
            email: String,
            name: Option<String>,
            avatar_url: Option<String>,
            #[serde(default)]
            local_password_hash: Option<String>,
            #[serde(default = "default_user_role")]
            role: String,
            #[serde(default)]
            token_version: i32,
        }
        
        fn default_user_role() -> String {
            "user".to_string()
        }

        let request = self.http_client.get(&url);
        let request = if !token.is_empty() {
            request.header("Authorization", token)
        } else {
            request
        };

        match request.send().await {
            Ok(response) => {
                if response.status().is_success() {
                    if let Ok(data) = response.json::<PBListResponse<PBUser>>().await {
                        let mut cache = self.users.write().await;
                        let mut users_with_hash = 0;
                        for pb_user in data.items {
                            let has_hash = pb_user.local_password_hash.is_some();
                            if has_hash { users_with_hash += 1; }
                            
                            let user = User {
                                id: pb_user.id.clone(),
                                email: pb_user.email.clone(),
                                name: pb_user.name,
                                avatar_url: pb_user.avatar_url,
                                role: pb_user.role,
                                local_password_hash: pb_user.local_password_hash,
                                created_at: chrono::Utc::now(),
                                updated_at: chrono::Utc::now(),
                                token_version: pb_user.token_version,
                            };
                            cache.insert(user.id.clone(), user);
                        }
                        tracing::info!("📦 Loaded {} users from PocketBase ({} have local_password_hash)", cache.len(), users_with_hash);
                        if cache.len() > 0 && users_with_hash == 0 {
                            tracing::warn!("⚠️ No users have local_password_hash! Check if 'local_password_hash' field exists in PocketBase 'users' collection.");
                        }
                    }
                } else {
                    tracing::warn!("⚠️ Could not load users from PocketBase: {}", response.status());
                }
            }
            Err(e) => {
                tracing::warn!("⚠️ Could not connect to PocketBase for users: {}", e);
            }
        }

        *self.loaded_users.write().await = true;
        Ok(())
    }

    /// Sync user to PocketBase (async, don't block)
    fn sync_user_to_pb(&self, user: &User, password: Option<String>) {
        let url = format!("{}/api/collections/users/records", self.pocketbase_url);
        let user_clone = user.clone();
        let client = self.http_client.clone();
        let pb_url = self.pocketbase_url.clone();
        let pb_client = self.pb_client.clone();
        
        #[derive(serde::Serialize)]
        struct PBUserPayload {
            id: String,
            email: String,
            name: Option<String>,
            avatar_url: Option<String>,
            role: String,
            local_password_hash: Option<String>,
            token_version: i32,
            #[serde(skip_serializing_if = "Option::is_none")]
            password: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            #[serde(rename = "passwordConfirm")]
            password_confirm: Option<String>,
        }
        
        let payload = PBUserPayload {
            id: user_clone.id.clone(),
            email: user_clone.email.clone(),
            name: user_clone.name.clone(),
            avatar_url: user_clone.avatar_url.clone(),
            role: user_clone.role.clone(),
            local_password_hash: user_clone.local_password_hash.clone(),
            token_version: user_clone.token_version,
            password: password.clone(),
            password_confirm: password.clone(),
        };
        
        tokio::spawn(async move {
            tracing::info!("🔄 Syncing user to PocketBase: {} (role: {})", user_clone.id, user_clone.role);
            
            let token = pb_client.get_token().await;

            // First try to update existing record
            let update_url = format!("{}/api/collections/users/records/{}", pb_url, user_clone.id);
            let req = client.patch(&update_url);
            let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
            
            match req.json(&payload).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        tracing::info!("✅ User updated in PocketBase: {} (role: {})", user_clone.id, user_clone.role);
                        return;
                    }
                }
                Err(_) => {}
            }
            
            // If update fails, try to create new record
            let req = client.post(&url);
            let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };
            
            match req.json(&payload).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        tracing::info!("✅ User created in PocketBase: {} (role: {})", user_clone.id, user_clone.role);
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        tracing::warn!("⚠️ Failed to sync user: {} - {}", status, body);
                    }
                }
                Err(e) => tracing::error!("❌ Could not sync user to PocketBase: {}", e),
            }
        });
    }

    // ==================== Google OAuth ====================

    /// Create Google OAuth client
    fn create_google_client(&self) -> Result<BasicClient, AppError> {
        let client_id = self.config.google_client_id.clone()
            .ok_or_else(|| AppError::Config("GOOGLE_CLIENT_ID not configured".to_string()))?;
        let client_secret = self.config.google_client_secret.clone()
            .ok_or_else(|| AppError::Config("GOOGLE_CLIENT_SECRET not configured".to_string()))?;

        let redirect_url = format!("{}/api/auth/google/callback", self.config.oauth_redirect_url);

        let client = BasicClient::new(
            ClientId::new(client_id),
            Some(ClientSecret::new(client_secret)),
            AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())?,
            Some(TokenUrl::new("https://oauth2.googleapis.com/token".to_string())?),
        )
        .set_redirect_uri(RedirectUrl::new(redirect_url)?);

        Ok(client)
    }

    /// Get Google OAuth authorization URL
    pub fn get_google_auth_url(&self) -> Result<(String, CsrfToken, PkceCodeVerifier), AppError> {
        let client = self.create_google_client()?;
        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

        let (auth_url, csrf_token) = client
            .authorize_url(CsrfToken::new_random)
            .add_scope(Scope::new("openid".to_string()))
            .add_scope(Scope::new("email".to_string()))
            .add_scope(Scope::new("profile".to_string()))
            .set_pkce_challenge(pkce_challenge)
            .url();

        Ok((auth_url.to_string(), csrf_token, pkce_verifier))
    }

    /// Exchange Google authorization code for tokens
    pub async fn exchange_google_code(
        &self,
        code: &str,
        pkce_verifier: PkceCodeVerifier,
    ) -> Result<oauth2::StandardTokenResponse<oauth2::EmptyExtraTokenFields, oauth2::basic::BasicTokenType>, AppError> {
        let client = self.create_google_client()?;

        let token = client
            .exchange_code(AuthorizationCode::new(code.to_string()))
            .set_pkce_verifier(pkce_verifier)
            .request_async(async_http_client)
            .await
            .map_err(|e| AppError::OAuth(format!("Token exchange failed: {:?}", e)))?;

        Ok(token)
    }

    /// Get Google user info
    pub async fn get_google_user_info(&self, access_token: &str) -> Result<GoogleUserInfo, AppError> {
        let response = self.http_client
            .get("https://www.googleapis.com/oauth2/v2/userinfo")
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| AppError::External(format!("Failed to get user info: {}", e)))?;

        if !response.status().is_success() {
            return Err(AppError::OAuth("Failed to get Google user info".to_string()));
        }

        let user_info: GoogleUserInfo = response.json().await
            .map_err(|e| AppError::External(format!("Failed to parse user info: {}", e)))?;

        Ok(user_info)
    }

    // ==================== Custom OIDC ====================

    /// Discover OIDC configuration from issuer URL
    pub async fn discover_oidc(&self) -> Result<OidcDiscovery, AppError> {
        let issuer_url = self.config.oidc_issuer_url.clone()
            .ok_or_else(|| AppError::Config("OIDC_ISSUER_URL not configured".to_string()))?;

        let discovery_url = format!("{}/.well-known/openid-configuration", issuer_url.trim_end_matches('/'));
        
        let response = self.http_client
            .get(&discovery_url)
            .send()
            .await
            .map_err(|e| AppError::External(format!("OIDC discovery failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(AppError::OAuth(format!("OIDC discovery failed with status: {}", response.status())));
        }

        let discovery: OidcDiscovery = response.json().await
            .map_err(|e| AppError::External(format!("Failed to parse OIDC discovery: {}", e)))?;

        Ok(discovery)
    }

    /// Create custom OIDC client
    async fn create_oidc_client(&self) -> Result<(BasicClient, OidcDiscovery), AppError> {
        let client_id = self.config.oidc_client_id.clone()
            .ok_or_else(|| AppError::Config("OIDC_CLIENT_ID not configured".to_string()))?;
        let client_secret = self.config.oidc_client_secret.clone()
            .ok_or_else(|| AppError::Config("OIDC_CLIENT_SECRET not configured".to_string()))?;

        let discovery = self.discover_oidc().await?;

        let redirect_url = format!("{}/api/auth/oidc/callback", self.config.oauth_redirect_url);

        let client = BasicClient::new(
            ClientId::new(client_id),
            Some(ClientSecret::new(client_secret)),
            AuthUrl::new(discovery.authorization_endpoint.clone())?,
            Some(TokenUrl::new(discovery.token_endpoint.clone())?),
        )
        .set_redirect_uri(RedirectUrl::new(redirect_url)?);

        Ok((client, discovery))
    }

    /// Get custom OIDC authorization URL
    pub async fn get_oidc_auth_url(&self) -> Result<(String, CsrfToken, PkceCodeVerifier), AppError> {
        let (client, _) = self.create_oidc_client().await?;
        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

        // Parse scopes from config
        let scopes: Vec<Scope> = self.config.oidc_scopes
            .split_whitespace()
            .map(|s| Scope::new(s.to_string()))
            .collect();

        let mut auth_request = client.authorize_url(CsrfToken::new_random);
        
        for scope in scopes {
            auth_request = auth_request.add_scope(scope);
        }

        let (auth_url, csrf_token) = auth_request
            .set_pkce_challenge(pkce_challenge)
            .url();

        Ok((auth_url.to_string(), csrf_token, pkce_verifier))
    }

    /// Exchange OIDC authorization code for tokens
    pub async fn exchange_oidc_code(
        &self,
        code: &str,
        pkce_verifier: PkceCodeVerifier,
    ) -> Result<oauth2::StandardTokenResponse<oauth2::EmptyExtraTokenFields, oauth2::basic::BasicTokenType>, AppError> {
        let (client, _) = self.create_oidc_client().await?;

        let token = client
            .exchange_code(AuthorizationCode::new(code.to_string()))
            .set_pkce_verifier(pkce_verifier)
            .request_async(async_http_client)
            .await
            .map_err(|e| AppError::OAuth(format!("OIDC token exchange failed: {:?}", e)))?;

        Ok(token)
    }

    /// Get OIDC user info
    pub async fn get_oidc_user_info(&self, access_token: &str) -> Result<OidcUserInfo, AppError> {
        let discovery = self.discover_oidc().await?;
        
        let userinfo_endpoint = discovery.userinfo_endpoint
            .ok_or_else(|| AppError::OAuth("OIDC userinfo endpoint not available".to_string()))?;

        let response = self.http_client
            .get(&userinfo_endpoint)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| AppError::External(format!("Failed to get OIDC user info: {}", e)))?;

        if !response.status().is_success() {
            return Err(AppError::OAuth("Failed to get OIDC user info".to_string()));
        }

        let user_info: OidcUserInfo = response.json().await
            .map_err(|e| AppError::External(format!("Failed to parse OIDC user info: {}", e)))?;

        Ok(user_info)
    }

    // ==================== PKCE Verifier Storage ====================

    /// Store PKCE verifier
    pub async fn store_pkce_verifier(&self, csrf_token: &str, verifier: &str) {
        let mut verifiers = self.pkce_verifiers.write().await;
        verifiers.insert(csrf_token.to_string(), verifier.to_string());
    }

    /// Get and remove PKCE verifier
    pub async fn get_pkce_verifier(&self, csrf_token: &str) -> Option<String> {
        let mut verifiers = self.pkce_verifiers.write().await;
        verifiers.remove(csrf_token)
    }

    // ==================== JWT ====================

    /// Create JWT token for user
    pub fn create_jwt(&self, user: &User) -> Result<String, AppError> {
        let now = Utc::now();
        let exp = now + Duration::hours(self.config.jwt_expiry_hours as i64);

        let claims = Claims {
            sub: user.id.clone(),
            email: user.email.clone(),
            exp: exp.timestamp() as usize,
            iat: now.timestamp() as usize,
            token_version: user.token_version,
        };

        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.config.jwt_secret.as_bytes()),
        ).map_err(|e| AppError::Internal(format!("Failed to create JWT: {}", e)))?;

        Ok(token)
    }

    /// Verify JWT token
    pub fn verify_jwt(&self, token: &str) -> Result<Claims, AppError> {
        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.config.jwt_secret.as_bytes()),
            &Validation::default(),
        ).map_err(|e| AppError::Unauthorized(format!("Invalid token: {}", e)))?;

        Ok(token_data.claims)
    }

    // ==================== User Management ====================

    /// Find or create user from OAuth info
    pub async fn find_or_create_user(
        &self,
        email: &str,
        name: Option<String>,
        avatar_url: Option<String>,
    ) -> Result<User, AppError> {
        let mut users = self.users.write().await;

        // Try to find existing user by email
        if let Some(user) = users.values().find(|u| u.email == email).cloned() {
            return Ok(user);
        }

        // Create new user
        let mut user = User::new(email.to_string(), name);
        user.avatar_url = avatar_url;
        users.insert(user.id.clone(), user.clone());
        
        // Sync to PocketBase
        drop(users); // Release lock before sync
        self.sync_user_to_pb(&user, None);

        tracing::info!("Created new user: {} ({})", user.id, user.email);
        Ok(user)
    }

    /// Get user by ID
    pub async fn get_user(&self, user_id: &str) -> Result<User, AppError> {
        let users = self.users.read().await;
        users.get(user_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("User {} not found", user_id)))
    }

    // ==================== Local Authentication ====================

    /// Find user by email for local login
    pub async fn find_user_by_email(&self, email: &str) -> Option<User> {
        let users = self.users.read().await;
        users.values().find(|u| u.email == email).cloned()
    }

    /// Register local user with password
    pub async fn register_local_user(
        &self,
        email: &str,
        password: &str,
        name: Option<String>,
        is_admin: bool,
    ) -> Result<User, AppError> {
        let mut users = self.users.write().await;
        
        // Check if email already exists
        if users.values().any(|u| u.email == email) {
            return Err(AppError::Conflict("Email already registered".to_string()));
        }
        
        // Hash password
        let password_hash = bcrypt::hash(password, bcrypt::DEFAULT_COST)
            .map_err(|e| AppError::Internal(format!("Failed to hash password: {}", e)))?;
        
        // Create new user with password
        let mut user = if is_admin {
            User::new_admin(email.to_string(), name)
        } else {
            User::new(email.to_string(), name)
        };
        user.local_password_hash = Some(password_hash);
        users.insert(user.id.clone(), user.clone());
        
        // Sync to PocketBase
        drop(users); // Release lock before sync
        self.sync_user_to_pb(&user, Some(password.to_string()));
        
        tracing::info!("Registered new local user: {} ({}) role: {}", user.id, user.email, user.role);
        Ok(user)
    }

    /// Verify local user password
    pub async fn verify_local_user(
        &self,
        email: &str,
        password: &str,
    ) -> Result<User, AppError> {
        let user_opt = self.find_user_by_email(email).await;
        
        // Strategy 1: If user exists and has local hash, try verifying against it locally
        if let Some(user) = &user_opt {
            if let Some(hash) = &user.local_password_hash {
                match bcrypt::verify(password, hash) {
                    Ok(true) => return Ok(user.clone()),
                    Ok(false) => {
                        // Password mismatch with local hash -> Might have changed in PB, try Strategy 2
                        tracing::debug!("Local hash verification failed for {}, trying PB fallback", email);
                    }
                    Err(e) => {
                        tracing::warn!("Bcrypt error for {}: {}", email, e);
                    }
                }
            }
        }

        // Strategy 2: Fallback to PocketBase auth (verifies against PB's internal hash)
        // This handles:
        // - Users created via OAuth who set a password later in PB
        // - Users who changed password in PB directly (local hash outdated)
        // - Users who don't have a local hash at all
        match self.verify_with_pocketbase(email, password).await {
            Ok(pb_user) => {
                // If we found a user locally but PB auth succeeded, return the local user
                // (to preserve any local fields/props) but formatted/updated
                if let Some(local_user) = user_opt {
                    // Ideally we should update the local hash here if we could get it, 
                    // but PB doesn't return the raw hash usually.
                    // We just return the authenticated user.
                    return Ok(local_user);
                } else {
                    // User existed in PB but not locally? This shouldn't happen if sync works,
                    // but we can trust PB's return.
                    // We should probably cache this user now.
                    let user = User {
                        id: pb_user.id.clone(),
                        email: pb_user.email,
                        name: pb_user.name,
                        avatar_url: pb_user.avatar_url,
                        role: pb_user.role,
                        local_password_hash: None, // We don't have the hash
                        created_at: chrono::Utc::now(),
                        updated_at: chrono::Utc::now(),
                        token_version: pb_user.token_version,
                    };
                    
                    let mut users = self.users.write().await;
                    users.insert(user.id.clone(), user.clone());
                    
                    return Ok(user);
                }
            }
            Err(e) => {
                // Both strategies failed
                tracing::warn!("Login failed for {}: {}", email, e);
                return Err(AppError::Unauthorized("Invalid email or password".to_string())); 
            }
        }
    }

    /// Logout from all devices (invalidates all tokens)
    pub async fn logout_all_devices(&self, user_id: &str) -> Result<(), AppError> {
        let mut users = self.users.write().await;
        
        let user = users.get_mut(user_id)
            .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;
        
        // Increment token version to invalidate all existing tokens
        user.token_version += 1;
        user.updated_at = chrono::Utc::now();
        let user_clone = user.clone();
        
        // Sync to PocketBase
        drop(users);
        self.sync_user_to_pb(&user_clone, None);
        
        tracing::info!("Logged out all devices for user {} (version: {})", user_id, user_clone.token_version);
        Ok(())
    }

    /// Change password and logout all other sessions
    pub async fn change_password(&self, user_id: &str, old_password: &str, new_password: &str) -> Result<(), AppError> {
        let mut users = self.users.write().await;
        
        let user = users.get_mut(user_id)
            .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;
        
        // Verify old password (locally or via PB) 
        // Note: For simplicity and security, we require local verification here if possible
        // Ideally we should reuse verify_local_user logic but focused on ID not email
        
        let is_valid = if let Some(hash) = &user.local_password_hash {
            bcrypt::verify(old_password, hash).unwrap_or(false)
        } else {
            // Fallback: This is tricky because we need to verify against PB
            // But verify_with_pocketbase uses email. 
            // We can assume if they are calling this API they are already authenticated via JWT
            // So we mostly need to verify they know the current password before changing it.
            // Let's defer to PB verification using their email.
            let user_email = user.email.clone();
            drop(users); // Release lock before async call
            let verify_result = self.verify_with_pocketbase(&user_email, old_password).await;
            users = self.users.write().await; // Re-acquire lock
            verify_result.is_ok()
        };

        if !is_valid {
             return Err(AppError::Unauthorized("Invalid old password".to_string()));
        }

        // Re-get user reference as lock was dropped
        let user = users.get_mut(user_id)
            .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

        // Hash new password
        let password_hash = bcrypt::hash(new_password, bcrypt::DEFAULT_COST)
            .map_err(|e| AppError::Internal(format!("Failed to hash password: {}", e)))?;
        
        user.local_password_hash = Some(password_hash);
        user.token_version += 1; // Invalidate all tokens (including current one will need refresh)
        user.updated_at = chrono::Utc::now();
        let user_clone = user.clone();
        
        // Sync to PocketBase
        drop(users);
        self.sync_user_to_pb(&user_clone, Some(new_password.to_string()));
        
        tracing::info!("Password changed for user {}", user_id);
        Ok(())
    }

    /// Verify user against PocketBase API directly
    async fn verify_with_pocketbase(&self, email: &str, password: &str) -> Result<User, AppError> {
        let url = format!("{}/api/collections/users/auth-with-password", self.pocketbase_url);
        
        #[derive(serde::Serialize)]
        struct AuthRequest<'a> {
            identity: &'a str,
            password: &'a str,
        }

        #[derive(serde::Deserialize)]
        struct AuthResponse {
            record: PBUserRecord,
        }

        #[derive(serde::Deserialize)]
        struct PBUserRecord {
            id: String,
            email: String,
            name: Option<String>,
            avatar: Option<String>, 
            #[serde(default = "default_user_role")]
            role: String,
            #[serde(default)]
            token_version: i32,
            // PB might use 'avatar' field name in record, mapped to avatar_url in our model
        }
        
        fn default_user_role() -> String {
            "user".to_string()
        }

        let resp = self.http_client.post(&url)
            .json(&AuthRequest { identity: email, password })
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to contact PocketBase: {}", e)))?;

        if resp.status().is_success() {
            let data = resp.json::<AuthResponse>().await
                .map_err(|e| AppError::Internal(format!("Failed to parse PB response: {}", e)))?;
            
            // Construct User model from PB record
            let avatar_url = data.record.avatar.map(|f| 
                format!("{}/api/files/users/{}/{}", self.pocketbase_url, data.record.id, f)
            );

            Ok(User {
                id: data.record.id,
                email: data.record.email,
                name: data.record.name,
                avatar_url,
                role: data.record.role,
                local_password_hash: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                token_version: data.record.token_version,
            })
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::warn!("⚠️ PocketBase auth failed. Status: {}, Body: {}", status, body);
            Err(AppError::Unauthorized("Invalid credentials in PocketBase".to_string()))
        }
    }

    /// Check if local auth is enabled
    pub fn is_local_auth_enabled(&self) -> bool {
        self.config.local_auth_enabled.unwrap_or(true)
    }

    /// Update user
    #[allow(dead_code)]
    pub async fn update_user(&self, user: User) -> Result<User, AppError> {
        let mut users = self.users.write().await;
        users.insert(user.id.clone(), user.clone());
        Ok(user)
    }

    // ==================== OAuth Account Linking ====================

    /// Link OAuth account to user
    pub async fn link_oauth_account(&self, account: OAuthAccount) -> Result<(), AppError> {
        let mut accounts = self.oauth_accounts.write().await;
        
        // Check if this OAuth account is already linked
        let existing_id = accounts.iter()
            .find(|(_, a)| a.provider == account.provider && a.provider_user_id == account.provider_user_id)
            .map(|(id, a)| (id.clone(), a.user_id.clone()));
        
        if let Some((existing_id, existing_user_id)) = existing_id {
            if existing_user_id != account.user_id {
                return Err(AppError::Conflict(
                    "This OAuth account is already linked to another user".to_string()
                ));
            }
            // Already linked to this user - update tokens by using the SAME existing ID
            let mut updated_account = account;
            updated_account.id = existing_id.clone();
            accounts.insert(existing_id, updated_account);
        } else {
            // New account - insert with new ID
            accounts.insert(account.id.clone(), account);
        }
        
        Ok(())
    }

    /// Unlink OAuth account
    pub async fn unlink_oauth_account(&self, user_id: &str, provider: &OAuthProvider) -> Result<(), AppError> {
        let mut accounts = self.oauth_accounts.write().await;
        
        let account_id = accounts.iter()
            .find(|(_, a)| a.user_id == user_id && &a.provider == provider)
            .map(|(id, _)| id.clone());
        
        match account_id {
            Some(id) => {
                accounts.remove(&id);
                Ok(())
            }
            None => Err(AppError::NotFound(
                format!("No {} account linked", provider)
            )),
        }
    }

    /// Get linked OAuth providers for user
    pub async fn get_linked_providers(&self, user_id: &str) -> Vec<LinkedProvider> {
        let accounts = self.oauth_accounts.read().await;
        accounts.values()
            .filter(|a| a.user_id == user_id)
            .map(LinkedProvider::from)
            .collect()
    }

    /// Find user by OAuth account
    #[allow(dead_code)]
    pub async fn find_user_by_oauth(
        &self,
        provider: &OAuthProvider,
        provider_user_id: &str,
    ) -> Option<String> {
        let accounts = self.oauth_accounts.read().await;
        accounts.values()
            .find(|a| &a.provider == provider && a.provider_user_id == provider_user_id)
            .map(|a| a.user_id.clone())
    }

    // ==================== Auth Response ====================

    /// Create auth response with JWT and user info
    #[allow(dead_code)]
    pub fn create_auth_response(&self, user: &User) -> Result<AuthResponse, AppError> {
        let token = self.create_jwt(user)?;
        Ok(AuthResponse {
            token,
            user: UserResponse::from(user),
        })
    }

    /// Get OIDC provider name from config
    pub fn get_oidc_provider_name(&self) -> String {
        self.config.oidc_provider_name.clone()
            .unwrap_or_else(|| "oidc".to_string())
    }

    /// Check if OIDC is configured
    pub fn is_oidc_configured(&self) -> bool {
        self.config.oidc_issuer_url.is_some()
            && self.config.oidc_client_id.is_some()
            && self.config.oidc_client_secret.is_some()
    }

    /// Check if Google OAuth is configured
    pub fn is_google_configured(&self) -> bool {
        self.config.google_client_id.is_some()
            && self.config.google_client_secret.is_some()
    }

    // ==================== Admin User Management ====================

    /// List all users (admin only)
    pub async fn list_all_users(&self) -> Vec<User> {
        let users = self.users.read().await;
        users.values().cloned().collect()
    }

    /// Update user by admin
    pub async fn update_user_admin(
        &self,
        user_id: &str,
        name: Option<String>,
        role: Option<String>,
    ) -> Result<User, AppError> {
        let mut users = self.users.write().await;
        
        let user = users.get_mut(user_id)
            .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;
        
        if let Some(new_name) = name {
            user.name = Some(new_name);
        }
        
        if let Some(new_role) = role {
            user.role = new_role;
        }
        
        user.updated_at = chrono::Utc::now();
        let user_clone = user.clone();
        
        // Sync to PocketBase
        drop(users);
        self.sync_user_to_pb(&user_clone, None);
        
        Ok(user_clone)
    }

    /// Reset user password (admin only)
    pub async fn reset_user_password(&self, user_id: &str, new_password: &str) -> Result<(), AppError> {
        let password_hash = bcrypt::hash(new_password, bcrypt::DEFAULT_COST)
            .map_err(|e| AppError::Internal(format!("Failed to hash password: {}", e)))?;
        
        let mut users = self.users.write().await;
        
        let user = users.get_mut(user_id)
            .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;
        
        user.local_password_hash = Some(password_hash);
        user.updated_at = chrono::Utc::now();
        let user_clone = user.clone();
        
        // Sync to PocketBase
        drop(users);
        self.sync_user_to_pb(&user_clone, Some(new_password.to_string()));
        
        tracing::info!("Password reset for user {}", user_id);
        Ok(())
    }

    /// Delete user (admin only)
    pub async fn delete_user(&self, user_id: &str) -> Result<(), AppError> {
        let mut users = self.users.write().await;
        
        if users.remove(user_id).is_none() {
            return Err(AppError::NotFound("User not found".to_string()));
        }
        
        // Also remove OAuth accounts
        let mut accounts = self.oauth_accounts.write().await;
        accounts.retain(|_, acc| acc.user_id != user_id);
        
        // Delete from PocketBase
        drop(users);
        drop(accounts);
        self.delete_user_from_pb(user_id);
        
        tracing::info!("Deleted user {}", user_id);
        Ok(())
    }

    /// Delete user from PocketBase
    fn delete_user_from_pb(&self, user_id: &str) {
        let url = format!("{}/api/collections/users/records/{}", self.pocketbase_url, user_id);
        let client = self.http_client.clone();
        let user_id_owned = user_id.to_string();
        
        tokio::spawn(async move {
            match client.delete(&url).send().await {
                Ok(response) => {
                    if response.status().is_success() {
                        tracing::debug!("🗑️ Deleted user from PocketBase: {}", user_id_owned);
                    } else {
                        tracing::warn!("⚠️ Failed to delete user from PocketBase: {}", response.status());
                    }
                }
                Err(e) => {
                    tracing::warn!("⚠️ Failed to delete user from PocketBase: {}", e);
                }
            }
        });
    }
}
