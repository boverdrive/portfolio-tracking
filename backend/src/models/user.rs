use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// OAuth provider types - supports both well-known and custom OIDC providers
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum OAuthProvider {
    Google,
    GitHub,
    Line,
    /// Custom OIDC provider (e.g., PocketID, Keycloak, Auth0)
    #[serde(rename = "custom")]
    Custom(String),
}

impl OAuthProvider {
    /// Create a custom OIDC provider
    pub fn custom(name: &str) -> Self {
        OAuthProvider::Custom(name.to_lowercase())
    }
    
    /// Check if this is a specific custom provider
    pub fn is_custom(&self, name: &str) -> bool {
        matches!(self, OAuthProvider::Custom(n) if n.to_lowercase() == name.to_lowercase())
    }
}

impl std::fmt::Display for OAuthProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OAuthProvider::Google => write!(f, "google"),
            OAuthProvider::GitHub => write!(f, "github"),
            OAuthProvider::Line => write!(f, "line"),
            OAuthProvider::Custom(name) => write!(f, "{}", name),
        }
    }
}

impl std::str::FromStr for OAuthProvider {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "google" => Ok(OAuthProvider::Google),
            "github" => Ok(OAuthProvider::GitHub),
            "line" => Ok(OAuthProvider::Line),
            // Any other string is treated as a custom OIDC provider
            other => Ok(OAuthProvider::Custom(other.to_string())),
        }
    }
}

/// User struct for storing user data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    /// User role: "admin" or "user"
    pub role: String,
    /// Hashed password for local login (optional)
    #[serde(skip_serializing)]
    pub local_password_hash: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Generate a PocketBase compatible ID (15 chars, a-z0-9)
fn generate_pb_id() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::rng();
    (0..15)
        .map(|_| {
            let idx = rng.random_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

impl User {
    pub fn new(email: String, name: Option<String>) -> Self {
        let now = Utc::now();
        Self {
            id: generate_pb_id(), // Use PocketBase compatible ID
            email,
            name,
            avatar_url: None,
            role: "user".to_string(), // Default role
            local_password_hash: None,
            created_at: now,
            updated_at: now,
        }
    }
    
    pub fn new_admin(email: String, name: Option<String>) -> Self {
        let mut user = Self::new(email, name);
        user.role = "admin".to_string();
        user
    }
    
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }
}

/// Public user response (without sensitive data)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserResponse {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String,
    pub has_local_password: bool,
    pub created_at: DateTime<Utc>,
}

impl From<&User> for UserResponse {
    fn from(user: &User) -> Self {
        Self {
            id: user.id.clone(),
            email: user.email.clone(),
            name: user.name.clone(),
            avatar_url: user.avatar_url.clone(),
            role: user.role.clone(),
            has_local_password: user.local_password_hash.is_some(),
            created_at: user.created_at,
        }
    }
}

/// OAuth account linked to a user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthAccount {
    pub id: String,
    pub user_id: String,
    pub provider: OAuthProvider,
    pub provider_user_id: String,
    pub provider_email: String,
    #[serde(skip_serializing)]
    pub access_token: String,
    #[serde(skip_serializing)]
    pub refresh_token: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl OAuthAccount {
    pub fn new(
        user_id: String,
        provider: OAuthProvider,
        provider_user_id: String,
        provider_email: String,
        access_token: String,
        refresh_token: Option<String>,
        expires_at: Option<DateTime<Utc>>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            user_id,
            provider,
            provider_user_id,
            provider_email,
            access_token,
            refresh_token,
            expires_at,
            created_at: Utc::now(),
        }
    }
}

/// Linked provider info for API response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedProvider {
    pub provider: OAuthProvider,
    pub email: String,
    pub linked_at: DateTime<Utc>,
}

impl From<&OAuthAccount> for LinkedProvider {
    fn from(account: &OAuthAccount) -> Self {
        Self {
            provider: account.provider.clone(),
            email: account.provider_email.clone(),
            linked_at: account.created_at,
        }
    }
}

/// JWT Claims
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject (user_id)
    pub sub: String,
    /// Email
    pub email: String,
    /// Expiration time (as UTC timestamp)
    pub exp: usize,
    /// Issued at (as UTC timestamp)
    pub iat: usize,
}

/// Google user info from OAuth
#[derive(Debug, Clone, Deserialize)]
pub struct GoogleUserInfo {
    pub id: String,
    pub email: String,
    pub verified_email: Option<bool>,
    pub name: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub picture: Option<String>,
}

/// Login/Register request for local auth
#[derive(Debug, Clone, Deserialize)]
pub struct LocalAuthRequest {
    pub email: String,
    pub password: String,
    pub name: Option<String>,
}

/// Auth response with token
#[derive(Debug, Clone, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserResponse,
}
