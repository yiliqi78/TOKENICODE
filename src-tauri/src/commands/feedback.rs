// Feedback submission via Feishu self-built app.
//
// Flow: get tenant_access_token → (optional) upload image → send card message
// to a fixed recipient. Secrets are compile-time env vars so they never ship
// in distributed source code and never go through user-accessible config files.
//
// Configure at build time:
//   FEISHU_APP_ID=cli_xxx \
//   FEISHU_APP_SECRET=xxx \
//   FEISHU_RECEIVE_ID=<id> \
//   FEISHU_RECEIVE_ID_TYPE=<type>   # optional, defaults to "chat_id"
//   pnpm tauri build
//
// Supported FEISHU_RECEIVE_ID_TYPE values (Feishu API):
//   - "chat_id"  : group chat id (oc_xxx) — most common for a dedicated feedback group
//   - "open_id"  : user open id (ou_xxx) — sends to the bot's DM with that user
//   - "user_id"  : tenant user id
//   - "email"    : user's Feishu registration email
//
// If FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_RECEIVE_ID is missing at build
// time, is_configured() returns false and the frontend disables the submit
// button.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

// Compile-time secrets. option_env! returns None when the env var is absent,
// so un-configured builds compile cleanly and fail gracefully at runtime.
const FEISHU_APP_ID: Option<&str> = option_env!("FEISHU_APP_ID");
const FEISHU_APP_SECRET: Option<&str> = option_env!("FEISHU_APP_SECRET");
const FEISHU_RECEIVE_ID: Option<&str> = option_env!("FEISHU_RECEIVE_ID");
const FEISHU_RECEIVE_ID_TYPE: Option<&str> = option_env!("FEISHU_RECEIVE_ID_TYPE");

const FEISHU_API_BASE: &str = "https://open.feishu.cn/open-apis";

/// Default receive_id_type when FEISHU_RECEIVE_ID_TYPE isn't set.
/// "chat_id" is the historical default and works for group chats.
const DEFAULT_RECEIVE_ID_TYPE: &str = "chat_id";

fn receive_id_type() -> &'static str {
    FEISHU_RECEIVE_ID_TYPE.unwrap_or(DEFAULT_RECEIVE_ID_TYPE)
}

/// tenant_access_token cache. Feishu tokens are valid for 7200s; we refresh
/// at the 6000s mark to leave a safety margin.
struct CachedToken {
    token: String,
    expires_at: Instant,
}

static TOKEN_CACHE: Mutex<Option<CachedToken>> = Mutex::new(None);

fn is_configured() -> bool {
    FEISHU_APP_ID.is_some() && FEISHU_APP_SECRET.is_some() && FEISHU_RECEIVE_ID.is_some()
}

#[derive(Deserialize)]
struct TenantTokenResponse {
    code: i64,
    msg: String,
    #[serde(default)]
    tenant_access_token: String,
    #[serde(default)]
    #[allow(dead_code)]
    expire: i64,
}

async fn get_tenant_token(client: &reqwest::Client) -> Result<String, String> {
    // Fast path: return cached token if still fresh.
    if let Ok(guard) = TOKEN_CACHE.lock() {
        if let Some(cached) = guard.as_ref() {
            if cached.expires_at > Instant::now() {
                return Ok(cached.token.clone());
            }
        }
    }

    let app_id = FEISHU_APP_ID.ok_or("FEISHU_APP_ID not configured at build time")?;
    let app_secret = FEISHU_APP_SECRET.ok_or("FEISHU_APP_SECRET not configured at build time")?;

    let url = format!("{}/auth/v3/tenant_access_token/internal", FEISHU_API_BASE);
    let body = serde_json::json!({
        "app_id": app_id,
        "app_secret": app_secret,
    });

    let resp: TenantTokenResponse = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Parse response failed: {}", e))?;

    if resp.code != 0 {
        return Err(format!("Feishu auth error {}: {}", resp.code, resp.msg));
    }

    // Cache with a 6000s TTL (token actually expires in 7200s).
    if let Ok(mut guard) = TOKEN_CACHE.lock() {
        *guard = Some(CachedToken {
            token: resp.tenant_access_token.clone(),
            expires_at: Instant::now() + Duration::from_secs(6000),
        });
    }

    Ok(resp.tenant_access_token)
}

#[derive(Deserialize)]
struct UploadImageResponse {
    code: i64,
    msg: String,
    #[serde(default)]
    data: Option<UploadImageData>,
}

#[derive(Deserialize)]
struct UploadImageData {
    image_key: String,
}

async fn upload_image(
    client: &reqwest::Client,
    token: &str,
    image_bytes: Vec<u8>,
) -> Result<String, String> {
    let url = format!("{}/im/v1/images", FEISHU_API_BASE);

    let form = reqwest::multipart::Form::new()
        .text("image_type", "message")
        .part(
            "image",
            reqwest::multipart::Part::bytes(image_bytes)
                .file_name("screenshot.png")
                .mime_str("image/png")
                .map_err(|e| format!("Invalid mime: {}", e))?,
        );

    let resp: UploadImageResponse = client
        .post(&url)
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Parse upload response failed: {}", e))?;

    if resp.code != 0 {
        return Err(format!("Feishu upload error {}: {}", resp.code, resp.msg));
    }

    resp.data
        .map(|d| d.image_key)
        .ok_or_else(|| "Upload succeeded but image_key missing".to_string())
}

/// Metadata collected alongside the user's free-text feedback.
/// Serialized into the Feishu card for operator-side diagnostics.
/// OS / arch are filled in by the Rust side from compile-time constants so
/// the frontend doesn't need to juggle platform detection.
#[derive(Deserialize)]
pub struct FeedbackMetadata {
    pub app_name: String,
    pub app_version: String,
    pub locale: Option<String>,
    pub provider_name: Option<String>,
    pub model: Option<String>,
    pub session_id: Option<String>,
    pub user_contact: Option<String>,
}

#[derive(Serialize)]
struct SendMessageRequest {
    receive_id: String,
    msg_type: String,
    content: String,
}

#[derive(Deserialize)]
struct SendMessageResponse {
    code: i64,
    msg: String,
}

/// Build a Feishu interactive card for the feedback. Returns a JSON string
/// ready to be set as the `content` field of the message.
fn build_card(
    description: &str,
    metadata: &FeedbackMetadata,
    image_key: Option<&str>,
) -> serde_json::Value {
    let title = format!("📝 {} 用户反馈", metadata.app_name);

    let mut meta_lines: Vec<String> = vec![
        format!("**版本**: {}", metadata.app_version),
        format!(
            "**系统**: {} {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    ];
    if let Some(locale) = &metadata.locale {
        meta_lines.push(format!("**语言**: {}", locale));
    }
    if let Some(provider) = &metadata.provider_name {
        meta_lines.push(format!("**Provider**: {}", provider));
    }
    if let Some(model) = &metadata.model {
        meta_lines.push(format!("**Model**: {}", model));
    }
    if let Some(sid) = &metadata.session_id {
        meta_lines.push(format!("**Session**: `{}`", sid));
    }
    if let Some(contact) = &metadata.user_contact {
        if !contact.trim().is_empty() {
            meta_lines.push(format!("**联系方式**: {}", contact));
        }
    }

    let mut elements = vec![
        serde_json::json!({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": format!("**用户描述**\n{}", description.trim())
            }
        }),
        serde_json::json!({"tag": "hr"}),
        serde_json::json!({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": meta_lines.join("\n")
            }
        }),
    ];

    if let Some(key) = image_key {
        elements.push(serde_json::json!({
            "tag": "img",
            "img_key": key,
            "alt": {"tag": "plain_text", "content": "screenshot"},
            "mode": "fit_horizontal",
            "preview": true
        }));
    }

    serde_json::json!({
        "config": {"wide_screen_mode": true},
        "header": {
            "title": {"tag": "plain_text", "content": title},
            "template": "blue"
        },
        "elements": elements
    })
}

async fn send_card(
    client: &reqwest::Client,
    token: &str,
    card: serde_json::Value,
) -> Result<(), String> {
    let receive_id = FEISHU_RECEIVE_ID.ok_or("FEISHU_RECEIVE_ID not configured at build time")?;
    let id_type = receive_id_type();
    let url = format!(
        "{}/im/v1/messages?receive_id_type={}",
        FEISHU_API_BASE, id_type
    );

    let req = SendMessageRequest {
        receive_id: receive_id.to_string(),
        msg_type: "interactive".to_string(),
        content: serde_json::to_string(&card)
            .map_err(|e| format!("Serialize card failed: {}", e))?,
    };

    let resp: SendMessageResponse = client
        .post(&url)
        .bearer_auth(token)
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("Send request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Parse send response failed: {}", e))?;

    if resp.code != 0 {
        return Err(format!("Feishu send error {}: {}", resp.code, resp.msg));
    }

    Ok(())
}

/// Main Tauri command. Called by the frontend with the user's description,
/// optional base64-encoded screenshot, and diagnostic metadata.
#[tauri::command]
pub async fn submit_feedback(
    description: String,
    screenshot_base64: Option<String>,
    metadata: FeedbackMetadata,
) -> Result<(), String> {
    if !is_configured() {
        return Err("反馈功能未配置。请联系开发者或等待下一个版本。".to_string());
    }

    let trimmed = description.trim();
    if trimmed.is_empty() {
        return Err("反馈内容不能为空".to_string());
    }
    if trimmed.len() > 5000 {
        return Err("反馈内容超过 5000 字符限制".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client init failed: {}", e))?;

    let token = get_tenant_token(&client).await?;

    let image_key = if let Some(b64) = screenshot_base64 {
        // Decode base64 payload. Cap at 5MB after decode to keep uploads snappy.
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.as_bytes())
            .map_err(|e| format!("Invalid screenshot base64: {}", e))?;
        if bytes.len() > 5 * 1024 * 1024 {
            return Err("截图文件超过 5MB 限制".to_string());
        }
        let key = upload_image(&client, &token, bytes).await?;
        Some(key)
    } else {
        None
    };

    let card = build_card(trimmed, &metadata, image_key.as_deref());
    send_card(&client, &token, card).await?;

    Ok(())
}

/// Exposed to the frontend so the UI can show "not configured" state.
#[tauri::command]
pub fn feedback_is_configured() -> bool {
    is_configured()
}
