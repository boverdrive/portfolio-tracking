use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;

use crate::config::Config;
use crate::error::AppError;
use crate::models::{
    AlertRule, AlertHistory, Notification, NotificationType,
    NotificationChannel, PushSubscription,
};
use crate::services::PocketBaseClient;

/// Notification service for sending alerts through multiple channels
#[derive(Clone)]
pub struct NotificationService {
    pb_client: PocketBaseClient,
    config: Config,
    // In-memory cache of push subscriptions
    push_subscriptions: Arc<RwLock<Vec<PushSubscription>>>,
}

impl NotificationService {
    pub fn new(config: Config, pb_client: PocketBaseClient) -> Self {
        Self {
            pb_client,
            config,
            push_subscriptions: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Send notification through specified channels
    pub async fn send(
        &self,
        user_id: &str,
        alert: &AlertRule,
        current_value: f64,
    ) -> Result<AlertHistory, AppError> {
        let message = self.format_alert_message(alert, current_value);
        let mut channels_sent = Vec::new();

        for channel in &alert.channels {
            match channel {
                NotificationChannel::InApp => {
                    if let Err(e) = self.send_in_app(user_id, &alert.name, &message).await {
                        tracing::error!("Failed to send in-app notification: {}", e);
                    } else {
                        channels_sent.push(NotificationChannel::InApp);
                    }
                }
                NotificationChannel::WebPush => {
                    if let Err(e) = self.send_web_push(user_id, &alert.name, &message).await {
                        tracing::error!("Failed to send web push notification: {}", e);
                    } else {
                        channels_sent.push(NotificationChannel::WebPush);
                    }
                }
                NotificationChannel::Email => {
                    // Email will be implemented later
                    tracing::info!("Email notifications not yet implemented");
                }
            }
        }

        // Record alert history
        let history = self.record_alert_history(alert, &message, channels_sent.clone(), current_value).await?;
        
        Ok(history)
    }

    /// Format alert message based on alert type
    fn format_alert_message(&self, alert: &AlertRule, current_value: f64) -> String {
        use crate::models::AlertType;

        match &alert.alert_type {
            AlertType::PriceAbove | AlertType::PriceBelow => {
                let symbol = alert.symbol.as_deref().unwrap_or("Unknown");
                let direction = if matches!(alert.alert_type, AlertType::PriceAbove) {
                    "สูงขึ้นถึง"
                } else {
                    "ลดลงถึง"
                };
                format!(
                    "{} ราคา{} {:.2} (เป้าหมาย: {:.2})",
                    symbol, direction, current_value, alert.threshold
                )
            }
            AlertType::PnlThresholdPercent => {
                let direction = if current_value >= 0.0 { "กำไร" } else { "ขาดทุน" };
                format!(
                    "พอร์ต{} {:.2}% (เกินเกณฑ์ {:.2}%)",
                    direction, current_value.abs(), alert.threshold
                )
            }
            AlertType::PnlThresholdAbsolute => {
                let direction = if current_value >= 0.0 { "กำไร" } else { "ขาดทุน" };
                format!(
                    "พอร์ต{} ฿{:.2} (เกินเกณฑ์ ฿{:.2})",
                    direction, current_value.abs(), alert.threshold
                )
            }
            AlertType::PortfolioChangePercent => {
                let direction = if current_value >= 0.0 { "เพิ่มขึ้น" } else { "ลดลง" };
                format!(
                    "มูลค่าพอร์ต{} {:.2}% ใน 24 ชั่วโมง",
                    direction, current_value.abs()
                )
            }
            AlertType::DailyPnlReport => {
                format!("สรุปผลการลงทุนวันนี้: P&L {:.2}%", current_value)
            }
        }
    }

    /// Send in-app notification (stored in PocketBase)
    async fn send_in_app(
        &self,
        user_id: &str,
        title: &str,
        body: &str,
    ) -> Result<Notification, AppError> {
        let notification = Notification {
            id: uuid::Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            title: title.to_string(),
            body: body.to_string(),
            notification_type: NotificationType::Alert,
            is_read: false,
            metadata: None,
            created: Utc::now(),
        };

        // Save to PocketBase
        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/notifications/records", self.config.pocketbase_url);
        
        let client = reqwest::Client::new();
        let response = client
            .post(&url)
            .header("Authorization", token)
            .json(&serde_json::json!({
                "user_id": notification.user_id,
                "title": notification.title,
                "body": notification.body,
                "notification_type": notification.notification_type.to_string(),
                "is_read": notification.is_read,
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to create notification: {}", e)))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!("PocketBase error: {}", error_text)));
        }

        tracing::info!("In-app notification sent to user {}", user_id);
        Ok(notification)
    }

    /// Send web push notification
    async fn send_web_push(
        &self,
        user_id: &str,
        title: &str,
        body: &str,
    ) -> Result<(), AppError> {
        // Get user's push subscriptions
        let subscriptions = self.get_user_push_subscriptions(user_id).await?;
        
        if subscriptions.is_empty() {
            tracing::debug!("No push subscriptions for user {}", user_id);
            return Ok(());
        }

        // For each subscription, send the notification
        for sub in subscriptions {
            if let Err(e) = self.send_push_to_subscription(&sub, title, body).await {
                tracing::error!("Failed to send push to subscription {}: {}", sub.id, e);
            }
        }

        Ok(())
    }

    /// Send push notification to a specific subscription
    async fn send_push_to_subscription(
        &self,
        subscription: &PushSubscription,
        title: &str,
        body: &str,
    ) -> Result<(), AppError> {
        // Create push payload
        let payload = serde_json::json!({
            "title": title,
            "body": body,
            "icon": "/icon.png",
            "badge": "/icon.png",
            "tag": "portfolio-alert",
            "requireInteraction": true,
            "data": {
                "url": "/",
            }
        });

        // For now, we just log it - actual web-push implementation requires VAPID keys
        // TODO: Implement web-push crate integration when VAPID keys are configured
        tracing::info!(
            "Would send push notification to endpoint: {} with payload: {}",
            subscription.endpoint,
            payload
        );

        Ok(())
    }

    /// Get push subscriptions for a user
    async fn get_user_push_subscriptions(
        &self,
        user_id: &str,
    ) -> Result<Vec<PushSubscription>, AppError> {
        let token = self.pb_client.get_token().await;
        let url = format!(
            "{}/api/collections/push_subscriptions/records?filter=(user_id='{}')",
            self.config.pocketbase_url, user_id
        );

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
                    items: Vec<PushSubscription>,
                }
                
                let data: ListResponse = resp.json().await.unwrap_or(ListResponse { items: vec![] });
                Ok(data.items)
            }
            _ => Ok(vec![]), // Return empty if collection doesn't exist yet
        }
    }

    /// Subscribe a user to push notifications
    pub async fn subscribe_push(
        &self,
        user_id: &str,
        endpoint: &str,
        p256dh: &str,
        auth: &str,
    ) -> Result<PushSubscription, AppError> {
        let subscription = PushSubscription {
            id: uuid::Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            endpoint: endpoint.to_string(),
            p256dh: p256dh.to_string(),
            auth: auth.to_string(),
            created: Utc::now(),
        };

        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/push_subscriptions/records", self.config.pocketbase_url);

        let client = reqwest::Client::new();
        let response = client
            .post(&url)
            .header("Authorization", token)
            .json(&serde_json::json!({
                "user_id": subscription.user_id,
                "endpoint": subscription.endpoint,
                "p256dh": subscription.p256dh,
                "auth": subscription.auth,
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to save subscription: {}", e)))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!("PocketBase error: {}", error_text)));
        }

        tracing::info!("Push subscription saved for user {}", user_id);
        Ok(subscription)
    }

    /// Record alert trigger in history
    async fn record_alert_history(
        &self,
        alert: &AlertRule,
        message: &str,
        channels_sent: Vec<NotificationChannel>,
        value_at_trigger: f64,
    ) -> Result<AlertHistory, AppError> {
        let history = AlertHistory {
            id: uuid::Uuid::new_v4().to_string(),
            alert_id: alert.id.clone(),
            user_id: alert.user_id.clone(),
            triggered_at: Utc::now(),
            message: message.to_string(),
            channels_sent: channels_sent.clone(),
            value_at_trigger,
        };

        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/alert_history/records", self.config.pocketbase_url);

        let client = reqwest::Client::new();
        let channels_str: Vec<String> = channels_sent.iter().map(|c| c.to_string()).collect();
        
        let response = client
            .post(&url)
            .header("Authorization", token)
            .json(&serde_json::json!({
                "alert_id": history.alert_id,
                "user_id": history.user_id,
                "triggered_at": history.triggered_at.to_rfc3339(),
                "message": history.message,
                "channels_sent": channels_str,
                "value_at_trigger": history.value_at_trigger,
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to record history: {}", e)))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            tracing::error!("Failed to record alert history: {}", error_text);
        }

        Ok(history)
    }

    // ==================== Notification Query Methods ====================

    /// Get unread notifications for a user
    pub async fn get_unread_notifications(
        &self,
        user_id: &str,
    ) -> Result<Vec<Notification>, AppError> {
        let token = self.pb_client.get_token().await;
        let url = format!(
            "{}/api/collections/notifications/records?filter=(user_id='{}' && is_read=false)&sort=-created",
            self.config.pocketbase_url, user_id
        );

        let client = reqwest::Client::new();
        let response = client
            .get(&url)
            .header("Authorization", token)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to fetch notifications: {}", e)))?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        #[derive(serde::Deserialize)]
        struct ListResponse {
            items: Vec<serde_json::Value>,
        }

        let data: ListResponse = response.json().await.unwrap_or(ListResponse { items: vec![] });
        
        let notifications: Vec<Notification> = data.items
            .into_iter()
            .filter_map(|item| {
                Some(Notification {
                    id: item.get("id")?.as_str()?.to_string(),
                    user_id: item.get("user_id")?.as_str()?.to_string(),
                    title: item.get("title")?.as_str()?.to_string(),
                    body: item.get("body")?.as_str()?.to_string(),
                    notification_type: NotificationType::Alert,
                    is_read: item.get("is_read")?.as_bool()?,
                    metadata: item.get("metadata").cloned(),
                    created: Utc::now(), // Parse from item if needed
                })
            })
            .collect();

        Ok(notifications)
    }

    /// Mark notification as read
    pub async fn mark_as_read(&self, notification_id: &str) -> Result<(), AppError> {
        let token = self.pb_client.get_token().await;
        let url = format!(
            "{}/api/collections/notifications/records/{}",
            self.config.pocketbase_url, notification_id
        );

        let client = reqwest::Client::new();
        let response = client
            .patch(&url)
            .header("Authorization", token)
            .json(&serde_json::json!({ "is_read": true }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to update notification: {}", e)))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!("PocketBase error: {}", error_text)));
        }

        Ok(())
    }

    /// Mark all notifications as read for a user
    pub async fn mark_all_as_read(&self, user_id: &str) -> Result<u32, AppError> {
        let notifications = self.get_unread_notifications(user_id).await?;
        let count = notifications.len() as u32;
        
        for notification in notifications {
            let _ = self.mark_as_read(&notification.id).await;
        }

        Ok(count)
    }
}
