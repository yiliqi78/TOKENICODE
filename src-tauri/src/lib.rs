mod commands;

use commands::{ProcessManager, SessionInfo, StartSessionParams, ManagedProcess, StdinManager};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use std::process::Stdio;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;
use std::collections::HashMap;
use std::io::Write as IoWrite;
use sha2::{Sha256, Digest};
use futures_util::StreamExt;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use aes_gcm::aead::Aead;
use rand::RngCore;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Manages active file watchers
#[derive(Default)]
struct WatcherManager {
    watchers: Arc<TokioMutex<HashMap<String, notify::RecommendedWatcher>>>,
}

/// Path to the CLI download directory under the app's local data dir.
fn cli_download_dir() -> Option<std::path::PathBuf> {
    dirs::data_local_dir().map(|d| d.join("com.tinyzhuang.tokenicode").join("cli"))
}

/// Find the claude binary by checking common installation paths
fn find_claude_binary() -> Option<String> {
    // 0. Check app-local download directory (our own downloaded CLI)
    if let Some(cli_dir) = cli_download_dir() {
        #[cfg(target_os = "windows")]
        let bin_name = "claude.exe";
        #[cfg(not(target_os = "windows"))]
        let bin_name = "claude";
        let path = cli_dir.join(bin_name);
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    // 1. Check if `claude` is already on the system PATH
    #[cfg(target_os = "windows")]
    {
        // Windows: use `where claude` via cmd, then fallback to `where claude.cmd`
        for query in ["claude", "claude.cmd"] {
            if let Ok(output) = std::process::Command::new("cmd")
                .args(["/C", "where", query])
                .output()
            {
                if output.status.success() {
                    // `where` may return multiple lines; take the first one
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    if let Some(path) = stdout.lines().next() {
                        let path = path.trim().to_string();
                        if !path.is_empty() && std::path::Path::new(&path).exists() {
                            return Some(path);
                        }
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = std::process::Command::new("sh")
            .args(["-l", "-c", "which claude"])
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() && std::path::Path::new(&path).exists() {
                    return Some(path);
                }
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        // 2. Platform-specific Claude desktop app bundled CLI
        #[cfg(target_os = "windows")]
        {
            // %LOCALAPPDATA%\Claude\claude-code\*\claude.exe
            if let Some(local_app) = dirs::data_local_dir() {
                let claude_code_dir = local_app.join("Claude").join("claude-code");
                if let Some(bin) = find_newest_version_bin(&claude_code_dir, "claude.exe") {
                    return Some(bin);
                }
            }
            // %APPDATA%\Claude\claude-code\*\claude.exe
            if let Some(app_data) = dirs::data_dir() {
                let claude_code_dir = app_data.join("Claude").join("claude-code");
                if let Some(bin) = find_newest_version_bin(&claude_code_dir, "claude.exe") {
                    return Some(bin);
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            let claude_code_dir = home.join("Library/Application Support/Claude/claude-code");
            if let Some(bin) = find_newest_version_bin(&claude_code_dir, "claude") {
                return Some(bin);
            }
        }
        #[cfg(target_os = "linux")]
        {
            // ~/.local/share/Claude/claude-code/*/claude
            if let Some(data_dir) = dirs::data_dir() {
                let claude_code_dir = data_dir.join("Claude").join("claude-code");
                if let Some(bin) = find_newest_version_bin(&claude_code_dir, "claude") {
                    return Some(bin);
                }
            }
        }

        // 3. Common global install paths
        #[cfg(target_os = "windows")]
        {
            // npm global: %APPDATA%\npm\claude.cmd
            if let Some(app_data) = dirs::data_dir() {
                for name in ["claude.cmd", "claude.exe", "claude.ps1"] {
                    let candidate = app_data.join("npm").join(name);
                    if candidate.exists() {
                        return Some(candidate.to_string_lossy().to_string());
                    }
                }
            }
            // Scoop: ~/scoop/shims/claude.cmd
            let scoop_candidate = home.join("scoop").join("shims").join("claude.cmd");
            if scoop_candidate.exists() {
                return Some(scoop_candidate.to_string_lossy().to_string());
            }
            // nvm-windows / fnm / volta node paths
            for sub in ["AppData\\Roaming\\nvm", ".volta\\bin", "AppData\\Local\\fnm_multishells"] {
                let candidate = home.join(sub).join("claude.cmd");
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            for candidate in [
                home.join(".npm-global/bin/claude"),
                home.join(".local/bin/claude"),
            ] {
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
    }

    // 4. System-wide paths (Unix only)
    #[cfg(not(target_os = "windows"))]
    {
        for candidate in [
            "/usr/local/bin/claude",
            "/opt/homebrew/bin/claude",
        ] {
            if std::path::Path::new(candidate).exists() {
                return Some(candidate.to_string());
            }
        }
    }

    None
}

/// Search a versioned directory for the newest version containing the given binary name
fn find_newest_version_bin(base_dir: &std::path::Path, bin_name: &str) -> Option<String> {
    if !base_dir.exists() {
        return None;
    }
    if let Ok(entries) = std::fs::read_dir(base_dir) {
        let mut versions: Vec<_> = entries
            .flatten()
            .filter(|e| e.path().is_dir())
            .collect();
        // Sort by semantic version (descending) so newest version comes first
        versions.sort_by(|a, b| {
            let parse = |name: &std::ffi::OsStr| -> Vec<u64> {
                name.to_string_lossy()
                    .split('.')
                    .filter_map(|s| s.parse::<u64>().ok())
                    .collect()
            };
            parse(&b.file_name()).cmp(&parse(&a.file_name()))
        });
        for entry in &versions {
            let bin = entry.path().join(bin_name);
            if bin.exists() {
                return Some(bin.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Build an enriched PATH that includes common binary locations
fn build_enriched_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let mut paths = vec![];

    #[cfg(target_os = "windows")]
    let separator = ";";
    #[cfg(not(target_os = "windows"))]
    let separator = ":";

    if let Some(home) = dirs::home_dir() {
        #[cfg(target_os = "windows")]
        {
            if let Some(app_data) = dirs::data_dir() {
                paths.push(app_data.join("npm").to_string_lossy().to_string());
            }
            if let Some(local_app) = dirs::data_local_dir() {
                paths.push(local_app.join("Programs").join("claude-code").to_string_lossy().to_string());
            }
            paths.push(home.join("scoop").join("shims").to_string_lossy().to_string());
            paths.push(home.join(".cargo").join("bin").to_string_lossy().to_string());
            paths.push(home.join(".volta").join("bin").to_string_lossy().to_string());
        }
        #[cfg(not(target_os = "windows"))]
        {
            paths.push(home.join(".cargo/bin").to_string_lossy().to_string());
            paths.push(home.join(".local/bin").to_string_lossy().to_string());
            paths.push(home.join(".npm-global/bin").to_string_lossy().to_string());
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        paths.push("/opt/homebrew/bin".to_string());
        paths.push("/usr/local/bin".to_string());
    }

    let mut result = paths.join(separator);
    if !current.is_empty() {
        result.push_str(separator);
        result.push_str(&current);
    }
    result
}

// --- Credential storage (TK-303) ---

/// Directory for TOKENICODE app data
fn app_data_dir() -> Result<std::path::PathBuf, String> {
    dirs::data_local_dir()
        .map(|d| d.join("com.tinyzhuang.tokenicode"))
        .ok_or_else(|| "Cannot determine app data directory".to_string())
}

/// Path to encrypted credentials file
fn credentials_path() -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir()?.join("credentials.enc"))
}

/// Derive a machine-specific 256-bit key for credential encryption.
/// Uses hostname + username as entropy source.
fn derive_encryption_key() -> [u8; 32] {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "tokenicode".to_string());
    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "default".to_string());
    let mut hasher = Sha256::new();
    hasher.update(format!("tokenicode-cred:{}:{}", hostname, username));
    hasher.finalize().into()
}

/// Encrypt and store an API key to disk.
fn encrypt_and_save(plaintext: &str) -> Result<(), String> {
    let key_bytes = derive_encryption_key();
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Cipher init error: {}", e))?;

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption error: {}", e))?;

    // Store as: 12-byte nonce || ciphertext
    let mut data = Vec::with_capacity(12 + ciphertext.len());
    data.extend_from_slice(&nonce_bytes);
    data.extend_from_slice(&ciphertext);

    let path = credentials_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create data dir: {}", e))?;
    }
    std::fs::write(&path, &data)
        .map_err(|e| format!("Cannot write credentials: {}", e))?;
    Ok(())
}

/// Load and decrypt an API key from disk.
fn load_and_decrypt() -> Result<Option<String>, String> {
    let path = credentials_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let data = std::fs::read(&path)
        .map_err(|e| format!("Cannot read credentials: {}", e))?;
    if data.len() < 13 {
        return Err("Corrupted credentials file".to_string());
    }

    let key_bytes = derive_encryption_key();
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Cipher init error: {}", e))?;

    let nonce = Nonce::from_slice(&data[..12]);
    let plaintext = cipher.decrypt(nonce, &data[12..])
        .map_err(|_| "Failed to decrypt credentials (key may have changed)".to_string())?;

    String::from_utf8(plaintext)
        .map(Some)
        .map_err(|e| format!("Invalid UTF-8 in credentials: {}", e))
}

/// Resolve custom_env map, substituting USE_STORED_KEY sentinel with real API key.
fn resolve_custom_env(custom_env: Option<&HashMap<String, String>>) -> Result<HashMap<String, String>, String> {
    let Some(env) = custom_env else {
        return Ok(HashMap::new());
    };
    let mut resolved = HashMap::with_capacity(env.len());
    for (key, value) in env {
        if value == "USE_STORED_KEY" {
            let real_key = load_and_decrypt()?
                .ok_or_else(|| "API key not configured. Please set it in Settings → API Provider.".to_string())?;
            resolved.insert(key.clone(), real_key);
        } else {
            resolved.insert(key.clone(), value.clone());
        }
    }
    Ok(resolved)
}

/// Test API connection by sending a minimal request to the configured endpoint.
#[tauri::command]
async fn test_api_connection(base_url: String, api_format: String, model: String) -> Result<String, String> {
    let api_key = load_and_decrypt()?
        .ok_or_else(|| "API key not configured".to_string())?;

    let test_model = model;
    let client = reqwest::Client::new();

    let (url, resp_result) = if api_format == "openai" {
        let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "model": test_model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}]
        });
        let r = client.post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await;
        (url, r)
    } else {
        let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "model": test_model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}]
        });
        let r = client.post(&url)
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await;
        (url, r)
    };

    let resp = resp_result.map_err(|e| format!("NETWORK_ERROR: {}", e))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();

    if status >= 200 && status < 300 {
        Ok(format!("OK ({})", status))
    } else if status == 401 {
        Err(format!("AUTH_ERROR: HTTP {} — {}", status, text.chars().take(500).collect::<String>()))
    } else {
        // Any non-401 server response proves endpoint + key are reachable.
        // 400/403/429/etc. are typically model/quota/format issues, not connection problems.
        Ok(format!("OK ({})", status))
    }
}

#[tauri::command]
fn save_api_key(key: String) -> Result<(), String> {
    encrypt_and_save(&key)
}

#[tauri::command]
fn load_api_key() -> Result<Option<String>, String> {
    load_and_decrypt()
}

#[tauri::command]
fn delete_api_key() -> Result<(), String> {
    let path = credentials_path()?;
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Cannot delete credentials: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn start_claude_session(
    app: AppHandle,
    state: State<'_, ProcessManager>,
    stdin_mgr: State<'_, StdinManager>,
    params: StartSessionParams,
) -> Result<SessionInfo, String> {
    let session_id = params.session_id.unwrap_or_else(|| {
        uuid::Uuid::new_v4().to_string()
    });

    // Clean up any existing process with the same session_id
    stdin_mgr.remove(&session_id).await;
    state.remove(&session_id).await;

    // Use persistent stream-json input mode instead of per-message -p mode.
    // This keeps the CLI process alive so slash commands (/rewind, /compact, /cost, etc.) work.
    let mut args = vec![
        "--input-format".to_string(), "stream-json".to_string(),
        "--output-format".to_string(), "stream-json".to_string(),
        "--verbose".to_string(),
        "--include-partial-messages".to_string(),
    ];

    // Resume an existing CLI session if requested
    if let Some(ref resume_id) = params.resume_session_id {
        args.push("--resume".to_string());
        args.push(resume_id.clone());
    }

    if let Some(ref model) = params.model {
        args.push("--model".to_string());
        args.push(model.clone());
    }

    if let Some(ref tools) = params.allowed_tools {
        for tool in tools {
            args.push("--allowedTools".to_string());
            args.push(tool.clone());
        }
    }

    if params.dangerously_skip_permissions.unwrap_or(false) {
        args.push("--dangerously-skip-permissions".to_string());
    } else {
        args.push("--permission-mode".to_string());
        args.push("acceptEdits".to_string());
    }

    // Session mode: ask, plan, or auto (default)
    if let Some(ref mode) = params.session_mode {
        if mode == "ask" || mode == "plan" {
            args.push("--mode".to_string());
            args.push(mode.clone());
        }
    }

    // Extended thinking: inject via --settings JSON
    if params.thinking_enabled.unwrap_or(true) {
        args.push("--settings".to_string());
        args.push(r#"{"alwaysThinkingEnabled":true}"#.to_string());
    }

    // Resolve claude binary — it may not be on the default PATH
    let claude_bin = find_claude_binary().unwrap_or_else(|| {
        #[cfg(target_os = "windows")]
        { "claude.cmd".to_string() }
        #[cfg(not(target_os = "windows"))]
        { "claude".to_string() }
    });

    // Build an enriched PATH for the child process
    let enriched_path = build_enriched_path();

    // Resolve custom environment variables for API provider override (TK-303)
    let resolved_env = resolve_custom_env(params.custom_env.as_ref())?;

    // On Windows, .cmd/.bat files must be launched via cmd /C
    #[cfg(target_os = "windows")]
    let mut child = {
        // Also wrap bare names (no path separator, no extension) via cmd /C
        // so that Windows can resolve .cmd shims on PATH
        let needs_cmd = claude_bin.ends_with(".cmd")
            || claude_bin.ends_with(".bat")
            || (!claude_bin.contains('\\') && !claude_bin.contains('/') && !claude_bin.contains('.'));
        let mut cmd = if needs_cmd {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&claude_bin);
            c
        } else {
            Command::new(&claude_bin)
        };
        cmd.args(&args)
            .current_dir(&params.cwd)
            .env("PATH", &enriched_path)
            .env_remove("CLAUDECODE");
        // Inject custom API provider env vars
        for (key, value) in &resolved_env {
            cmd.env(key, value);
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Hide console window on Windows
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("Failed to spawn claude (tried '{}'): {}", claude_bin, e))?
    };
    #[cfg(not(target_os = "windows"))]
    let mut child = {
        let mut cmd = Command::new(&claude_bin);
        cmd.args(&args)
            .current_dir(&params.cwd)
            .env("PATH", &enriched_path)
            // Clear CLAUDECODE env var so the CLI doesn't refuse to start
            // when TOKENICODE itself is launched from within a Claude Code session.
            .env_remove("CLAUDECODE");
        // Inject custom API provider env vars
        for (key, value) in &resolved_env {
            cmd.env(key, value);
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn claude (tried '{}'): {}", claude_bin, e))?
    };

    let pid = child.id().unwrap_or(0);

    // Capture stdin and store in StdinManager for sending follow-up messages
    let stdin = child.stdin.take()
        .ok_or("Failed to capture stdin")?;
    stdin_mgr.insert(session_id.clone(), stdin).await;

    let stdout = child.stdout.take()
        .ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take()
        .ok_or("Failed to capture stderr")?;

    let sid = session_id.clone();

    state.insert(sid.clone(), ManagedProcess {
        child,
        session_id: sid.clone(),
    }).await;

    // Helper: emit to the main webview using emit_to for reliable delivery
    fn emit_to_frontend(app: &AppHandle, event: &str, payload: Value) -> Result<(), String> {
        if let Err(e1) = app.emit_to("main", event, payload.clone()) {
            // Fallback: use global emit
            if let Err(e2) = app.emit(event, payload) {
                return Err(format!("emit_to failed: {}, emit failed: {}", e1, e2));
            }
        }
        Ok(())
    }

    // Spawn stdout reader — streams NDJSON to frontend
    let app_clone = app.clone();
    let sid_clone = sid.clone();
    tokio::spawn(async move {
        let event_name = format!("claude:stream:{}", sid_clone);
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(json) = serde_json::from_str::<Value>(&line) {
                let _ = emit_to_frontend(&app_clone, &event_name, json);
            }
        }
        let _ = emit_to_frontend(
            &app_clone,
            &event_name,
            serde_json::json!({"type": "process_exit"}),
        );
    });

    // Spawn stderr reader
    let app_clone2 = app.clone();
    let sid_clone2 = sid.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = emit_to_frontend(
                &app_clone2,
                &format!("claude:stderr:{}", sid_clone2),
                serde_json::json!(line),
            );
        }
    });

    // Send the first message via stdin as NDJSON (skip if prompt is empty — pre-warm mode)
    if !params.prompt.is_empty() {
        let first_msg = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": params.prompt
            }
        });
        stdin_mgr.send(&sid, &first_msg.to_string()).await?;
    }

    Ok(SessionInfo {
        session_id: sid,
        pid,
    })
}

#[tauri::command]
async fn send_stdin(
    stdin_mgr: State<'_, StdinManager>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    // Wrap user text in stream-json NDJSON format
    let json_msg = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": message
        }
    });
    stdin_mgr.send(&session_id, &json_msg.to_string()).await
}

#[tauri::command]
async fn send_raw_stdin(
    stdin_mgr: State<'_, StdinManager>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    stdin_mgr.send(&session_id, &message).await
}

#[tauri::command]
async fn kill_session(
    state: State<'_, ProcessManager>,
    stdin_mgr: State<'_, StdinManager>,
    session_id: String,
) -> Result<(), String> {
    stdin_mgr.remove(&session_id).await;
    state.remove(&session_id).await;
    Ok(())
}

/// Path to the file tracking TOKENICODE-managed session IDs
fn tracked_sessions_path() -> std::path::PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    home.join(".tokenicode").join("tracked_sessions.txt")
}

/// Load the set of tracked session IDs
fn load_tracked_sessions() -> std::collections::HashSet<String> {
    use std::io::BufRead;
    let path = tracked_sessions_path();
    let mut set = std::collections::HashSet::new();
    if let Ok(file) = std::fs::File::open(&path) {
        for line in std::io::BufReader::new(file).lines().flatten() {
            let trimmed = line.trim().to_string();
            if !trimmed.is_empty() {
                set.insert(trimmed);
            }
        }
    }
    set
}

/// Register a CLI session ID as managed by TOKENICODE
#[tauri::command]
async fn track_session(session_id: String) -> Result<(), String> {
    let path = tracked_sessions_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create .tokenicode dir: {}", e))?;
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open tracked sessions: {}", e))?;
    writeln!(file, "{}", session_id)
        .map_err(|e| format!("Failed to write session ID: {}", e))?;
    Ok(())
}

/// Delete a session: remove from tracking file and delete the .jsonl file
#[tauri::command]
async fn delete_session(session_id: String, session_path: String) -> Result<(), String> {
    // Remove from tracking file
    let track_path = tracked_sessions_path();
    if track_path.exists() {
        use std::io::BufRead;
        let contents: Vec<String> = {
            let file = std::fs::File::open(&track_path)
                .map_err(|e| format!("Failed to read tracked sessions: {}", e))?;
            std::io::BufReader::new(file)
                .lines()
                .flatten()
                .filter(|line| line.trim() != session_id)
                .collect()
        };
        std::fs::write(&track_path, contents.join("\n") + "\n")
            .map_err(|e| format!("Failed to update tracked sessions: {}", e))?;
    }
    // Delete the .jsonl file
    if !session_path.is_empty() && std::path::Path::new(&session_path).exists() {
        std::fs::remove_file(&session_path)
            .map_err(|e| format!("Failed to delete session file: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn list_sessions() -> Result<Vec<Value>, String> {
    let home = dirs::home_dir().ok_or("Cannot find home dir")?;
    let claude_dir = home.join(".claude").join("projects");

    if !claude_dir.exists() {
        return Ok(vec![]);
    }

    // Only show sessions tracked by TOKENICODE
    let tracked = load_tracked_sessions();

    let mut sessions = vec![];
    if let Ok(entries) = std::fs::read_dir(&claude_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Ok(files) = std::fs::read_dir(entry.path()) {
                    for file in files.flatten() {
                        let path = file.path();
                        if path.extension().map_or(false, |e| e == "jsonl") {
                            if let Some(name) = path.file_stem() {
                                let id = name.to_string_lossy().to_string();

                                // Skip sessions not created by TOKENICODE
                                if !tracked.contains(&id) {
                                    continue;
                                }

                                // Get file metadata for timestamp
                                let modified = std::fs::metadata(&path)
                                    .and_then(|m| m.modified())
                                    .ok()
                                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_millis() as u64)
                                    .unwrap_or(0);

                                // Read first few lines to extract preview and cwd
                                let (preview, cwd) = extract_session_info(&path);

                                // Use cwd from JSONL if available (authoritative),
                                // otherwise fall back to decoding the directory name.
                                let project_dir = entry.file_name()
                                    .to_string_lossy().to_string();
                                let project_name = if cwd.is_empty() {
                                    decode_project_name(&project_dir)
                                } else {
                                    cwd
                                };

                                sessions.push(serde_json::json!({
                                    "id": id,
                                    "path": path.to_string_lossy(),
                                    "project": project_name,
                                    "projectDir": project_dir,
                                    "modifiedAt": modified,
                                    "preview": preview,
                                }));
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort by modified time, newest first
    sessions.sort_by(|a, b| {
        let ta = a["modifiedAt"].as_u64().unwrap_or(0);
        let tb = b["modifiedAt"].as_u64().unwrap_or(0);
        tb.cmp(&ta)
    });

    Ok(sessions)
}

/// Extract preview (first user message) and cwd from a session .jsonl file.
/// Returns (preview, cwd) — cwd may be empty if not found.
fn extract_session_info(path: &std::path::Path) -> (String, String) {
    use std::io::BufRead;
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (String::new(), String::new()),
    };
    let reader = std::io::BufReader::new(file);
    let mut cwd = String::new();
    let mut preview = String::new();

    // Scan up to 100 lines to find cwd and first real user message.
    for line in reader.lines().take(100) {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let json = match serde_json::from_str::<Value>(&line) {
            Ok(j) => j,
            Err(_) => continue,
        };

        // Extract cwd from the first line that has it
        if cwd.is_empty() {
            if let Some(c) = json["cwd"].as_str() {
                if !c.is_empty() {
                    cwd = c.to_string();
                }
            }
        }

        // Extract preview from first user message
        if preview.is_empty() {
            let is_user = json["type"].as_str() == Some("human")
                || json["type"].as_str() == Some("user")
                || json["role"].as_str() == Some("user")
                || json["message"]["role"].as_str() == Some("user");

            if !is_user {
                continue;
            }

            // Try to extract text from message.content array
            if let Some(content) = json["message"]["content"].as_array() {
                // First pass: look for direct text blocks
                for block in content {
                    if let Some(text) = block["text"].as_str() {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            preview = trimmed.chars().take(120).collect();
                            break;
                        }
                    }
                }
                // Second pass: look for text inside nested content
                if preview.is_empty() {
                    for block in content {
                        if let Some(inner) = block["content"].as_array() {
                            for inner_block in inner {
                                if let Some(text) = inner_block["text"].as_str() {
                                    let trimmed = text.trim();
                                    if !trimmed.is_empty() {
                                        preview = trimmed.chars().take(120).collect();
                                        break;
                                    }
                                }
                            }
                            if !preview.is_empty() { break; }
                        }
                        if let Some(text) = block["content"].as_str() {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                preview = trimmed.chars().take(120).collect();
                                break;
                            }
                        }
                    }
                }
            }
            // Try direct content string
            if preview.is_empty() {
                if let Some(text) = json["message"]["content"].as_str() {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        preview = trimmed.chars().take(120).collect();
                    }
                }
            }
        }

        // Stop early if we have both
        if !cwd.is_empty() && !preview.is_empty() {
            break;
        }
    }
    (preview, cwd)
}

/// Decode project directory name back to readable path.
///
/// Claude CLI encodes paths by replacing `/` with `-`, e.g.:
///   /Users/tinyzhuang/Desktop/ppt-maker → -Users-tinyzhuang-Desktop-ppt-maker
///
/// Simple `.replace('-', '/')` fails when directory names contain hyphens
/// (e.g. "ppt-maker" becomes "ppt/maker").
///
/// Claude CLI encodes project paths by replacing `/`, `.`, and ` ` (space)
/// with `-`. This is lossy: "a-b" could mean "a/b", "a.b", "a b", or literal
/// "a-b". We resolve ambiguity via greedy filesystem probing.
///
/// Strategy: greedily match real filesystem segments from left to right.
/// At each position, try the longest possible segment first.  For each
/// candidate span of dash-separated parts, try joining them with the
/// original `-`, then ` ` (space), then `.` — whichever produces a path
/// that actually exists on disk wins.
fn decode_project_name(encoded: &str) -> String {
    // Detect Windows-style encoded paths: "C-Users-..." (drive letter prefix without leading dash)
    // vs Unix-style: "-Users-..." (leading dash = root /)
    let is_windows_path = encoded.len() >= 2
        && encoded.as_bytes()[0].is_ascii_alphabetic()
        && encoded.as_bytes()[1] == b'-';

    let (trimmed, root, sep) = if is_windows_path {
        // Windows: "C-Users-foo" → root = "C:\", rest = "Users-foo"
        let drive = &encoded[0..1];
        let rest = &encoded[2..]; // skip "C-"
        (rest, format!("{}:\\", drive), "\\")
    } else {
        // Unix: "-Users-foo" → root = "/", rest = "Users-foo"
        let rest = encoded.strip_prefix('-').unwrap_or(encoded);
        (rest, "/".to_string(), "/")
    };

    let parts: Vec<&str> = trimmed.split('-').collect();

    if parts.is_empty() {
        return encoded.to_string();
    }

    let mut decoded_segments: Vec<String> = Vec::new();
    let mut i = 0;

    while i < parts.len() {
        let mut best_len = 1;
        let mut best_segment = parts[i].to_string();

        // Build the parent path for existence checking
        let parent = if decoded_segments.is_empty() {
            root.clone()
        } else {
            format!("{}{}", root, decoded_segments.join(sep))
        };

        // Try combining parts[i..j], longest first.
        // For each candidate length, try multiple join separators.
        let max_j = parts.len().min(i + 10); // limit lookahead
        let mut found = false;
        'outer: for j in (i + 1..=max_j).rev() {
            let slice = &parts[i..j];
            // Separators to try: hyphen (original name), space, dot
            for join_sep in ["-", " ", "."] {
                let candidate = slice.join(join_sep);
                let full_path = format!("{}{}{}", parent,
                    if parent.ends_with(sep) { "" } else { sep }, candidate);
                if std::path::Path::new(&full_path).exists() {
                    best_len = j - i;
                    best_segment = candidate;
                    found = true;
                    break 'outer;
                }
            }
        }

        // Handle empty parts from consecutive dashes (e.g. "/." encoded as "--").
        // If we're at an empty part and no filesystem match was found, try
        // prepending a "." to the next segment (hidden dirs like .claude).
        if !found && parts[i].is_empty() {
            // Collect consecutive empty parts (each represents one encoded char)
            let start = i;
            while i < parts.len() && parts[i].is_empty() {
                i += 1;
            }
            let dot_count = i - start; // number of dots/special chars

            if i < parts.len() {
                // Try interpreting as dot-prefixed segment:
                // e.g. empty + "claude-worktrees" → ".claude-worktrees"
                let prefix = ".".repeat(dot_count);
                // Greedy match on the remaining parts after the dots
                let remaining_max = parts.len().min(i + 10);
                let mut dot_found = false;
                for j in (i + 1..=remaining_max).rev() {
                    for join_sep in ["-", " ", "."] {
                        let after = parts[i..j].join(join_sep);
                        let candidate = format!("{}{}", prefix, after);
                        let full_path = format!("{}{}{}", parent,
                            if parent.ends_with(sep) { "" } else { sep }, candidate);
                        if std::path::Path::new(&full_path).exists() {
                            decoded_segments.push(candidate);
                            i = j;
                            dot_found = true;
                            break;
                        }
                    }
                    if dot_found { break; }
                }
                if !dot_found {
                    // Fallback: just use dot + next part as segment
                    let candidate = format!("{}{}", prefix, parts[i]);
                    decoded_segments.push(candidate);
                    i += 1;
                }
            } else {
                // Trailing empty parts — append dots to last segment or ignore
                if let Some(prev) = decoded_segments.last_mut() {
                    prev.push_str(&".".repeat(dot_count));
                }
            }
            continue;
        }

        decoded_segments.push(best_segment);
        i += best_len;
    }

    format!("{}{}", root, decoded_segments.join(sep))
}

#[tauri::command]
async fn load_session(path: String) -> Result<Vec<Value>, String> {
    use std::io::BufRead;
    let file = std::fs::File::open(&path)
        .map_err(|e| format!("Failed to open session: {}", e))?;
    let reader = std::io::BufReader::new(file);
    let mut messages = vec![];
    for line in reader.lines() {
        if let Ok(line) = line {
            if let Ok(json) = serde_json::from_str::<Value>(&line) {
                messages.push(json);
            }
        }
    }
    Ok(messages)
}

#[tauri::command]
async fn open_in_vscode(path: String) -> Result<(), String> {
    Command::new("code")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open VS Code: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Use 'open -R' to reveal (select) the file in Finder
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Explorer: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        // xdg-open on the parent directory
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(path.clone());
        Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| format!("Failed to reveal in file manager: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn open_with_default_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileNode>>,
}

#[tauri::command]
async fn read_file_tree(path: String, depth: Option<u32>) -> Result<Vec<FileNode>, String> {
    let max_depth = depth.unwrap_or(3);
    let root = std::path::Path::new(&path);
    if !root.exists() {
        return Err("Directory does not exist".to_string());
    }
    Ok(read_dir_recursive(root, 0, max_depth))
}

fn read_dir_recursive(dir: &std::path::Path, current_depth: u32, max_depth: u32) -> Vec<FileNode> {
    let mut nodes = vec![];
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return nodes,
    };

    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by(|a, b| {
        let a_dir = a.path().is_dir();
        let b_dir = b.path().is_dir();
        b_dir.cmp(&a_dir).then_with(|| {
            a.file_name().to_string_lossy().to_lowercase()
                .cmp(&b.file_name().to_string_lossy().to_lowercase())
        })
    });

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden files and common ignored dirs
        if name.starts_with('.') || name == "node_modules" || name == "target"
            || name == "__pycache__" || name == ".git"
        {
            continue;
        }

        let path = entry.path();
        let is_dir = path.is_dir();
        let children = if is_dir && current_depth < max_depth {
            Some(read_dir_recursive(&path, current_depth + 1, max_depth))
        } else if is_dir {
            Some(vec![]) // Placeholder for unexpanded dirs
        } else {
            None
        };

        nodes.push(FileNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }
    nodes
}

#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    // Limit to 1MB to prevent loading huge files
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Cannot read file: {}", e))?;
    if metadata.len() > 1_048_576 {
        return Err("File too large (>1MB)".to_string());
    }
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read file: {}", e))
}

/// Check if the app has file system access to a given directory.
/// Returns Ok(true) if readable, Ok(false) if not, Err on other failures.
/// Used at startup to detect macOS TCC restrictions.
#[tauri::command]
async fn check_file_access(path: String) -> Result<bool, String> {
    match std::fs::read_dir(&path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Ok(false),
        Err(e) => Err(format!("Cannot check path: {}", e)),
    }
}

/// Read a binary file and return it as a base64-encoded data URL.
/// Used for previewing images, PDFs, and other binary files in the webview.
/// Limit: 50MB to prevent memory issues.
#[tauri::command]
async fn read_file_base64(path: String) -> Result<String, String> {
    use base64::Engine as _;

    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Cannot read file: {}", e))?;
    if metadata.len() > 50_000_000 {
        return Err("File too large (>50MB)".to_string());
    }

    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Cannot read file: {}", e))?;

    // Guess MIME type from extension
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
async fn write_file_content(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content)
        .map_err(|e| format!("Cannot write file: {}", e))
}

#[tauri::command]
async fn copy_file(src: String, dest: String) -> Result<(), String> {
    std::fs::copy(&src, &dest)
        .map(|_| ())
        .map_err(|e| format!("Cannot copy file: {}", e))
}

#[tauri::command]
async fn rename_file(src: String, dest: String) -> Result<(), String> {
    std::fs::rename(&src, &dest)
        .map_err(|e| format!("Cannot rename file: {}", e))
}

#[tauri::command]
async fn delete_file(path: String) -> Result<(), String> {
    let meta = std::fs::metadata(&path)
        .map_err(|e| format!("Cannot read file: {}", e))?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&path)
            .map_err(|e| format!("Cannot delete directory: {}", e))
    } else {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Cannot delete file: {}", e))
    }
}

#[tauri::command]
async fn export_session_markdown(path: String, output_path: String) -> Result<(), String> {
    use std::io::{BufRead, Write};
    let file = std::fs::File::open(&path)
        .map_err(|e| format!("Failed to open session: {}", e))?;
    let reader = std::io::BufReader::new(file);

    let mut md = String::from("# Claude Code Session\n\n");
    md.push_str(&format!("*Exported from: {}*\n\n---\n\n", path));

    for line in reader.lines() {
        if let Ok(line) = line {
            if let Ok(json) = serde_json::from_str::<Value>(&line) {
                let msg_type = json["type"].as_str().unwrap_or("");
                match msg_type {
                    "user" | "human" => {
                        md.push_str("## User\n\n");
                        let content = &json["message"]["content"];
                        if let Some(text) = content.as_str() {
                            md.push_str(text);
                            md.push_str("\n\n");
                        } else if let Some(arr) = content.as_array() {
                            for block in arr {
                                if let Some(text) = block["text"].as_str() {
                                    md.push_str(text);
                                    md.push_str("\n\n");
                                }
                            }
                        }
                    }
                    "assistant" => {
                        md.push_str("## Assistant\n\n");
                        if let Some(content) = json["message"]["content"].as_array() {
                            for block in content {
                                if block["type"].as_str() == Some("text") {
                                    if let Some(text) = block["text"].as_str() {
                                        md.push_str(text);
                                        md.push_str("\n\n");
                                    }
                                } else if block["type"].as_str() == Some("tool_use") {
                                    let name = block["name"].as_str().unwrap_or("Tool");
                                    md.push_str(&format!("**Tool: {}**\n\n", name));
                                    if let Some(input) = block.get("input") {
                                        md.push_str("```json\n");
                                        md.push_str(&serde_json::to_string_pretty(input)
                                            .unwrap_or_default());
                                        md.push_str("\n```\n\n");
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    let mut out = std::fs::File::create(&output_path)
        .map_err(|e| format!("Failed to create output: {}", e))?;
    out.write_all(md.as_bytes())
        .map_err(|e| format!("Failed to write: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn export_session_json(path: String, output_path: String) -> Result<(), String> {
    use std::io::{BufRead, Write};
    let file = std::fs::File::open(&path)
        .map_err(|e| format!("Failed to open session: {}", e))?;
    let reader = std::io::BufReader::new(file);
    let mut messages = vec![];
    for line in reader.lines() {
        if let Ok(line) = line {
            if let Ok(json) = serde_json::from_str::<Value>(&line) {
                messages.push(json);
            }
        }
    }
    let json_str = serde_json::to_string_pretty(&messages)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    let mut out = std::fs::File::create(&output_path)
        .map_err(|e| format!("Failed to create output: {}", e))?;
    out.write_all(json_str.as_bytes())
        .map_err(|e| format!("Failed to write: {}", e))?;
    Ok(())
}

/// List recent projects by scanning ~/.claude/projects/ directory names
#[tauri::command]
async fn list_recent_projects() -> Result<Vec<Value>, String> {
    let home = dirs::home_dir().ok_or("Cannot find home dir")?;
    let projects_dir = home.join(".claude").join("projects");

    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let mut projects: HashMap<String, u64> = HashMap::new();

    if let Ok(entries) = std::fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let dir_name = entry.file_name().to_string_lossy().to_string();
                let _decoded = decode_project_name(&dir_name);
                // Get the actual path (not the shortened ~/ version)
                let actual_path = dir_name.replace('-', "/");

                // Find the most recent session file in this project
                let mut latest: u64 = 0;
                if let Ok(files) = std::fs::read_dir(entry.path()) {
                    for file in files.flatten() {
                        if let Ok(meta) = file.metadata() {
                            if let Ok(modified) = meta.modified() {
                                if let Ok(dur) = modified.duration_since(std::time::UNIX_EPOCH) {
                                    latest = latest.max(dur.as_millis() as u64);
                                }
                            }
                        }
                    }
                }

                // Only include if the actual directory exists
                if std::path::Path::new(&actual_path).exists() {
                    projects.insert(actual_path.clone(), latest);
                }
            }
        }
    }

    let mut result: Vec<Value> = projects.into_iter().map(|(path, ts)| {
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        let short_path = {
            if let Some(home) = dirs::home_dir() {
                let home_str = home.to_string_lossy().to_string();
                if path.starts_with(&home_str) {
                    format!("~{}", &path[home_str.len()..])
                } else {
                    path.clone()
                }
            } else {
                path.clone()
            }
        };
        serde_json::json!({
            "name": name,
            "path": path,
            "shortPath": short_path,
            "lastUsed": ts,
        })
    }).collect();

    result.sort_by(|a, b| {
        let ta = a["lastUsed"].as_u64().unwrap_or(0);
        let tb = b["lastUsed"].as_u64().unwrap_or(0);
        tb.cmp(&ta)
    });

    Ok(result)
}

/// Start watching a directory for file changes, emit events to frontend
#[tauri::command]
async fn watch_directory(
    app: AppHandle,
    state: State<'_, WatcherManager>,
    path: String,
) -> Result<(), String> {
    use notify::{Watcher, RecursiveMode, Config, Event, EventKind};

    // Stop existing watcher for this path if any
    {
        let mut watchers = state.watchers.lock().await;
        watchers.remove(&path);
    }

    let app_clone = app.clone();
    let path_clone = path.clone();

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let kind = match event.kind {
                EventKind::Create(_) => "created",
                EventKind::Modify(_) => "modified",
                EventKind::Remove(_) => "removed",
                _ => return,
            };
            let paths: Vec<String> = event.paths.iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let _ = app_clone.emit("fs:change", serde_json::json!({
                "kind": kind,
                "paths": paths,
                "root": path_clone,
            }));
        }
    }).map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher.watch(std::path::Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch: {}", e))?;

    let mut watchers = state.watchers.lock().await;
    watchers.insert(path, watcher);

    Ok(())
}

#[tauri::command]
async fn unwatch_directory(
    state: State<'_, WatcherManager>,
    path: String,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().await;
    watchers.remove(&path);
    Ok(())
}

/// Get file size in bytes for a given path
#[tauri::command]
async fn get_file_size(path: String) -> Result<u64, String> {
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Cannot read file metadata: {}", e))?;
    Ok(metadata.len())
}

/// Save a file to a temp directory and return its path.
/// Uses a unique suffix to avoid name collisions (e.g. multiple pasted images all named "image.png").
#[tauri::command]
async fn save_temp_file(name: String, data: Vec<u8>) -> Result<String, String> {
    let tmp = std::env::temp_dir().join("tokenicode");
    std::fs::create_dir_all(&tmp).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    // Split name into stem + extension, append timestamp + counter for uniqueness
    let path_buf = std::path::PathBuf::from(&name);
    let stem = path_buf.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let ext = path_buf.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();

    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let unique_name = format!("{}_{}{}{}", stem, ts, count, ext);
    let path = tmp.join(&unique_name);
    std::fs::write(&path, &data).map_err(|e| format!("Failed to write temp file: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

// ── Slash Commands & Skills ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SlashCommand {
    name: String,
    description: String,
    source: String,
    has_args: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct UnifiedCommand {
    name: String,
    description: String,
    source: String,       // "builtin" | "global" | "project"
    category: String,     // "builtin" | "command" | "skill"
    has_args: bool,
    path: Option<String>, // Only for skills, points to SKILL.md
    immediate: bool,      // true = execute immediately (no message sent)
    #[serde(skip_serializing_if = "Option::is_none")]
    execution: Option<String>,  // "ui" | "cli" | "session" — how command is executed
}

/// Scan and return all available slash commands (built-in + custom .md files)
#[tauri::command]
async fn list_slash_commands(cwd: Option<String>) -> Result<Vec<SlashCommand>, String> {
    let mut commands: Vec<SlashCommand> = vec![];

    // Built-in commands: (name, description, has_args)
    let builtins: [(&str, &str, bool); 29] = [
        ("/ask", "Ask a question without making changes", false),
        ("/bug", "Report a bug with Claude Code", false),
        ("/clear", "Clear conversation history", false),
        ("/code", "Switch to code mode (default)", false),
        ("/compact", "Compact conversation to reduce context", false),
        ("/config", "Open settings panel", false),
        ("/context", "Manage context files and directories", false),
        ("/cost", "Show session cost and token usage", false),
        ("/doctor", "Check Claude Code health status", false),
        ("/exit", "Close the application", false),
        ("/export", "Export conversation to markdown", true),
        ("/help", "Show available commands", false),
        ("/init", "Initialize project configuration", false),
        ("/mcp", "Manage MCP server connections", false),
        ("/memory", "View or edit MEMORY.md files", false),
        ("/model", "Switch the AI model", false),
        ("/permissions", "View and manage tool permissions", false),
        ("/plan", "Enter plan mode for complex tasks", false),
        ("/rename", "Rename the current session", true),
        ("/resume", "Resume a previous session", true),
        ("/rewind", "Rewind conversation to a previous turn", false),
        ("/stats", "Show session statistics", false),
        ("/status", "Show session status", false),
        ("/statusline", "Configure status line display", false),
        ("/tasks", "View running background tasks", false),
        ("/teleport", "Teleport context to a new session", false),
        ("/theme", "Toggle light/dark/system theme", false),
        ("/todos", "View todo items from the session", false),
        ("/usage", "Show detailed token usage breakdown", false),
    ];
    for (name, desc, has_args) in &builtins {
        commands.push(SlashCommand {
            name: name.to_string(),
            description: desc.to_string(),
            source: "builtin".to_string(),
            has_args: *has_args,
        });
    }

    // Helper: scan a directory for .md command files
    fn scan_commands_dir(dir: &std::path::Path, source: &str) -> Vec<SlashCommand> {
        let mut cmds = vec![];
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return cmds,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "md") {
                let stem = path.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let name = format!("/{}", stem);

                let content = std::fs::read_to_string(&path).unwrap_or_default();
                let description = content
                    .lines()
                    .next()
                    .map(|line| line.trim_start_matches('#').trim().to_string())
                    .unwrap_or_else(|| stem.clone());
                let has_args = content.contains("$ARGUMENTS");

                cmds.push(SlashCommand {
                    name,
                    description,
                    source: source.to_string(),
                    has_args,
                });
            }
        }
        cmds
    }

    // Global custom commands: ~/.claude/commands/*.md
    if let Some(home) = dirs::home_dir() {
        let global_dir = home.join(".claude").join("commands");
        commands.extend(scan_commands_dir(&global_dir, "global"));
    }

    // Project custom commands: {cwd}/.claude/commands/*.md
    if let Some(ref cwd_path) = cwd {
        let project_dir = std::path::Path::new(cwd_path).join(".claude").join("commands");
        commands.extend(scan_commands_dir(&project_dir, "project"));
    }

    Ok(commands)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SkillInfo {
    name: String,
    description: String,
    path: String,
    scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    disable_model_invocation: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_invocable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    argument_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

/// YAML frontmatter fields for SKILL.md files
#[derive(Debug, Deserialize, Default)]
struct SkillFrontmatter {
    #[serde(default)]
    description: Option<String>,
    #[serde(default, rename = "disable-model-invocation")]
    disable_model_invocation: Option<bool>,
    #[serde(default, rename = "user-invocable")]
    user_invocable: Option<bool>,
    #[serde(default, rename = "allowed-tools")]
    allowed_tools: Option<Vec<String>>,
    #[serde(default, rename = "argument-hint")]
    argument_hint: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    version: Option<String>,
}

/// Parse YAML frontmatter from a SKILL.md file content.
/// Returns (parsed frontmatter, body text after frontmatter).
fn parse_skill_frontmatter(content: &str) -> (SkillFrontmatter, &str) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (SkillFrontmatter::default(), content);
    }
    // Find the closing ---
    let after_open = &trimmed[3..];
    if let Some(close_idx) = after_open.find("\n---") {
        let yaml_str = &after_open[..close_idx];
        let body_start = 3 + close_idx + 4; // "---" + yaml + "\n---"
        let body = trimmed.get(body_start..).unwrap_or("");
        // Skip leading newline in body
        let body = body.strip_prefix('\n').unwrap_or(body);
        match serde_yaml::from_str::<SkillFrontmatter>(yaml_str) {
            Ok(fm) => (fm, body),
            Err(_) => (SkillFrontmatter::default(), content),
        }
    } else {
        (SkillFrontmatter::default(), content)
    }
}

/// Update or insert a single YAML frontmatter field.
/// If value is None, the field is removed. If no frontmatter exists, one is created.
fn update_frontmatter_field(content: &str, field: &str, value: Option<&str>) -> String {
    let trimmed = content.trim_start();
    if trimmed.starts_with("---") {
        let after_open = &trimmed[3..];
        if let Some(close_idx) = after_open.find("\n---") {
            let yaml_section = &after_open[..close_idx];
            let body = &trimmed[3 + close_idx + 4..];

            // Filter out existing field line
            let mut lines: Vec<&str> = yaml_section
                .lines()
                .filter(|line| {
                    let trimmed_line = line.trim();
                    !trimmed_line.starts_with(&format!("{}:", field))
                })
                .collect();

            // Add field if value is provided
            if let Some(val) = value {
                lines.push(&""); // will be replaced
                let new_line = format!("{}: {}", field, val);
                // Replace the empty placeholder
                let last = lines.len() - 1;
                lines.remove(last);
                let owned_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
                let mut result = String::from("---\n");
                for line in &owned_lines {
                    result.push_str(line);
                    result.push('\n');
                }
                result.push_str(&new_line);
                result.push_str("\n---");
                result.push_str(body);
                return result;
            }

            // Just remove the field
            let owned_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
            if owned_lines.iter().all(|l| l.trim().is_empty()) {
                // No fields left, remove frontmatter entirely
                let body = body.strip_prefix('\n').unwrap_or(body);
                return body.to_string();
            }
            let mut result = String::from("---\n");
            for line in &owned_lines {
                result.push_str(line);
                result.push('\n');
            }
            result.push_str("---");
            result.push_str(body);
            return result;
        }
    }

    // No existing frontmatter — add one if value is provided
    if let Some(val) = value {
        return format!("---\n{}: {}\n---\n{}", field, val, content);
    }

    content.to_string()
}

/// Scan and return all available skills (global + project)
#[tauri::command]
async fn list_skills(cwd: Option<String>) -> Result<Vec<SkillInfo>, String> {
    let mut skills: Vec<SkillInfo> = vec![];

    // Helper: scan a skills directory for */SKILL.md
    fn scan_skills_dir(dir: &std::path::Path, scope: &str) -> Vec<SkillInfo> {
        let mut found = vec![];
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return found,
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                let skill_file = entry_path.join("SKILL.md");
                if skill_file.exists() {
                    let name = entry_path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let content = std::fs::read_to_string(&skill_file).unwrap_or_default();
                    let (fm, body) = parse_skill_frontmatter(&content);

                    // Description priority: frontmatter > first non-empty body line > dir name
                    let description = fm.description
                        .clone()
                        .or_else(|| {
                            body.lines()
                                .find(|line| !line.trim().is_empty())
                                .map(|line| line.trim_start_matches('#').trim().to_string())
                        })
                        .unwrap_or_else(|| name.clone());

                    let path = skill_file.to_string_lossy().to_string();

                    found.push(SkillInfo {
                        name,
                        description,
                        path,
                        scope: scope.to_string(),
                        disable_model_invocation: fm.disable_model_invocation,
                        user_invocable: fm.user_invocable,
                        allowed_tools: fm.allowed_tools,
                        argument_hint: fm.argument_hint,
                        model: fm.model,
                        context: fm.context,
                        agent: fm.agent,
                        version: fm.version,
                    });
                }
            }
        }
        found
    }

    // Global skills: ~/.claude/skills/*/SKILL.md
    if let Some(home) = dirs::home_dir() {
        let global_dir = home.join(".claude").join("skills");
        skills.extend(scan_skills_dir(&global_dir, "global"));
    }

    // Project skills: {cwd}/.claude/skills/*/SKILL.md
    if let Some(ref cwd_path) = cwd {
        let project_dir = std::path::Path::new(cwd_path).join(".claude").join("skills");
        skills.extend(scan_skills_dir(&project_dir, "project"));
    }

    Ok(skills)
}

/// Read a skill file and return its content
#[tauri::command]
async fn read_skill(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read skill file: {}", e))
}

/// Write content to a skill file, creating parent directories if needed
#[tauri::command]
async fn write_skill(path: String, content: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    std::fs::write(&path, &content)
        .map_err(|e| format!("Cannot write skill file: {}", e))
}

/// Delete a skill file; remove the parent directory if it becomes empty
#[tauri::command]
async fn delete_skill(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    std::fs::remove_file(p)
        .map_err(|e| format!("Failed to delete skill file: {}", e))?;

    // If the parent directory is now empty, remove it too
    if let Some(parent) = p.parent() {
        if parent.is_dir() {
            let is_empty = std::fs::read_dir(parent)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);
            if is_empty {
                let _ = std::fs::remove_dir(parent);
            }
        }
    }

    Ok(())
}

/// Unified endpoint that returns all commands and skills in a single call
#[tauri::command]
async fn list_all_commands(cwd: Option<String>) -> Result<Vec<UnifiedCommand>, String> {
    let mut commands: Vec<UnifiedCommand> = vec![];

    // 1. Built-in commands: (name, description, has_args, execution)
    // execution: "ui" = handled in frontend, "cli" = run as separate CLI process, "session" = needs active CLI session
    let builtins: [(&str, &str, bool, &str); 29] = [
        ("/ask", "Ask a question without making changes", false, "ui"),
        ("/bug", "Report a bug with Claude Code", false, "ui"),
        ("/clear", "Clear conversation history", false, "ui"),
        ("/code", "Switch to code mode (default)", false, "ui"),
        ("/compact", "Compact conversation to reduce context", false, "session"),
        ("/config", "Open settings panel", false, "ui"),
        ("/context", "Manage context files and directories", false, "session"),
        ("/cost", "Show session cost and token usage", false, "ui"),
        ("/doctor", "Check Claude Code health status", false, "session"),
        ("/exit", "Close the application", false, "ui"),
        ("/export", "Export conversation to markdown", true, "ui"),
        ("/help", "Show available commands", false, "ui"),
        ("/init", "Initialize project configuration", false, "session"),
        ("/mcp", "Manage MCP server connections", false, "session"),
        ("/memory", "View or edit MEMORY.md files", false, "session"),
        ("/model", "Switch the AI model", false, "ui"),
        ("/permissions", "View and manage tool permissions", false, "session"),
        ("/plan", "Enter plan mode for complex tasks", false, "ui"),
        ("/rename", "Rename the current session", true, "ui"),
        ("/resume", "Resume a previous session", true, "ui"),
        ("/rewind", "Rewind conversation to a previous turn", false, "ui"),
        ("/stats", "Show session statistics", false, "session"),
        ("/status", "Show session status", false, "ui"),
        ("/statusline", "Configure status line display", false, "session"),
        ("/tasks", "View running background tasks", false, "session"),
        ("/teleport", "Teleport context to a new session", false, "session"),
        ("/theme", "Toggle light/dark/system theme", false, "ui"),
        ("/todos", "View todo items from the session", false, "session"),
        ("/usage", "Show detailed token usage breakdown", false, "session"),
    ];
    for (name, desc, has_args, execution) in &builtins {
        commands.push(UnifiedCommand {
            name: name.to_string(),
            description: desc.to_string(),
            source: "builtin".to_string(),
            category: "builtin".to_string(),
            has_args: *has_args,
            path: None,
            immediate: true,
            execution: Some(execution.to_string()),
        });
    }

    // Helper: scan a directory for .md command files
    fn scan_commands_dir(dir: &std::path::Path, source: &str) -> Vec<UnifiedCommand> {
        let mut cmds = vec![];
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return cmds,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "md") {
                let stem = path.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let name = format!("/{}", stem);

                let content = std::fs::read_to_string(&path).unwrap_or_default();
                let description = content
                    .lines()
                    .next()
                    .map(|line| line.trim_start_matches('#').trim().to_string())
                    .unwrap_or_else(|| stem.clone());
                let has_args = content.contains("$ARGUMENTS");

                cmds.push(UnifiedCommand {
                    name,
                    description,
                    source: source.to_string(),
                    category: "command".to_string(),
                    has_args,
                    path: None,
                    immediate: false,
                    execution: None,
                });
            }
        }
        cmds
    }

    // Helper: scan a skills directory for */SKILL.md
    fn scan_skills_dir(dir: &std::path::Path, source: &str) -> Vec<UnifiedCommand> {
        let mut found = vec![];
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return found,
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                let skill_file = entry_path.join("SKILL.md");
                if skill_file.exists() {
                    let name = entry_path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let name_with_slash = format!("/{}", name);
                    let content = std::fs::read_to_string(&skill_file).unwrap_or_default();
                    let (fm, body) = parse_skill_frontmatter(&content);

                    let description = fm.description
                        .clone()
                        .or_else(|| {
                            body.lines()
                                .find(|line| !line.trim().is_empty())
                                .map(|line| line.trim_start_matches('#').trim().to_string())
                        })
                        .unwrap_or_else(|| name.clone());

                    let has_args = fm.argument_hint.is_some();
                    let path = skill_file.to_string_lossy().to_string();

                    found.push(UnifiedCommand {
                        name: name_with_slash,
                        description,
                        source: source.to_string(),
                        category: "skill".to_string(),
                        has_args,
                        path: Some(path),
                        immediate: false,
                        execution: None,
                    });
                }
            }
        }
        found
    }

    // 2. Global custom commands: ~/.claude/commands/*.md
    if let Some(home) = dirs::home_dir() {
        let global_dir = home.join(".claude").join("commands");
        commands.extend(scan_commands_dir(&global_dir, "global"));
    }

    // 3. Project custom commands: {cwd}/.claude/commands/*.md
    if let Some(ref cwd_path) = cwd {
        let project_dir = std::path::Path::new(cwd_path).join(".claude").join("commands");
        commands.extend(scan_commands_dir(&project_dir, "project"));
    }

    // 4. Global skills: ~/.claude/skills/*/SKILL.md
    if let Some(home) = dirs::home_dir() {
        let global_dir = home.join(".claude").join("skills");
        commands.extend(scan_skills_dir(&global_dir, "global"));
    }

    // 5. Project skills: {cwd}/.claude/skills/*/SKILL.md
    if let Some(ref cwd_path) = cwd {
        let project_dir = std::path::Path::new(cwd_path).join(".claude").join("skills");
        commands.extend(scan_skills_dir(&project_dir, "project"));
    }

    Ok(commands)
}

/// Toggle a skill's enabled/disabled state by writing/removing
/// `disable-model-invocation` in its YAML frontmatter.
#[tauri::command]
async fn toggle_skill_enabled(path: String, enabled: bool) -> Result<(), String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read skill file: {}", e))?;
    let new_content = if enabled {
        // Remove disable-model-invocation (or set to false)
        update_frontmatter_field(&content, "disable-model-invocation", None)
    } else {
        // Set disable-model-invocation: true
        update_frontmatter_field(&content, "disable-model-invocation", Some("true"))
    };
    std::fs::write(&path, &new_content)
        .map_err(|e| format!("Cannot write skill file: {}", e))
}

// --- Git / Shell helpers for Rewind code restore ---

/// Run a git command in a specific working directory and return stdout.
/// Only allows safe, read-or-restore git operations.
#[tauri::command]
async fn run_git_command(cwd: String, args: Vec<String>) -> Result<String, String> {
    // Allowlist: only safe git subcommands
    let allowed_subcommands = [
        "status", "diff", "log", "show", "stash", "checkout", "rev-parse",
        "hash-object", "cat-file",
    ];
    let subcmd = args.first().map(|s| s.as_str()).unwrap_or("");
    if !allowed_subcommands.contains(&subcmd) {
        return Err(format!("Git subcommand '{}' not allowed", subcmd));
    }

    let output = Command::new("git")
        .args(&args)
        .current_dir(&cwd)
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("git {} failed: {}", subcmd, stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Read multiple files and return their contents as a map.
/// Used by the snapshot system to capture file states before each turn.
#[tauri::command]
async fn snapshot_files(paths: Vec<String>) -> Result<HashMap<String, String>, String> {
    let mut result = HashMap::new();
    for path in &paths {
        match tokio::fs::read_to_string(path).await {
            Ok(content) => { result.insert(path.clone(), content); }
            Err(_) => { /* File doesn't exist yet — skip */ }
        }
    }
    Ok(result)
}

/// Restore files from a snapshot map. Files in the map are overwritten.
/// Files that existed in the snapshot but not in `deleted_paths` are restored.
/// Files in `deleted_paths` are removed (they were created during the turn).
#[tauri::command]
async fn restore_snapshot(
    snapshot: HashMap<String, String>,
    created_paths: Vec<String>,
) -> Result<(), String> {
    // 1. Restore files from snapshot
    for (path, content) in &snapshot {
        if let Some(parent) = std::path::Path::new(path).parent() {
            tokio::fs::create_dir_all(parent).await
                .map_err(|e| format!("Failed to create dir: {}", e))?;
        }
        tokio::fs::write(path, content).await
            .map_err(|e| format!("Failed to restore {}: {}", path, e))?;
    }

    // 2. Remove files that were created during the turn
    for path in &created_paths {
        let _ = tokio::fs::remove_file(path).await; // ignore errors if already gone
    }

    Ok(())
}

// ── Setup: CLI Detection, Installation & Login ──────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct CliStatus {
    installed: bool,
    path: Option<String>,
    version: Option<String>,
}

/// Run a Claude CLI subcommand (e.g. `claude doctor`) as a one-shot process
/// and return its combined stdout/stderr output.
#[tauri::command]
async fn run_claude_command(subcommand: String, cwd: Option<String>) -> Result<String, String> {
    let binary = find_claude_binary()
        .ok_or_else(|| "Claude CLI not found".to_string())?;
    let enriched_path = build_enriched_path();
    let mut cmd = Command::new(&binary);
    cmd.arg(&subcommand);
    cmd.env("PATH", &enriched_path);
    cmd.env_remove("CLAUDECODE");
    cmd.stdin(Stdio::null());
    if let Some(ref dir) = cwd {
        cmd.current_dir(dir);
    }
    let future = cmd.output();
    let output = tokio::time::timeout(std::time::Duration::from_secs(30), future)
        .await
        .map_err(|_| format!("claude {} timed out after 30s", subcommand))?
        .map_err(|e| format!("Failed to run claude {}: {}", subcommand, e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        let combined = if stderr.is_empty() { stdout } else { format!("{}\n{}", stdout, stderr) };
        Ok(combined.trim().to_string())
    } else {
        let combined = format!("{}\n{}", stdout, stderr);
        Err(combined.trim().to_string())
    }
}

/// Check whether the Claude CLI is installed and return its path and version.
#[tauri::command]
async fn check_claude_cli() -> Result<CliStatus, String> {
    let binary = find_claude_binary();
    match binary {
        Some(path) => {
            // Try to get the version
            let enriched_path = build_enriched_path();
            let version = match Command::new(&path)
                .arg("--version")
                .env("PATH", &enriched_path)
                .output()
                .await
            {
                Ok(output) if output.status.success() => {
                    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if raw.is_empty() { None } else { Some(raw) }
                }
                _ => None,
            };
            Ok(CliStatus { installed: true, path: Some(path), version })
        }
        None => Ok(CliStatus { installed: false, path: None, version: None }),
    }
}

/// GCS bucket base URL for Claude Code releases.
const CLI_DIST_BASE: &str = "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases";

/// Determine the platform identifier for CLI downloads.
fn get_cli_platform() -> Result<(&'static str, &'static str), String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok(("darwin-arm64", "claude")),
        ("macos", "x86_64")  => Ok(("darwin-x64", "claude")),
        ("windows", "x86_64") => Ok(("win32-x64", "claude.exe")),
        ("windows", "aarch64") => Ok(("win32-arm64", "claude.exe")),
        ("linux", "x86_64")  => Ok(("linux-x64", "claude")),
        ("linux", "aarch64") => Ok(("linux-arm64", "claude")),
        (os, arch) => Err(format!("Unsupported platform: {}-{}", os, arch)),
    }
}

/// Download the Claude CLI binary directly via HTTP.
///
/// Flow: fetch latest version → download manifest → download binary → verify SHA256 → run `claude install`.
#[tauri::command]
async fn install_claude_cli(app: AppHandle) -> Result<(), String> {
    let (platform, bin_name) = get_cli_platform()?;

    // 1. Fetch latest version
    let client = reqwest::Client::new();
    let version = client.get(format!("{}/latest", CLI_DIST_BASE))
        .send().await.map_err(|e| format!("Failed to fetch latest version: {}", e))?
        .text().await.map_err(|e| format!("Failed to read version: {}", e))?
        .trim().to_string();

    let _ = app.emit("setup:download:progress", serde_json::json!({
        "downloaded": 0, "total": 0, "percent": 0, "phase": "version"
    }));

    // 2. Download manifest for checksum
    let manifest_url = format!("{}/{}/manifest.json", CLI_DIST_BASE, version);
    let manifest: Value = client.get(&manifest_url)
        .send().await.map_err(|e| format!("Failed to fetch manifest: {}", e))?
        .json::<Value>().await.map_err(|e| format!("Failed to parse manifest: {}", e))?;

    let expected_sha: Option<String> = manifest.get(platform)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 3. Download binary with streaming progress
    let binary_url = format!("{}/{}/{}/{}", CLI_DIST_BASE, version, platform, bin_name);
    let resp = client.get(&binary_url)
        .send().await.map_err(|e| format!("Failed to download CLI: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let install_dir = cli_download_dir()
        .ok_or_else(|| "Cannot determine app data directory".to_string())?;
    std::fs::create_dir_all(&install_dir)
        .map_err(|e| format!("Failed to create install dir: {}", e))?;

    let target_path = install_dir.join(bin_name);
    let mut file = std::fs::File::create(&target_path)
        .map_err(|e| format!("Failed to create binary file: {}", e))?;

    let mut hasher = Sha256::new();
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        file.write_all(&chunk).map_err(|e| format!("Failed to write chunk: {}", e))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        let percent = if total > 0 { (downloaded * 100 / total) as u8 } else { 0 };
        let _ = app.emit("setup:download:progress", serde_json::json!({
            "downloaded": downloaded, "total": total, "percent": percent, "phase": "downloading"
        }));
    }
    drop(file);

    // 4. Verify SHA256 checksum
    if let Some(expected) = expected_sha {
        let actual = format!("{:x}", hasher.finalize());
        if actual != expected {
            // Clean up the bad download
            let _ = std::fs::remove_file(&target_path);
            return Err(format!("Checksum mismatch: expected {}, got {}", expected, actual));
        }
    }

    // 5. Set executable permission (Unix)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&target_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    let _ = app.emit("setup:download:progress", serde_json::json!({
        "downloaded": downloaded, "total": total, "percent": 100, "phase": "installing"
    }));

    // 6. Run `claude install` to complete setup (creates symlinks, PATH entries, etc.)
    let enriched_path = build_enriched_path();
    let install_result = Command::new(target_path.to_string_lossy().to_string())
        .arg("install")
        .env("PATH", &enriched_path)
        .output()
        .await;

    match install_result {
        Ok(output) if output.status.success() => {},
        Ok(output) => {
            // Non-zero exit from `claude install` is non-fatal — the binary itself works
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("claude install warning: {}", stderr);
        },
        Err(e) => {
            eprintln!("claude install failed to run: {} (non-fatal)", e);
        }
    }

    let _ = app.emit("setup:download:progress", serde_json::json!({
        "downloaded": downloaded, "total": total, "percent": 100, "phase": "complete"
    }));

    Ok(())
}

/// Start the Claude OAuth login flow by running `claude login`.
#[tauri::command]
async fn start_claude_login(app: AppHandle) -> Result<(), String> {
    fn emit_to_frontend(app: &AppHandle, event: &str, payload: Value) -> Result<(), String> {
        if let Err(e1) = app.emit_to("main", event, payload.clone()) {
            if let Err(e2) = app.emit(event, payload) {
                return Err(format!("emit_to failed: {}, emit failed: {}", e1, e2));
            }
        }
        Ok(())
    }

    let claude_bin = find_claude_binary().unwrap_or_else(|| {
        #[cfg(target_os = "windows")]
        { "claude.cmd".to_string() }
        #[cfg(not(target_os = "windows"))]
        { "claude".to_string() }
    });
    let enriched_path = build_enriched_path();

    let mut child = Command::new(&claude_bin)
        .args(["login"])
        .env("PATH", &enriched_path)
        .env_remove("CLAUDECODE")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start login: {}", e))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app1 = app.clone();
    let stdout_handle = tokio::spawn(async move {
        if let Some(out) = stdout {
            let reader = BufReader::new(out);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = emit_to_frontend(
                    &app1,
                    "setup:login:output",
                    serde_json::json!({ "stream": "stdout", "line": line }),
                );
            }
        }
    });

    let app2 = app.clone();
    let stderr_handle = tokio::spawn(async move {
        if let Some(err) = stderr {
            let reader = BufReader::new(err);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = emit_to_frontend(
                    &app2,
                    "setup:login:output",
                    serde_json::json!({ "stream": "stderr", "line": line }),
                );
            }
        }
    });

    let status = child.wait().await
        .map_err(|e| format!("Login process error: {}", e))?;

    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

    let code = status.code().unwrap_or(-1);
    let _ = app.emit_to(
        "main",
        "setup:login:exit",
        serde_json::json!({ "code": code }),
    );

    if code != 0 {
        return Err(format!("Login exited with code {}", code));
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
struct AuthStatus {
    authenticated: bool,
}

/// Check whether the Claude CLI is authenticated by running a lightweight check.
#[tauri::command]
async fn check_claude_auth() -> Result<AuthStatus, String> {
    let claude_bin = find_claude_binary().unwrap_or_else(|| {
        #[cfg(target_os = "windows")]
        { "claude.cmd".to_string() }
        #[cfg(not(target_os = "windows"))]
        { "claude".to_string() }
    });
    let enriched_path = build_enriched_path();

    // First try a quick credential file check (instant, no subprocess)
    if let Some(home) = dirs::home_dir() {
        let cred_path = home.join(".claude").join("credentials.json");
        if cred_path.exists() {
            // Credentials file exists — assume authenticated
            return Ok(AuthStatus { authenticated: true });
        }
        // Also check .claude.json (older format)
        let alt_path = std::path::Path::new(&home).join(".claude.json");
        if alt_path.exists() {
            return Ok(AuthStatus { authenticated: true });
        }
    }

    // Fallback: run `claude doctor` with a shorter timeout
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(8),
        Command::new(&claude_bin)
            .args(["doctor"])
            .env("PATH", &enriched_path)
            .env_remove("CLAUDECODE")
            .output(),
    )
    .await;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
            let combined = format!("{} {}", stdout, stderr);

            let has_auth_issue = combined.contains("not authenticated")
                || combined.contains("not logged in")
                || combined.contains("login required")
                || combined.contains("unauthorized")
                || combined.contains("no api key");

            Ok(AuthStatus {
                authenticated: output.status.success() && !has_auth_issue,
            })
        }
        Ok(Err(e)) => Err(format!("Failed to run auth check: {}", e)),
        Err(_) => {
            // Timeout — if CLI exists, assume authenticated (auth issues will surface at runtime)
            Ok(AuthStatus { authenticated: true })
        }
    }
}

/// Path to the session-names metadata file (~/.claude/tokenicode_session_names.json).
fn session_names_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home dir")?;
    Ok(home.join(".claude").join("tokenicode_session_names.json"))
}

/// Load custom session display names from disk.
#[tauri::command]
async fn load_custom_previews() -> Result<Value, String> {
    let path = session_names_path()?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read session names: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse session names: {}", e))
}

/// Save custom session display names to disk.
#[tauri::command]
async fn save_custom_previews(data: Value) -> Result<(), String> {
    let path = session_names_path()?;
    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize session names: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write session names: {}", e))
}

/// Open a native terminal window to run `claude login`.
/// On macOS: uses osascript to open Terminal.app.
/// On Linux: tries common terminal emulators.
/// On Windows: opens cmd.exe.
#[tauri::command]
async fn open_terminal_login() -> Result<(), String> {
    let claude_bin = find_claude_binary().unwrap_or_else(|| {
        #[cfg(target_os = "windows")]
        { "claude.cmd".to_string() }
        #[cfg(not(target_os = "windows"))]
        { "claude".to_string() }
    });

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            r#"tell application "Terminal"
    activate
    do script "{} login"
end tell"#,
            claude_bin
        );
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("Failed to open Terminal: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try common terminal emulators in order of preference
        let xterm_cmd = format!("{} login", claude_bin);
        let terminals = [
            ("gnome-terminal", vec!["--", &claude_bin, "login"]),
            ("konsole", vec!["-e", &claude_bin, "login"]),
            ("xterm", vec!["-e", xterm_cmd.as_str()]),
        ];
        let mut opened = false;
        for (term, args) in &terminals {
            if std::process::Command::new(term)
                .args(args.iter().copied())
                .spawn()
                .is_ok()
            {
                opened = true;
                break;
            }
        }
        if !opened {
            return Err("No supported terminal emulator found".to_string());
        }
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "cmd", "/k", &format!("{} login", claude_bin)])
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
    }

    Ok(())
}

/// Set the macOS dock icon dynamically from base64-encoded PNG data.
#[tauri::command]
async fn set_dock_icon(app: AppHandle, png_base64: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use base64::Engine;
        let data = base64::engine::general_purpose::STANDARD
            .decode(&png_base64)
            .map_err(|e| format!("Invalid base64: {}", e))?;

        // NSApplication APIs must be called on the main thread
        app.run_on_main_thread(move || {
            objc::rc::autoreleasepool(|| {
                unsafe {
                    use objc::runtime::{Class, Object};
                    use objc::msg_send;
                    use objc::sel;
                    use objc::sel_impl;

                    let nsdata_class = Class::get("NSData").unwrap();
                    let nsdata: *mut Object = msg_send![nsdata_class, alloc];
                    let nsdata: *mut Object = msg_send![nsdata,
                        initWithBytes: data.as_ptr()
                        length: data.len()
                    ];

                    let nsimage_class = Class::get("NSImage").unwrap();
                    let nsimage: *mut Object = msg_send![nsimage_class, alloc];
                    let nsimage: *mut Object = msg_send![nsimage, initWithData: nsdata];

                    if !nsimage.is_null() {
                        let nsapp_class = Class::get("NSApplication").unwrap();
                        let nsapp: *mut Object = msg_send![nsapp_class, sharedApplication];
                        let _: () = msg_send![nsapp, setApplicationIconImage: nsimage];
                    }
                }
            });
        }).map_err(|e| format!("Failed to run on main thread: {}", e))?;
    }

    #[cfg(not(target_os = "macos"))]
    let _ = app;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ProcessManager::new())
        .manage(StdinManager::new())
        .manage(WatcherManager::default())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // titleBarStyle: "Overlay" in tauri.conf.json handles macOS traffic lights
            // and native titlebar drag/double-click-to-maximize automatically.

            // Register updater plugin (desktop only)
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            #[cfg(not(desktop))]
            let _ = app;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_claude_session,
            send_stdin,
            send_raw_stdin,
            kill_session,
            track_session,
            delete_session,
            list_sessions,
            load_session,
            read_file_tree,
            read_file_content,
            write_file_content,
            copy_file,
            rename_file,
            delete_file,
            open_in_vscode,
            reveal_in_finder,
            open_with_default_app,
            export_session_markdown,
            export_session_json,
            list_recent_projects,
            watch_directory,
            unwatch_directory,
            save_temp_file,
            get_file_size,
            check_file_access,
            read_file_base64,
            list_slash_commands,
            list_skills,
            read_skill,
            write_skill,
            delete_skill,
            toggle_skill_enabled,
            list_all_commands,
            run_git_command,
            snapshot_files,
            restore_snapshot,
            set_dock_icon,
            run_claude_command,
            check_claude_cli,
            install_claude_cli,
            start_claude_login,
            check_claude_auth,
            open_terminal_login,
            load_custom_previews,
            save_custom_previews,
            save_api_key,
            load_api_key,
            delete_api_key,
            test_api_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod decode_tests {
    use super::decode_project_name;
    
    #[test]
    fn test_simple_path() {
        let result = decode_project_name("-Users-tinyzhuang-Documents-FocusZone");
        assert_eq!(result, "/Users/tinyzhuang/Documents/FocusZone");
    }
    
    #[test]
    fn test_hyphenated_dir() {
        // ppt-maker exists on disk as a dir with hyphens in name
        let result = decode_project_name("-Users-tinyzhuang-Desktop-ppt-maker");
        assert_eq!(result, "/Users/tinyzhuang/Desktop/ppt-maker");
    }
    
    #[test]
    fn test_hidden_dir_double_dash() {
        // FocusZone/.claude-worktrees/condescending-brown
        // "/" → "-", "." → empty part making "--"
        let result = decode_project_name("-Users-tinyzhuang-Documents-FocusZone--claude-worktrees-condescending-brown");
        println!("Result: {}", result);
        // Should contain .claude somewhere
        assert!(result.contains(".claude"), "Expected .claude in path, got: {}", result);
    }
    
    #[test]
    fn test_nested_subdir() {
        let result = decode_project_name("-Users-tinyzhuang-Desktop-test-NiCode");
        // test/NiCode or test-NiCode — depends on what exists on disk
        println!("Result: {}", result);
        assert!(result.starts_with("/Users/tinyzhuang/Desktop/test"));
    }

    #[test]
    fn test_space_in_dir_name() {
        // "jd 设计" exists at ~/Desktop/jd 设计
        let result = decode_project_name("-Users-tinyzhuang-Desktop-jd-设计");
        println!("Result: {}", result);
        // Should decode to "/Users/tinyzhuang/Desktop/jd 设计"
        assert_eq!(result, "/Users/tinyzhuang/Desktop/jd 设计");
    }
}
