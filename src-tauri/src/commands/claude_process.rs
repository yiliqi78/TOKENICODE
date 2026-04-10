use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::process::ChildStdin;
use tokio::sync::{oneshot, Mutex};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionInfo {
    pub session_id: String,
    pub pid: u32,
    pub cli_path: String,
}

/// A managed CLI session whose child process is owned by an independent
/// waiter task. `kill_tx` sends a request to that waiter task to kill
/// the child; the waiter task then emits `process_exit` authoritatively.
#[derive(Debug)]
#[allow(dead_code)]
pub struct ManagedProcess {
    pub session_id: String,
    pub pid: u32,
    /// Kill signal channel to the waiter task. Option so we can take() on remove.
    pub kill_tx: Option<oneshot::Sender<()>>,
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
            // Atomic write: message + newline in one call to prevent interleaving (P1-2 fix)
            let payload = format!("{}\n", message);
            stdin
                .write_all(payload.as_bytes())
                .await
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin
                .flush()
                .await
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
        if let Some(proc) = map.remove(id) {
            // Signal the waiter task to kill the child. The waiter task owns
            // the child and will emit process_exit authoritatively after kill.
            let mut managed = proc.lock().await;
            if let Some(tx) = managed.kill_tx.take() {
                if tx.send(()).is_err() {
                    // Receiver dropped — waiter task already exited because
                    // the child died naturally. No-op is correct.
                }
            }
        }
    }

    /// TK-329: List all active stdinIds so the frontend can detect orphaned processes
    /// after a browser refresh (frontend state is wiped but backend keeps processes alive).
    pub async fn active_ids(&self) -> Vec<String> {
        let map = self.processes.lock().await;
        map.keys().cloned().collect()
    }
}

/// Per-session bypass mode flag, shared between the stdout reader task and
/// the `send_control_request` command. When the user switches permission mode
/// at runtime (e.g. bypass → plan), `send_control_request` updates the flag
/// so the stdout reader's control_request handler uses the current mode.
#[derive(Debug, Default, Clone)]
pub struct BypassModeMap {
    flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl BypassModeMap {
    pub fn new() -> Self {
        Self {
            flags: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a session with its initial bypass mode. Returns a shared flag
    /// for the stdout reader task to read.
    pub async fn register(&self, session_id: &str, is_bypass: bool) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(is_bypass));
        let mut map = self.flags.lock().await;
        map.insert(session_id.to_string(), flag.clone());
        flag
    }

    /// Update bypass mode for a session (called when permission_mode changes at runtime).
    pub async fn set_bypass(&self, session_id: &str, is_bypass: bool) {
        let map = self.flags.lock().await;
        if let Some(flag) = map.get(session_id) {
            flag.store(is_bypass, Ordering::Relaxed);
        }
    }

    /// Remove a session's flag (called on process exit).
    pub async fn remove(&self, session_id: &str) {
        let mut map = self.flags.lock().await;
        map.remove(session_id);
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StartSessionParams {
    pub prompt: String,
    pub cwd: String,
    pub model: Option<String>,
    pub session_id: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    /// When set, resume an existing Claude CLI session instead of starting a new one.
    /// The value should be the Claude CLI session ID (UUID).
    pub resume_session_id: Option<String>,
    /// Thinking effort level: "off", "low", "medium", "high", or "max".
    pub thinking_level: Option<String>,
    /// Session mode: "ask", "plan", or "auto" (default).
    pub session_mode: Option<String>,
    /// Active provider ID from providers.json.
    /// When set, the provider's env vars are injected into the CLI process.
    pub provider_id: Option<String>,
    /// Permission mode for CLI. Maps from frontend session modes:
    ///   "acceptEdits" (code mode) | "default" (ask mode) | "plan" | "bypassPermissions" (bypass)
    /// When not "bypassPermissions", enables --permission-prompt-tool stdio for structured
    /// permission requests via the SDK control protocol.
    pub permission_mode: Option<String>,
}
