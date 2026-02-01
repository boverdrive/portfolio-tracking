use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc, Duration};

use crate::config::Config;
use crate::error::AppError;
use crate::models::{
    AlertRule, AlertType, Comparison, NotificationChannel,
    CreateAlertRequest, UpdateAlertRequest,
};
use crate::services::{PocketBaseClient, NotificationService, PriceService};

/// Alert service for managing alert rules and evaluation
#[derive(Clone)]
pub struct AlertService {
    pb_client: PocketBaseClient,
    notification_service: NotificationService,
    price_service: PriceService,
    config: Config,
    // In-memory cache of alerts
    alerts_cache: Arc<RwLock<HashMap<String, AlertRule>>>,
}

impl AlertService {
    pub fn new(
        config: Config,
        pb_client: PocketBaseClient,
        notification_service: NotificationService,
        price_service: PriceService,
    ) -> Self {
        Self {
            pb_client,
            notification_service,
            price_service,
            config,
            alerts_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Initialize - load alerts from PocketBase
    pub async fn initialize(&self) -> Result<(), AppError> {
        let alerts = self.load_alerts_from_db().await?;
        let mut cache = self.alerts_cache.write().await;
        for alert in alerts {
            cache.insert(alert.id.clone(), alert);
        }
        tracing::info!("Loaded {} alerts from database", cache.len());
        Ok(())
    }

    /// Load all alerts from PocketBase
    async fn load_alerts_from_db(&self) -> Result<Vec<AlertRule>, AppError> {
        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/alerts/records?perPage=500", self.config.pocketbase_url);

        let client = reqwest::Client::new();
        let response = client
            .get(&url)
            .header("Authorization", token)
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                #[derive(serde::Deserialize)]
                struct ListResponse {
                    items: Vec<serde_json::Value>,
                }
                
                let data: ListResponse = resp.json().await.unwrap_or(ListResponse { items: vec![] });
                let alerts: Vec<AlertRule> = data.items
                    .into_iter()
                    .filter_map(|item| self.parse_alert_from_pb(&item))
                    .collect();
                Ok(alerts)
            }
            _ => Ok(vec![]), // Return empty if collection doesn't exist
        }
    }

    /// Parse AlertRule from PocketBase JSON
    fn parse_alert_from_pb(&self, item: &serde_json::Value) -> Option<AlertRule> {
        let alert_type_str = item.get("alert_type")?.as_str()?;
        let comparison_str = item.get("comparison")?.as_str()?;
        
        let channels: Vec<NotificationChannel> = item.get("channels")
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .filter_map(|s| s.parse().ok())
                    .collect()
            })
            .unwrap_or_else(|| vec![NotificationChannel::InApp]);

        Some(AlertRule {
            id: item.get("id")?.as_str()?.to_string(),
            user_id: item.get("user_id")?.as_str()?.to_string(),
            name: item.get("name")?.as_str()?.to_string(),
            alert_type: alert_type_str.parse().ok()?,
            symbol: item.get("symbol").and_then(|s| s.as_str()).map(|s| s.to_string()),
            threshold: item.get("threshold")?.as_f64()?,
            comparison: comparison_str.parse().ok()?,
            channels,
            is_active: item.get("is_active").and_then(|b| b.as_bool()).unwrap_or(true),
            cooldown_minutes: item.get("cooldown_minutes").and_then(|n| n.as_i64()).unwrap_or(60) as i32,
            last_triggered: item.get("last_triggered")
                .and_then(|s| s.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc)),
            created: Utc::now(),
            updated: Utc::now(),
        })
    }

    // ==================== CRUD Operations ====================

    /// Create a new alert rule
    pub async fn create_alert(
        &self,
        user_id: &str,
        req: CreateAlertRequest,
    ) -> Result<AlertRule, AppError> {
        let alert = AlertRule {
            id: uuid::Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            name: req.name,
            alert_type: req.alert_type,
            symbol: req.symbol,
            threshold: req.threshold,
            comparison: req.comparison,
            channels: req.channels,
            is_active: true,
            cooldown_minutes: req.cooldown_minutes,
            last_triggered: None,
            created: Utc::now(),
            updated: Utc::now(),
        };

        // Save to PocketBase
        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/alerts/records", self.config.pocketbase_url);

        let channels_str: Vec<String> = alert.channels.iter().map(|c| c.to_string()).collect();

        let client = reqwest::Client::new();
        let response = client
            .post(&url)
            .header("Authorization", token)
            .json(&serde_json::json!({
                "user_id": alert.user_id,
                "name": alert.name,
                "alert_type": alert.alert_type.to_string(),
                "symbol": alert.symbol,
                "threshold": alert.threshold,
                "comparison": alert.comparison.to_string(),
                "channels": channels_str,
                "is_active": alert.is_active,
                "cooldown_minutes": alert.cooldown_minutes,
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to create alert: {}", e)))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!("PocketBase error: {}", error_text)));
        }

        // Parse response to get the actual ID from PocketBase
        let pb_response: serde_json::Value = response.json().await
            .map_err(|e| AppError::Internal(format!("Failed to parse response: {}", e)))?;
        
        let mut alert = alert;
        if let Some(id) = pb_response.get("id").and_then(|v| v.as_str()) {
            alert.id = id.to_string();
        }

        // Add to cache
        let mut cache = self.alerts_cache.write().await;
        cache.insert(alert.id.clone(), alert.clone());

        tracing::info!("Created alert '{}' for user {}", alert.name, user_id);
        Ok(alert)
    }

    /// Get all alerts for a user
    pub async fn get_user_alerts(&self, user_id: &str) -> Result<Vec<AlertRule>, AppError> {
        let cache = self.alerts_cache.read().await;
        let alerts: Vec<AlertRule> = cache
            .values()
            .filter(|a| a.user_id == user_id)
            .cloned()
            .collect();
        Ok(alerts)
    }

    /// Get a specific alert
    pub async fn get_alert(&self, alert_id: &str) -> Option<AlertRule> {
        let cache = self.alerts_cache.read().await;
        cache.get(alert_id).cloned()
    }

    /// Update an alert
    pub async fn update_alert(
        &self,
        alert_id: &str,
        user_id: &str,
        req: UpdateAlertRequest,
    ) -> Result<AlertRule, AppError> {
        let mut cache = self.alerts_cache.write().await;
        
        let alert = cache.get_mut(alert_id)
            .ok_or_else(|| AppError::NotFound(format!("Alert {} not found", alert_id)))?;

        // Verify ownership
        if alert.user_id != user_id {
            return Err(AppError::Unauthorized("Not authorized to update this alert".into()));
        }

        // Apply updates
        if let Some(name) = req.name {
            alert.name = name;
        }
        if let Some(threshold) = req.threshold {
            alert.threshold = threshold;
        }
        if let Some(comparison) = req.comparison {
            alert.comparison = comparison;
        }
        if let Some(channels) = req.channels {
            alert.channels = channels;
        }
        if let Some(is_active) = req.is_active {
            alert.is_active = is_active;
        }
        if let Some(cooldown_minutes) = req.cooldown_minutes {
            alert.cooldown_minutes = cooldown_minutes;
        }
        alert.updated = Utc::now();

        // Update in PocketBase
        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/alerts/records/{}", self.config.pocketbase_url, alert_id);

        let channels_str: Vec<String> = alert.channels.iter().map(|c| c.to_string()).collect();

        let client = reqwest::Client::new();
        let response = client
            .patch(&url)
            .header("Authorization", token)
            .json(&serde_json::json!({
                "name": alert.name,
                "threshold": alert.threshold,
                "comparison": alert.comparison.to_string(),
                "channels": channels_str,
                "is_active": alert.is_active,
                "cooldown_minutes": alert.cooldown_minutes,
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to update alert: {}", e)))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!("PocketBase error: {}", error_text)));
        }

        Ok(alert.clone())
    }

    /// Delete an alert
    pub async fn delete_alert(&self, alert_id: &str, user_id: &str) -> Result<(), AppError> {
        let mut cache = self.alerts_cache.write().await;
        
        let alert = cache.get(alert_id)
            .ok_or_else(|| AppError::NotFound(format!("Alert {} not found", alert_id)))?;

        // Verify ownership
        if alert.user_id != user_id {
            return Err(AppError::Unauthorized("Not authorized to delete this alert".into()));
        }

        // Delete from PocketBase
        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/alerts/records/{}", self.config.pocketbase_url, alert_id);

        let client = reqwest::Client::new();
        let response = client
            .delete(&url)
            .header("Authorization", token)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to delete alert: {}", e)))?;

        if !response.status().is_success() && response.status().as_u16() != 404 {
            let error_text = response.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!("PocketBase error: {}", error_text)));
        }

        cache.remove(alert_id);
        tracing::info!("Deleted alert {}", alert_id);
        Ok(())
    }

    // ==================== Alert Evaluation ====================

    /// Evaluate all active alerts (called by job scheduler)
    pub async fn evaluate_all_alerts(&self) -> Result<serde_json::Value, String> {
        let cache = self.alerts_cache.read().await;
        let active_alerts: Vec<AlertRule> = cache
            .values()
            .filter(|a| a.is_active)
            .cloned()
            .collect();
        drop(cache);

        let mut triggered_count = 0;
        let mut evaluated_count = 0;

        for alert in active_alerts {
            // Check cooldown
            if let Some(last_triggered) = alert.last_triggered {
                let cooldown = Duration::minutes(alert.cooldown_minutes as i64);
                if Utc::now() - last_triggered < cooldown {
                    continue; // Still in cooldown
                }
            }

            evaluated_count += 1;

            // Evaluate the alert condition
            match self.evaluate_alert(&alert).await {
                Ok(Some(current_value)) => {
                    // Alert triggered!
                    tracing::info!("Alert '{}' triggered with value {}", alert.name, current_value);
                    
                    // Send notifications
                    if let Err(e) = self.notification_service.send(&alert.user_id, &alert, current_value).await {
                        tracing::error!("Failed to send notification for alert '{}': {}", alert.name, e);
                    }

                    // Update last_triggered
                    self.update_last_triggered(&alert.id).await;
                    triggered_count += 1;
                }
                Ok(None) => {
                    // Condition not met
                }
                Err(e) => {
                    tracing::error!("Error evaluating alert '{}': {}", alert.name, e);
                }
            }
        }

        Ok(serde_json::json!({
            "evaluated": evaluated_count,
            "triggered": triggered_count,
            "timestamp": Utc::now().to_rfc3339(),
        }))
    }

    /// Evaluate a single alert, returns Some(current_value) if triggered
    async fn evaluate_alert(&self, alert: &AlertRule) -> Result<Option<f64>, AppError> {
        let current_value = match &alert.alert_type {
            AlertType::PriceAbove | AlertType::PriceBelow => {
                let symbol = alert.symbol.as_ref()
                    .ok_or_else(|| AppError::BadRequest("Symbol required for price alerts".into()))?;
                
                // Get current price from price service
                // For now, return None - will be implemented with proper price lookup
                match self.get_current_price(symbol).await {
                    Some(price) => price,
                    None => return Ok(None),
                }
            }
            AlertType::PnlThresholdPercent | AlertType::PnlThresholdAbsolute => {
                // TODO: Calculate portfolio P&L
                return Ok(None);
            }
            AlertType::PortfolioChangePercent => {
                // TODO: Calculate 24h portfolio change
                return Ok(None);
            }
            AlertType::DailyPnlReport => {
                // Daily report is time-based, not value-based
                return Ok(None);
            }
        };

        // Check if condition is met
        let triggered = match alert.comparison {
            Comparison::Above => current_value >= alert.threshold,
            Comparison::Below => current_value <= alert.threshold,
            Comparison::Equals => (current_value - alert.threshold).abs() < 0.001,
        };

        if triggered {
            Ok(Some(current_value))
        } else {
            Ok(None)
        }
    }

    /// Get current price for a symbol
    async fn get_current_price(&self, symbol: &str) -> Option<f64> {
        // Try to get from price service cache
        // This is a simplified implementation - would need proper integration
        tracing::debug!("Getting price for symbol: {}", symbol);
        
        // For now, return None - actual implementation would check price_service
        None
    }

    /// Update last_triggered timestamp
    async fn update_last_triggered(&self, alert_id: &str) {
        let now = Utc::now();

        // Update cache
        let mut cache = self.alerts_cache.write().await;
        if let Some(alert) = cache.get_mut(alert_id) {
            alert.last_triggered = Some(now);
        }

        // Update in PocketBase
        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/alerts/records/{}", self.config.pocketbase_url, alert_id);

        let client = reqwest::Client::new();
        let _ = client
            .patch(&url)
            .header("Authorization", token)
            .json(&serde_json::json!({
                "last_triggered": now.to_rfc3339(),
            }))
            .send()
            .await;
    }

    // ==================== Alert History ====================

    /// Get alert history for a user
    pub async fn get_alert_history(
        &self,
        user_id: &str,
        limit: u32,
    ) -> Result<Vec<serde_json::Value>, AppError> {
        let token = self.pb_client.get_token().await;
        let url = format!(
            "{}/api/collections/alert_history/records?filter=(user_id='{}')&sort=-triggered_at&perPage={}",
            self.config.pocketbase_url, user_id, limit
        );

        let client = reqwest::Client::new();
        let response = client
            .get(&url)
            .header("Authorization", token)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to fetch history: {}", e)))?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        #[derive(serde::Deserialize)]
        struct ListResponse {
            items: Vec<serde_json::Value>,
        }

        let data: ListResponse = response.json().await.unwrap_or(ListResponse { items: vec![] });
        Ok(data.items)
    }
}
