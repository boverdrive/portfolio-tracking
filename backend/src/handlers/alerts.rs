use axum::{
    extract::{Path, State, Query},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::AppState;
use crate::error::AppError;
use crate::models::{
    CreateAlertRequest, UpdateAlertRequest, SubscribePushRequest,
};
use crate::services::AuthService;

/// Extract user_id from JWT token in Authorization header
async fn get_user_id_from_request(
    state: &AppState,
    auth_header: Option<&str>,
) -> Result<String, AppError> {
    let token = auth_header
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::Unauthorized("Missing or invalid authorization header".into()))?;

    let claims = state.auth_service.verify_jwt(token)
        .map_err(|_| AppError::Unauthorized("Invalid token".into()))?;

    Ok(claims.sub)
}

// ==================== Alert CRUD Handlers ====================

/// GET /api/alerts - List user's alerts
pub async fn list_alerts(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<crate::models::AlertRule>>, AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let user_id = get_user_id_from_request(&state, auth_header).await?;

    let alerts = state.alert_service.get_user_alerts(&user_id).await?;
    Ok(Json(alerts))
}

/// POST /api/alerts - Create a new alert
pub async fn create_alert(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<CreateAlertRequest>,
) -> Result<(StatusCode, Json<crate::models::AlertRule>), AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let user_id = get_user_id_from_request(&state, auth_header).await?;

    let alert = state.alert_service.create_alert(&user_id, req).await?;
    Ok((StatusCode::CREATED, Json(alert)))
}

/// GET /api/alerts/:id - Get a specific alert
pub async fn get_alert(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<crate::models::AlertRule>, AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let user_id = get_user_id_from_request(&state, auth_header).await?;

    let alert = state.alert_service.get_alert(&id).await
        .ok_or_else(|| AppError::NotFound(format!("Alert {} not found", id)))?;

    // Verify ownership
    if alert.user_id != user_id {
        return Err(AppError::Unauthorized("Not authorized to view this alert".into()));
    }

    Ok(Json(alert))
}

/// PUT /api/alerts/:id - Update an alert
pub async fn update_alert(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<UpdateAlertRequest>,
) -> Result<Json<crate::models::AlertRule>, AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let user_id = get_user_id_from_request(&state, auth_header).await?;

    let alert = state.alert_service.update_alert(&id, &user_id, req).await?;
    Ok(Json(alert))
}

/// DELETE /api/alerts/:id - Delete an alert
pub async fn delete_alert(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let user_id = get_user_id_from_request(&state, auth_header).await?;

    state.alert_service.delete_alert(&id, &user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ==================== Alert History Handlers ====================

#[derive(Deserialize)]
pub struct HistoryQuery {
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 {
    50
}

/// GET /api/alerts/history - Get alert trigger history
pub async fn get_alert_history(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let user_id = get_user_id_from_request(&state, auth_header).await?;

    let history = state.alert_service.get_alert_history(&user_id, query.limit).await?;
    Ok(Json(history))
}

// ==================== Notification Handlers ====================

/// GET /api/notifications - Get unread notifications
pub async fn get_notifications(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<crate::models::Notification>>, AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let user_id = get_user_id_from_request(&state, auth_header).await?;

    let notifications = state.notification_service.get_unread_notifications(&user_id).await?;
    Ok(Json(notifications))
}

/// POST /api/notifications/:id/read - Mark notification as read
pub async fn mark_notification_read(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let _user_id = get_user_id_from_request(&state, auth_header).await?;

    state.notification_service.mark_as_read(&id).await?;
    Ok(StatusCode::OK)
}

/// POST /api/notifications/read-all - Mark all notifications as read
pub async fn mark_all_notifications_read(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let user_id = get_user_id_from_request(&state, auth_header).await?;

    let count = state.notification_service.mark_all_as_read(&user_id).await?;
    Ok(Json(serde_json::json!({ "marked_read": count })))
}

// ==================== Push Subscription Handlers ====================

/// POST /api/push/subscribe - Subscribe to web push notifications
pub async fn subscribe_push(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<SubscribePushRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let user_id = get_user_id_from_request(&state, auth_header).await?;

    let subscription = state.notification_service
        .subscribe_push(&user_id, &req.endpoint, &req.p256dh, &req.auth)
        .await?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": subscription.id,
        "message": "Successfully subscribed to push notifications"
    }))))
}

// ==================== Manual Trigger (Admin/Testing) ====================

/// POST /api/alerts/evaluate - Manually trigger alert evaluation (admin only)
pub async fn evaluate_alerts(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let _user_id = get_user_id_from_request(&state, auth_header).await?;

    // TODO: Check if user is admin

    let result = state.alert_service.evaluate_all_alerts().await
        .map_err(|e| AppError::Internal(e))?;
    
    Ok(Json(result))
}

/// POST /api/notifications/test - Send a test notification
pub async fn send_test_notification(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let user_id = get_user_id_from_request(&state, auth_header).await?;

    // Create a test notification
    let notification = crate::models::Notification {
        id: uuid::Uuid::new_v4().to_string(),
        user_id: user_id.clone(),
        title: "🔔 ทดสอบการแจ้งเตือน".to_string(),
        body: "นี่คือการแจ้งเตือนทดสอบจาก Portfolio Tracker".to_string(),
        notification_type: crate::models::NotificationType::Info,
        is_read: false,
        metadata: None,
        created: chrono::Utc::now(),
    };

    // For now, just return success - actual implementation would use notification_service
    Ok(Json(serde_json::json!({
        "success": true,
        "notification": notification,
        "message": "Test notification created"
    })))
}
