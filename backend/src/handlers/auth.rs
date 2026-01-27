use axum::{
    extract::{Query, State, Path},
    http::{StatusCode, HeaderMap},
    response::{IntoResponse, Redirect},
    Json,
};
use axum_extra::extract::cookie::{Cookie, CookieJar};
use oauth2::{PkceCodeVerifier, TokenResponse};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::{User, UserResponse, OAuthAccount, OAuthProvider, LinkedProvider, AuthResponse};
use crate::services::auth::OAuthCallbackParams;
use crate::AppState;

const AUTH_COOKIE_NAME: &str = "auth_token";

/// Query params for OAuth login (optional redirect_uri for apps)
#[derive(Debug, Deserialize)]
pub struct OAuthLoginParams {
    pub redirect_uri: Option<String>,
}

/// Available auth providers response
#[derive(Debug, Serialize)]
pub struct AuthProvidersResponse {
    pub google: bool,
    pub oidc: Option<OidcProviderInfo>,
    pub local: bool,
}

#[derive(Debug, Serialize)]
pub struct OidcProviderInfo {
    pub name: String,
    pub enabled: bool,
}

/// GET /api/auth/providers - Get available auth providers
pub async fn get_available_providers(
    State(state): State<AppState>,
) -> Json<AuthProvidersResponse> {
    let auth = &state.auth_service;
    Json(AuthProvidersResponse {
        google: auth.is_google_configured(),
        oidc: if auth.is_oidc_configured() {
            Some(OidcProviderInfo {
                name: auth.get_oidc_provider_name(),
                enabled: true,
            })
        } else {
            None
        },
        local: auth.is_local_auth_enabled(),
    })
}

// ==================== Local Authentication ====================

/// POST /api/auth/local/login - Login with email/password
pub async fn local_login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<crate::models::LocalAuthRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = &state.auth_service;
    
    if !auth.is_local_auth_enabled() {
        return Err(AppError::BadRequest("Local authentication is disabled".to_string()));
    }
    
    // Verify credentials
    let user = auth.verify_local_user(&req.email, &req.password).await?;
    
    // Create JWT
    let jwt = auth.create_jwt(&user)?;
    
    // Set cookie
    let cookie = Cookie::build((AUTH_COOKIE_NAME, jwt.clone()))
        .path("/")
        .http_only(true)
        .secure(false)
        .max_age(time::Duration::days(1))
        .build();
    
    Ok((
        jar.add(cookie),
        Json(AuthResponse {
            token: jwt,
            user: UserResponse::from(&user),
        }),
    ))
}

/// POST /api/auth/local/register - Register new local user
pub async fn local_register(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<crate::models::LocalAuthRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = &state.auth_service;
    
    if !auth.is_local_auth_enabled() {
        return Err(AppError::BadRequest("Local authentication is disabled".to_string()));
    }
    
    // Validate email format
    if !req.email.contains('@') {
        return Err(AppError::BadRequest("Invalid email format".to_string()));
    }
    
    // Validate password length
    if req.password.len() < 6 {
        return Err(AppError::BadRequest("Password must be at least 6 characters".to_string()));
    }
    
    // Register user (new registrations are always regular users, not admins)
    let user = auth.register_local_user(&req.email, &req.password, req.name.clone(), false).await?;
    
    // Create JWT
    let jwt = auth.create_jwt(&user)?;
    
    // Set cookie
    let cookie = Cookie::build((AUTH_COOKIE_NAME, jwt.clone()))
        .path("/")
        .http_only(true)
        .secure(false)
        .max_age(time::Duration::days(1))
        .build();
    
    Ok((
        StatusCode::CREATED,
        jar.add(cookie),
        Json(AuthResponse {
            token: jwt,
            user: UserResponse::from(&user),
        }),
    ))
}

// ==================== Google OAuth ====================


/// GET /api/auth/google - Redirect to Google OAuth
pub async fn google_login(
    Query(params): Query<OAuthLoginParams>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let auth = &state.auth_service;
    
    let (auth_url, csrf_token, pkce_verifier) = auth.get_google_auth_url()?;
    
    // Store PKCE verifier and optional redirect_uri for callback
    let verifier_with_redirect = match params.redirect_uri {
        Some(uri) => format!("{}|{}", pkce_verifier.secret(), uri),
        None => pkce_verifier.secret().to_string(),
    };
    auth.store_pkce_verifier(csrf_token.secret(), &verifier_with_redirect).await;
    
    Ok(Redirect::to(&auth_url))
}

/// GET /api/auth/google/callback - Handle Google OAuth callback
pub async fn google_callback(
    Query(params): Query<OAuthCallbackParams>,
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<impl IntoResponse, AppError> {
    let auth = &state.auth_service;
    
    // Get PKCE verifier (may contain redirect_uri)
    let verifier_data = auth.get_pkce_verifier(&params.state).await
        .ok_or_else(|| AppError::OAuth("Invalid state parameter".to_string()))?;
    
    let (verifier_secret, custom_redirect) = if verifier_data.contains('|') {
        let parts: Vec<&str> = verifier_data.splitn(2, '|').collect();
        (parts[0].to_string(), Some(parts[1].to_string()))
    } else {
        (verifier_data, None)
    };
    let pkce_verifier = PkceCodeVerifier::new(verifier_secret);
    
    // Exchange code for token
    let token_response = auth.exchange_google_code(&params.code, pkce_verifier).await?;
    let access_token = token_response.access_token().secret();
    
    // Get user info
    let user_info = auth.get_google_user_info(access_token).await?;
    
    // Find or create user
    let user = auth.find_or_create_user(
        &user_info.email,
        user_info.name.clone(),
        user_info.picture.clone(),
    ).await?;
    
    // Link OAuth account
    let oauth_account = OAuthAccount::new(
        user.id.clone(),
        OAuthProvider::Google,
        user_info.id.clone(),
        user_info.email.clone(),
        access_token.to_string(),
        token_response.refresh_token().map(|t| t.secret().to_string()),
        None,
    );
    auth.link_oauth_account(oauth_account).await?;
    
    // Create JWT
    let jwt = auth.create_jwt(&user)?;
    
    // Set cookie and redirect to frontend or custom redirect_uri
    let cookie = Cookie::build((AUTH_COOKIE_NAME, jwt.clone()))
        .path("/")
        .http_only(true)
        .secure(false) // Set to true in production with HTTPS
        .max_age(time::Duration::days(1))
        .build();
    
    let redirect_url = format!(
        "{}?token={}",
        custom_redirect.unwrap_or_else(|| state.config.frontend_url.clone()),
        urlencoding::encode(&jwt)
    );
    
    Ok((jar.add(cookie), Redirect::to(&redirect_url)))
}

// ==================== Custom OIDC ====================

/// GET /api/auth/oidc - Redirect to custom OIDC provider
pub async fn oidc_login(
    Query(params): Query<OAuthLoginParams>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let auth = &state.auth_service;
    
    let (auth_url, csrf_token, pkce_verifier) = auth.get_oidc_auth_url().await?;
    
    // Store PKCE verifier and optional redirect_uri for callback
    let verifier_with_redirect = match params.redirect_uri {
        Some(uri) => format!("{}|{}", pkce_verifier.secret(), uri),
        None => pkce_verifier.secret().to_string(),
    };
    auth.store_pkce_verifier(csrf_token.secret(), &verifier_with_redirect).await;
    
    Ok(Redirect::to(&auth_url))
}

/// GET /api/auth/oidc/callback - Handle OIDC callback
pub async fn oidc_callback(
    Query(params): Query<OAuthCallbackParams>,
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<impl IntoResponse, AppError> {
    let auth = &state.auth_service;
    
    // Get PKCE verifier (may contain redirect_uri)
    let verifier_data = auth.get_pkce_verifier(&params.state).await
        .ok_or_else(|| AppError::OAuth("Invalid state parameter".to_string()))?;
    
    let (verifier_secret, custom_redirect) = if verifier_data.contains('|') {
        let parts: Vec<&str> = verifier_data.splitn(2, '|').collect();
        (parts[0].to_string(), Some(parts[1].to_string()))
    } else {
        (verifier_data, None)
    };
    let pkce_verifier = PkceCodeVerifier::new(verifier_secret);
    
    // Exchange code for token
    let token_response = auth.exchange_oidc_code(&params.code, pkce_verifier).await?;
    let access_token = token_response.access_token().secret();
    
    // Get user info
    let user_info = auth.get_oidc_user_info(access_token).await?;
    
    // Get email (required)
    let email = user_info.email
        .ok_or_else(|| AppError::OAuth("Email not provided by OIDC provider".to_string()))?;
    
    // Find or create user
    let user = auth.find_or_create_user(
        &email,
        user_info.name.or(user_info.preferred_username),
        user_info.picture,
    ).await?;
    
    // Get provider name for account linking
    let provider_name = auth.get_oidc_provider_name();
    
    // Link OAuth account
    let oauth_account = OAuthAccount::new(
        user.id.clone(),
        OAuthProvider::Custom(provider_name),
        user_info.sub.clone(),
        email.clone(),
        access_token.to_string(),
        token_response.refresh_token().map(|t| t.secret().to_string()),
        None,
    );
    auth.link_oauth_account(oauth_account).await?;
    
    // Create JWT
    let jwt = auth.create_jwt(&user)?;
    
    // Set cookie and redirect to frontend or custom redirect_uri
    let cookie = Cookie::build((AUTH_COOKIE_NAME, jwt.clone()))
        .path("/")
        .http_only(true)
        .secure(false) // Set to true in production with HTTPS
        .max_age(time::Duration::days(1))
        .build();
    
    let redirect_url = format!(
        "{}?token={}",
        custom_redirect.unwrap_or_else(|| state.config.frontend_url.clone()),
        urlencoding::encode(&jwt)
    );
    
    Ok((jar.add(cookie), Redirect::to(&redirect_url)))
}

// ==================== User & Session Management ====================

/// GET /api/auth/me - Get current user info
pub async fn get_current_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
) -> Result<Json<UserResponse>, AppError> {
    let user = extract_user(&state, &jar, &headers).await?;
    Ok(Json(UserResponse::from(&user)))
}

/// POST /api/auth/logout - Logout and clear session
pub async fn logout(
    jar: CookieJar,
) -> impl IntoResponse {
    let cookie = Cookie::build((AUTH_COOKIE_NAME, ""))
        .path("/")
        .http_only(true)
        .max_age(time::Duration::seconds(0))
        .build();
    
    (jar.remove(cookie), Json(serde_json::json!({"message": "Logged out"})))
}

/// GET /api/auth/linked-providers - Get linked OAuth providers for current user
pub async fn get_linked_providers(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
) -> Result<Json<Vec<LinkedProvider>>, AppError> {
    let user = extract_user(&state, &jar, &headers).await?;
    let providers = state.auth_service.get_linked_providers(&user.id).await;
    Ok(Json(providers))
}

/// DELETE /api/auth/unlink/:provider - Unlink OAuth provider
pub async fn unlink_provider(
    Path(provider): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = extract_user(&state, &jar, &headers).await?;
    
    let provider_enum: OAuthProvider = provider.parse()
        .map_err(|e: String| AppError::BadRequest(e))?;
    
    state.auth_service.unlink_oauth_account(&user.id, &provider_enum).await?;
    
    Ok(Json(serde_json::json!({"message": format!("Unlinked {}", provider)})))
}

/// POST /api/auth/logout-all - Logout from all devices
pub async fn logout_all_devices(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
) -> Result<impl IntoResponse, AppError> {
    let user = extract_user(&state, &jar, &headers).await?;
    
    state.auth_service.logout_all_devices(&user.id).await?;
    
    // Also clear current cookie
    let cookie = Cookie::build((AUTH_COOKIE_NAME, ""))
        .path("/")
        .http_only(true)
        .max_age(time::Duration::seconds(0))
        .build();
    
    Ok((jar.remove(cookie), Json(serde_json::json!({"message": "Logged out from all devices"}))))
}

/// POST /api/auth/change-password - Change password and logout all sessions
#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
}

pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<impl IntoResponse, AppError> {
    let user = extract_user(&state, &jar, &headers).await?;
    
    state.auth_service.change_password(&user.id, &req.old_password, &req.new_password).await?;
    
    // Clear current cookie (user needs to login again with new password)
    let cookie = Cookie::build((AUTH_COOKIE_NAME, ""))
        .path("/")
        .http_only(true)
        .max_age(time::Duration::seconds(0))
        .build();
        
    Ok((jar.remove(cookie), Json(serde_json::json!({"message": "Password changed successfully"}))))
}

// ==================== Token Validation ====================

/// POST /api/auth/verify - Verify JWT token
#[derive(Debug, Deserialize)]
pub struct VerifyTokenRequest {
    pub token: String,
}

pub async fn verify_token(
    State(state): State<AppState>,
    Json(req): Json<VerifyTokenRequest>,
) -> Result<Json<UserResponse>, AppError> {
    let claims = state.auth_service.verify_jwt(&req.token)?;
    let user = state.auth_service.get_user(&claims.sub).await?;

    // Check token version
    if claims.token_version != user.token_version {
         return Err(AppError::Unauthorized("Token expired (version mismatch)".to_string()));
    }
    
    Ok(Json(UserResponse::from(&user)))
}

// ==================== Helper Functions ====================

/// Extract user from cookie or Authorization header
async fn extract_user(state: &AppState, jar: &CookieJar, headers: &axum::http::HeaderMap) -> Result<User, AppError> {
    // Try Authorization header first
    if let Some(auth_header) = headers.get("Authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if auth_str.starts_with("Bearer ") {
                let token = &auth_str[7..];
                let claims = state.auth_service.verify_jwt(token)?;
                let user = state.auth_service.get_user(&claims.sub).await?;
                
                // Check token version
                if claims.token_version != user.token_version {
                     return Err(AppError::Unauthorized("Token expired (version mismatch)".to_string()));
                }
                return Ok(user);
            }
        }
    }

    // Fallback to Cookie
    let cookie = jar.get(AUTH_COOKIE_NAME)
        .ok_or_else(|| AppError::Unauthorized("No auth token found in Header or Cookie".to_string()))?;
    
    let claims = state.auth_service.verify_jwt(cookie.value())?;
    let user = state.auth_service.get_user(&claims.sub).await?;
    
    // Check token version
    if claims.token_version != user.token_version {
         return Err(AppError::Unauthorized("Token expired (version mismatch)".to_string()));
    }

    Ok(user)
}
