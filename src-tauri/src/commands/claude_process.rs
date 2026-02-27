use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionInfo {
    pub session_id: String,
    pub pid: u32,
}

#[derive(Debug)]
pub struct ManagedProcess {
    pub child: Child,
    pub session_id: String,
}

#[derive(Debug, Default)]
pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, Arc<Mutex<ManagedProcess>>>>>,
}

/// Manages stdin handles for sending user responses to Claude processes
#[derive(Debug, Default, Clone)]
pub struct StdinManager {
    handles: Arc<Mutex<HashMap<String, ChildStdin>>>,
}

impl StdinManager {
    pub fn new() -> Self {
        Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn insert(&self, id: String, stdin: ChildStdin) {
        let mut map = self.handles.lock().await;
        map.insert(id, stdin);
    }

    pub async fn send(&self, id: &str, message: &str) -> Result<(), String> {
        let mut map = self.handles.lock().await;
        if let Some(stdin) = map.get_mut(id) {
            stdin.write_all(message.as_bytes()).await
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin.write_all(b"\n").await
                .map_err(|e| format!("Failed to write newline: {}", e))?;
            stdin.flush().await
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
            Ok(())
        } else {
            Err(format!("No stdin handle for session: {}", id))
        }
    }

    pub async fn remove(&self, id: &str) {
        let mut map = self.handles.lock().await;
        map.remove(id);
    }
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn insert(&self, id: String, process: ManagedProcess) {
        let mut map = self.processes.lock().await;
        map.insert(id, Arc::new(Mutex::new(process)));
    }

    pub async fn remove(&self, id: &str) {
        let mut map = self.processes.lock().await;
        map.remove(id);
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StartSessionParams {
    pub prompt: String,
    pub cwd: String,
    pub model: Option<String>,
    pub session_id: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub dangerously_skip_permissions: Option<bool>,
    /// When set, resume an existing Claude CLI session instead of starting a new one.
    /// The value should be the Claude CLI session ID (UUID).
    pub resume_session_id: Option<String>,
    /// Thinking effort level: "off", "low", "medium", "high", or "max".
    pub thinking_level: Option<String>,
    /// Session mode: "ask", "plan", or "auto" (default).
    pub session_mode: Option<String>,
    /// Custom environment variables for API provider override.
    /// Used by TK-303 to inject ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, etc.
    pub custom_env: Option<HashMap<String, String>>,
    /// Permission mode for CLI. Maps from frontend session modes:
    ///   "acceptEdits" (code mode) | "default" (ask mode) | "plan" | "bypassPermissions" (bypass)
    /// When not "bypassPermissions", enables --permission-prompt-tool stdio for structured
    /// permission requests via the SDK control protocol.
    pub permission_mode: Option<String>,
}
