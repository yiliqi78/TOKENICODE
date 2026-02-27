//! SDK Control Protocol types for bidirectional communication with Claude CLI.
//!
//! When launched with `--permission-prompt-tool stdio`, the CLI sends structured
//! `control_request` messages on stdout instead of interactive permission prompts
//! on stderr. TOKENICODE responds via stdin with `control_response` messages.
//!
//! Reference: Claude Agent SDK v0.2.62 NDJSON protocol

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─── CLI → TOKENICODE (stdout) ──────────────────────────────────────────────

/// Top-level discriminator for stdout NDJSON lines.
/// We only need to identify `control_request` messages here — all other
/// message types (`system`, `assistant`, `stream_event`, `result`, etc.)
/// are forwarded to the frontend as-is.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum StdoutMessage {
    #[serde(rename = "control_request")]
    ControlRequest {
        request_id: String,
        request: ControlRequestPayload,
    },
    /// Any other message type — pass through to frontend
    #[serde(other)]
    Other,
}

/// Payload of a `control_request` from CLI.
/// We only handle `can_use_tool` for permission prompts;
/// other subtypes (hook_callback, mcp_message) are logged and auto-allowed.
#[derive(Debug, Deserialize)]
#[serde(tag = "subtype")]
pub enum ControlRequestPayload {
    #[serde(rename = "can_use_tool")]
    CanUseTool {
        tool_name: String,
        #[serde(default)]
        input: Value,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        tool_use_id: Option<String>,
        #[serde(default)]
        agent_id: Option<String>,
        #[serde(default)]
        permission_suggestions: Option<Value>,
        #[serde(default)]
        blocked_path: Option<String>,
        #[serde(default)]
        decision_reason: Option<String>,
    },
    #[serde(rename = "hook_callback")]
    HookCallback {
        callback_id: String,
        #[serde(default)]
        input: Value,
        #[serde(default)]
        tool_use_id: Option<String>,
    },
    #[serde(other)]
    Unknown,
}

// ─── TOKENICODE → CLI (stdin) ───────────────────────────────────────────────

/// Control response envelope written to CLI stdin.
#[derive(Debug, Serialize)]
pub struct ControlResponse {
    pub r#type: &'static str, // always "control_response"
    pub response: ControlResponsePayload,
}

/// Payload of a control response.
#[derive(Debug, Serialize)]
pub struct ControlResponsePayload {
    pub subtype: &'static str, // "success"
    pub request_id: String,
    pub response: PermissionResult,
}

/// Permission decision sent back to CLI.
#[derive(Debug, Serialize)]
#[serde(tag = "behavior")]
pub enum PermissionResult {
    #[serde(rename = "allow")]
    Allow {
        #[serde(rename = "updatedInput", skip_serializing_if = "Option::is_none")]
        updated_input: Option<Value>,
    },
    #[serde(rename = "deny")]
    Deny {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        interrupt: Option<bool>,
    },
}

impl ControlResponse {
    /// Create an "allow" response for a given request.
    pub fn allow(request_id: String) -> Self {
        Self {
            r#type: "control_response",
            response: ControlResponsePayload {
                subtype: "success",
                request_id,
                response: PermissionResult::Allow { updated_input: None },
            },
        }
    }

    /// Create a "deny" response for a given request.
    pub fn deny(request_id: String, message: String, interrupt: bool) -> Self {
        Self {
            r#type: "control_response",
            response: ControlResponsePayload {
                subtype: "success",
                request_id,
                response: PermissionResult::Deny {
                    message,
                    interrupt: if interrupt { Some(true) } else { None },
                },
            },
        }
    }
}

// ─── TOKENICODE → CLI: SDK control requests (stdin) ─────────────────────────

/// Control request envelope for runtime commands sent to CLI stdin.
#[derive(Debug, Serialize)]
pub struct ControlRequest {
    pub r#type: &'static str, // always "control_request"
    pub request_id: String,
    pub request: SdkControlRequestPayload,
}

/// SDK control request subtypes that TOKENICODE can send to CLI.
#[derive(Debug, Serialize)]
#[serde(tag = "subtype")]
pub enum SdkControlRequestPayload {
    #[serde(rename = "interrupt")]
    Interrupt,
    #[serde(rename = "set_permission_mode")]
    SetPermissionMode { mode: String },
    #[serde(rename = "set_model")]
    SetModel {
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
}

impl ControlRequest {
    /// Generate a random request ID (alphanumeric, ~13 chars).
    fn random_id() -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let id: u64 = rng.gen();
        format!("{:x}", id)
    }

    pub fn interrupt() -> Self {
        Self {
            r#type: "control_request",
            request_id: Self::random_id(),
            request: SdkControlRequestPayload::Interrupt,
        }
    }

    pub fn set_permission_mode(mode: String) -> Self {
        Self {
            r#type: "control_request",
            request_id: Self::random_id(),
            request: SdkControlRequestPayload::SetPermissionMode { mode },
        }
    }

    pub fn set_model(model: Option<String>) -> Self {
        Self {
            r#type: "control_request",
            request_id: Self::random_id(),
            request: SdkControlRequestPayload::SetModel { model },
        }
    }
}

// ─── Frontend event payload ─────────────────────────────────────────────────

/// Serialized and emitted to frontend as `claude:permission_request:{sessionId}`.
#[derive(Debug, Serialize, Clone)]
pub struct PermissionRequestEvent {
    pub request_id: String,
    pub tool_name: String,
    pub input: Value,
    pub description: Option<String>,
    pub tool_use_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_can_use_tool() {
        let json = r#"{
            "type": "control_request",
            "request_id": "abc123",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "Bash",
                "input": {"command": "ls -la"},
                "description": "List files",
                "tool_use_id": "tu_001"
            }
        }"#;
        let msg: StdoutMessage = serde_json::from_str(json).unwrap();
        match msg {
            StdoutMessage::ControlRequest { request_id, request } => {
                assert_eq!(request_id, "abc123");
                match request {
                    ControlRequestPayload::CanUseTool { tool_name, description, .. } => {
                        assert_eq!(tool_name, "Bash");
                        assert_eq!(description.unwrap(), "List files");
                    }
                    _ => panic!("Expected CanUseTool"),
                }
            }
            _ => panic!("Expected ControlRequest"),
        }
    }

    #[test]
    fn test_parse_other_message() {
        let json = r#"{"type": "assistant", "message": {}, "uuid": "x", "session_id": "y"}"#;
        let msg: StdoutMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, StdoutMessage::Other));
    }

    #[test]
    fn test_serialize_allow() {
        let resp = ControlResponse::allow("req_001".to_string());
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains(r#""behavior":"allow""#));
        assert!(json.contains(r#""request_id":"req_001""#));
        assert!(!json.contains("updatedInput")); // None should be skipped
    }

    #[test]
    fn test_serialize_deny() {
        let resp = ControlResponse::deny("req_002".to_string(), "User denied".to_string(), true);
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains(r#""behavior":"deny""#));
        assert!(json.contains(r#""message":"User denied""#));
        assert!(json.contains(r#""interrupt":true"#));
    }

    #[test]
    fn test_serialize_interrupt() {
        let req = ControlRequest::interrupt();
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains(r#""type":"control_request""#));
        assert!(json.contains(r#""subtype":"interrupt""#));
    }

    #[test]
    fn test_serialize_set_model() {
        let req = ControlRequest::set_model(Some("claude-opus-4-6".to_string()));
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains(r#""subtype":"set_model""#));
        assert!(json.contains(r#""model":"claude-opus-4-6""#));
    }

    #[test]
    fn test_serialize_set_permission_mode() {
        let req = ControlRequest::set_permission_mode("acceptEdits".to_string());
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains(r#""subtype":"set_permission_mode""#));
        assert!(json.contains(r#""mode":"acceptEdits""#));
    }
}
