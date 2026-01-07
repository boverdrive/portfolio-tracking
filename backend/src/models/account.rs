use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use rand::Rng;

/// Generate a PocketBase compatible ID (15 chars, a-z0-9)
fn generate_pb_id() -> String {
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::rng();
    (0..15)
        .map(|_| {
            let idx = rng.random_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

/// Account for grouping transactions
/// e.g., "Savings Account", "Investment Account"
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub user_id: String,  // Owner of this account
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_value: Option<f64>,
    #[serde(default = "default_currency")]
    pub target_currency: String,
    #[serde(default)]
    pub rank: i32,
    #[serde(default, skip_serializing)]
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing)]
    pub updated_at: DateTime<Utc>,
    // PocketBase fields
    #[serde(default, skip_serializing)]
    pub created: Option<String>,
    #[serde(default, skip_serializing)]
    pub updated: Option<String>,
}

fn default_currency() -> String {
    "THB".to_string()
}

#[derive(Debug, Deserialize)]
pub struct CreateAccountRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub target_value: Option<f64>,
    #[serde(default = "default_currency")]
    pub target_currency: String,
    #[serde(default)]
    pub rank: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAccountRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
    pub target_value: Option<f64>,
    pub target_currency: Option<String>,
    pub rank: Option<i32>,
}

impl Default for Account {
    fn default() -> Self {
        let now = Utc::now();
        Self {
            id: String::new(),
            user_id: String::new(),
            name: String::new(),
            description: None,
            color: None,
            target_value: None,
            target_currency: "THB".to_string(),
            rank: 0,
            created_at: now,
            updated_at: now,
            created: None,
            updated: None,
        }
    }
}

impl Account {
    pub fn new(req: CreateAccountRequest) -> Self {
        Self::new_with_user(req, String::new())
    }

    pub fn new_with_user(req: CreateAccountRequest, user_id: String) -> Self {
        let now = Utc::now();
        Self {
            id: generate_pb_id(),
            user_id,
            name: req.name,
            description: req.description,
            color: req.color,
            target_value: req.target_value,
            target_currency: req.target_currency,
            rank: req.rank.unwrap_or(0),
            created_at: now,
            updated_at: now,
            created: None,
            updated: None,
        }
    }
}
