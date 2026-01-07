use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};
use crate::error::AppError;
use crate::models::UserResponse;
use crate::AppState;

/// Admin user list response
#[derive(Debug, Serialize)]
pub struct AdminUsersResponse {
    pub users: Vec<UserResponse>,
    pub total: usize,
}

/// Update user request
#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub name: Option<String>,
    pub role: Option<String>,
}

/// Reset password request
#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub new_password: String,
}

/// Create user request
#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub password: String,
    pub name: Option<String>,
    pub role: Option<String>,
}

/// Extract user_id from Authorization header JWT and verify admin
fn extract_admin_user_id(state: &AppState, headers: &HeaderMap) -> Result<String, AppError> {
    let auth_header = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("Missing authorization header".to_string()))?;
    
    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("Invalid authorization format".to_string()))?;
    
    let claims = state.auth_service.verify_jwt(token)?;
    
    // Check if user is admin
    let user = tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(async {
            state.auth_service.get_user(&claims.sub).await
        })
    })?;
    
    if !user.is_admin() {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }
    
    Ok(claims.sub)
}

/// GET /api/admin/users - Get all users (admin only)
pub async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AdminUsersResponse>, AppError> {
    let _ = extract_admin_user_id(&state, &headers)?;
    
    let users = state.auth_service.list_all_users().await;
    let user_responses: Vec<UserResponse> = users.iter().map(UserResponse::from).collect();
    
    Ok(Json(AdminUsersResponse {
        total: user_responses.len(),
        users: user_responses,
    }))
}

/// POST /api/admin/users - Create new user (admin only)
pub async fn create_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateUserRequest>,
) -> Result<Json<UserResponse>, AppError> {
    let admin_id = extract_admin_user_id(&state, &headers)?;
    
    // Validate email format
    if !req.email.contains('@') {
        return Err(AppError::BadRequest("Invalid email format".to_string()));
    }
    
    // Validate password length
    if req.password.len() < 6 {
        return Err(AppError::BadRequest("Password must be at least 6 characters".to_string()));
    }
    
    // Validate role if provided
    let is_admin = match req.role.as_deref() {
        Some("admin") => true,
        Some("user") | None => false,
        Some(_) => return Err(AppError::BadRequest("Role must be 'admin' or 'user'".to_string())),
    };
    
    let user = state.auth_service.register_local_user(
        &req.email,
        &req.password,
        req.name.clone(),
        is_admin,
    ).await?;
    
    tracing::info!("Admin {} created user {} with role {}", admin_id, user.id, user.role);
    Ok(Json(UserResponse::from(&user)))
}

/// GET /api/admin/users/:id - Get single user (admin only)
pub async fn get_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<UserResponse>, AppError> {
    let _ = extract_admin_user_id(&state, &headers)?;
    
    let user = state.auth_service.get_user(&user_id).await?;
    Ok(Json(UserResponse::from(&user)))
}

/// PATCH /api/admin/users/:id - Update user (admin only)
pub async fn update_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(req): Json<UpdateUserRequest>,
) -> Result<Json<UserResponse>, AppError> {
    let admin_id = extract_admin_user_id(&state, &headers)?;
    
    // Validate role if provided
    if let Some(ref role) = req.role {
        if role != "admin" && role != "user" {
            return Err(AppError::BadRequest("Role must be 'admin' or 'user'".to_string()));
        }
    }
    
    let user = state.auth_service.update_user_admin(&user_id, req.name.clone(), req.role.clone()).await?;
    
    tracing::info!("Admin {} updated user {}", admin_id, user_id);
    Ok(Json(UserResponse::from(&user)))
}

/// POST /api/admin/users/:id/reset-password - Reset user password (admin only)
pub async fn reset_user_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(req): Json<ResetPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let admin_id = extract_admin_user_id(&state, &headers)?;
    
    if req.new_password.len() < 6 {
        return Err(AppError::BadRequest("Password must be at least 6 characters".to_string()));
    }
    
    state.auth_service.reset_user_password(&user_id, &req.new_password).await?;
    
    tracing::info!("Admin {} reset password for user {}", admin_id, user_id);
    Ok(Json(serde_json::json!({
        "message": "Password reset successfully"
    })))
}

/// DELETE /api/admin/users/:id - Delete user (admin only)
pub async fn delete_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let admin_id = extract_admin_user_id(&state, &headers)?;
    
    // Prevent self-deletion
    if admin_id == user_id {
        return Err(AppError::BadRequest("Cannot delete your own account".to_string()));
    }
    
    state.auth_service.delete_user(&user_id).await?;
    
    tracing::info!("Admin {} deleted user {}", admin_id, user_id);
    Ok(Json(serde_json::json!({
        "message": "User deleted successfully"
    })))
}
