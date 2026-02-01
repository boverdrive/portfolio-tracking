use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Alert Rule - defines when and how to trigger notifications
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub alert_type: AlertType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    pub threshold: f64,
    pub comparison: Comparison,
    pub channels: Vec<NotificationChannel>,
    pub is_active: bool,
    pub cooldown_minutes: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_triggered: Option<DateTime<Utc>>,
    pub created: DateTime<Utc>,
    pub updated: DateTime<Utc>,
}

/// Types of alerts supported
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AlertType {
    PriceAbove,
    PriceBelow,
    PnlThresholdPercent,
    PnlThresholdAbsolute,
    PortfolioChangePercent,
    DailyPnlReport,
}

impl std::fmt::Display for AlertType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AlertType::PriceAbove => write!(f, "price_above"),
            AlertType::PriceBelow => write!(f, "price_below"),
            AlertType::PnlThresholdPercent => write!(f, "pnl_threshold_percent"),
            AlertType::PnlThresholdAbsolute => write!(f, "pnl_threshold_absolute"),
            AlertType::PortfolioChangePercent => write!(f, "portfolio_change_percent"),
            AlertType::DailyPnlReport => write!(f, "daily_pnl_report"),
        }
    }
}

impl std::str::FromStr for AlertType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "price_above" => Ok(AlertType::PriceAbove),
            "price_below" => Ok(AlertType::PriceBelow),
            "pnl_threshold_percent" => Ok(AlertType::PnlThresholdPercent),
            "pnl_threshold_absolute" => Ok(AlertType::PnlThresholdAbsolute),
            "portfolio_change_percent" => Ok(AlertType::PortfolioChangePercent),
            "daily_pnl_report" => Ok(AlertType::DailyPnlReport),
            _ => Err(format!("Unknown alert type: {}", s)),
        }
    }
}

/// Comparison operators for alert conditions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Comparison {
    Above,
    Below,
    Equals,
}

impl std::fmt::Display for Comparison {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Comparison::Above => write!(f, "above"),
            Comparison::Below => write!(f, "below"),
            Comparison::Equals => write!(f, "equals"),
        }
    }
}

impl std::str::FromStr for Comparison {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "above" => Ok(Comparison::Above),
            "below" => Ok(Comparison::Below),
            "equals" => Ok(Comparison::Equals),
            _ => Err(format!("Unknown comparison: {}", s)),
        }
    }
}

/// Notification delivery channels
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NotificationChannel {
    Email,
    WebPush,
    InApp,
}

impl std::fmt::Display for NotificationChannel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NotificationChannel::Email => write!(f, "email"),
            NotificationChannel::WebPush => write!(f, "web_push"),
            NotificationChannel::InApp => write!(f, "in_app"),
        }
    }
}

impl std::str::FromStr for NotificationChannel {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "email" => Ok(NotificationChannel::Email),
            "web_push" => Ok(NotificationChannel::WebPush),
            "in_app" => Ok(NotificationChannel::InApp),
            _ => Err(format!("Unknown channel: {}", s)),
        }
    }
}

/// Alert trigger history record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertHistory {
    pub id: String,
    pub alert_id: String,
    pub user_id: String,
    pub triggered_at: DateTime<Utc>,
    pub message: String,
    pub channels_sent: Vec<NotificationChannel>,
    pub value_at_trigger: f64,
}

/// In-app notification record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub body: String,
    pub notification_type: NotificationType,
    pub is_read: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    pub created: DateTime<Utc>,
}

/// Types of in-app notifications
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NotificationType {
    Alert,
    Info,
    System,
    Warning,
}

impl std::fmt::Display for NotificationType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NotificationType::Alert => write!(f, "alert"),
            NotificationType::Info => write!(f, "info"),
            NotificationType::System => write!(f, "system"),
            NotificationType::Warning => write!(f, "warning"),
        }
    }
}

/// Web Push subscription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushSubscription {
    pub id: String,
    pub user_id: String,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub created: DateTime<Utc>,
}

// ==================== Request/Response Types ====================

#[derive(Debug, Deserialize)]
pub struct CreateAlertRequest {
    pub name: String,
    pub alert_type: AlertType,
    #[serde(default)]
    pub symbol: Option<String>,
    pub threshold: f64,
    pub comparison: Comparison,
    pub channels: Vec<NotificationChannel>,
    #[serde(default = "default_cooldown")]
    pub cooldown_minutes: i32,
}

fn default_cooldown() -> i32 {
    60 // 1 hour default cooldown
}

#[derive(Debug, Deserialize)]
pub struct UpdateAlertRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparison: Option<Comparison>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channels: Option<Vec<NotificationChannel>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooldown_minutes: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct SubscribePushRequest {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}
