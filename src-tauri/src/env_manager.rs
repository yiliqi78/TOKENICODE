//! Unified env management for Claude CLI spawns (Phase A · 3.3.1).
//!
//! Before this module, env cleanup for each `Command::new("claude")` call was
//! scattered across 20+ sites in `lib.rs`, `commands/`, etc. — each one hand-
//! wiring `.env_remove(...)` / `.env(..., "")` / `.env("PATH", &enriched_path)`
//! independently. Two symptoms from that:
//!
//! 1. When a new host env var needed sanitizing (`CLAUDE_CODE_OAUTH_TOKEN`,
//!    `ANTHROPIC_MODEL`) we had to find every spawn site and add it — inevitably
//!    missing one. `generate_session_title` was the miss that produced the
//!    symptom in the v0.5.2 "title hangs forever" issue.
//!
//! 2. `.env(KEY, "")` vs `.env_remove(KEY)` aren't equivalent: several third-
//!    party SDKs treat the empty string as "set but invalid" and loop in 401
//!    retries, hanging the parent task. The correct call is `env_remove`.
//!
//! This module is the single source of truth:
//!
//! ```ignore
//! let cfg = ClaudeEnvConfig {
//!     auth_mode: AuthMode::ThirdParty,
//!     enriched_path: Some(build_enriched_path()),
//!     extra: provider_env,
//!     extra_remove: provider_keys_to_remove,
//! };
//! env_manager::apply_to_command(&mut cmd, &cfg);
//! ```
//!
//! The `ENV_REMOVE_LIST` constant is the canonical set of host-injected env
//! vars that must be stripped before spawning a nested Claude CLI. New vars
//! are added here — once — and every spawn site picks it up.

use std::collections::HashMap;
use tokio::process::Command;

/// Authentication context for the spawned Claude CLI.
///
/// - `Native`: user is signed in via `claude login` — Claude's own credential
///   store handles auth; we strip all 3rd-party tokens to avoid conflicts.
/// - `ThirdParty`: a custom provider (base URL + auth token injected). We
///   strip host OAuth vars to ensure the provider settings take precedence.
/// - `CCswitch`: legacy CCswitch multi-profile setup. Same strip-host rule;
///   extras typically include a different ANTHROPIC_BASE_URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMode {
    Native,
    ThirdParty,
    #[allow(dead_code)]
    CCswitch,
}

/// Canonical removal list for every Claude CLI spawn.
///
/// Why each one:
///   - `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` — leaked host credentials
///     would otherwise shadow the nested session's provider auth
///   - `CLAUDE_CODE_OAUTH_TOKEN` / `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` /
///     `CLAUDE_CODE_ENTRYPOINT` — Claude Desktop's host-managed markers that
///     cause the nested CLI to think it's already inside a managed session
///   - `CLAUDECODE` / `CLAUDE_CODE_ENTRY` — nested-launch guards that would
///     refuse to spawn a second CLI
///   - `ANTHROPIC_MODEL` / `ANTHROPIC_BASE_URL` — shadow the user's provider
///     selection if left over from a previous env
pub const ENV_REMOVE_LIST: &[&str] = &[
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_BASE_URL",
];

/// Full spec of what env the spawned CLI should see.
///
/// Callers build one of these once per spawn and hand it to
/// `apply_to_command`. The struct captures intent (auth mode + extras) so
/// future audits can grep for "ClaudeEnvConfig" to see every site.
#[derive(Debug, Clone)]
pub struct ClaudeEnvConfig {
    /// Currently informational — kept on the struct so future migrations can
    /// branch on auth mode (e.g. Windows ps shim vs direct spawn). See the
    /// 20-site migration in the Phase A 3.3.x roadmap.
    #[allow(dead_code)]
    pub auth_mode: AuthMode,
    /// PATH value to set (pre-built via `build_enriched_path`). None means
    /// leave PATH untouched.
    pub enriched_path: Option<String>,
    /// Extra env vars to set (e.g. provider's ANTHROPIC_BASE_URL + TOKEN).
    pub extra: HashMap<String, String>,
    /// Extra env vars to remove on top of ENV_REMOVE_LIST (provider-specific
    /// carve-outs like an alternate auth scheme).
    pub extra_remove: Vec<String>,
}

// Builder chain — used by tests today, and by future spawn-site migrations.
// Each call site in lib.rs will pick one path (builder or struct literal).
#[allow(dead_code)]
impl ClaudeEnvConfig {
    pub fn native() -> Self {
        Self {
            auth_mode: AuthMode::Native,
            enriched_path: None,
            extra: HashMap::new(),
            extra_remove: Vec::new(),
        }
    }

    pub fn with_path(mut self, path: String) -> Self {
        self.enriched_path = Some(path);
        self
    }

    pub fn with_extra(mut self, extra: HashMap<String, String>) -> Self {
        self.extra = extra;
        self
    }

    pub fn with_extra_remove(mut self, remove: Vec<String>) -> Self {
        self.extra_remove = remove;
        self
    }
}

/// Apply the canonical env policy to a tokio Command:
///
/// 1. Remove every var in ENV_REMOVE_LIST (host-leaked markers/tokens)
/// 2. Remove any caller-supplied extras (provider-specific carve-outs)
/// 3. Set PATH if provided
/// 4. On Windows, set MSYS2 path-conversion guards (Chinese path fix)
/// 5. Inject caller-supplied env vars LAST so they override any defaults
///
/// Order matters: removes run before sets, so an `extra_remove` entry can't
/// accidentally wipe an `extra` entry.
pub fn apply_to_command(cmd: &mut Command, cfg: &ClaudeEnvConfig) {
    for key in ENV_REMOVE_LIST {
        cmd.env_remove(key);
    }
    for key in &cfg.extra_remove {
        cmd.env_remove(key);
    }

    if let Some(ref path) = cfg.enriched_path {
        cmd.env("PATH", path);
    }

    #[cfg(target_os = "windows")]
    {
        cmd.env("MSYS_NO_PATHCONV", "1");
        cmd.env("MSYS2_ARG_CONV_EXCL", "*");
    }

    for (k, v) in &cfg.extra {
        cmd.env(k, v);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_remove_list_contains_known_leak_sources() {
        // Guardrail: if a refactor removes an entry, this test catches it.
        // The set was derived from v0.5.1 incidents — each entry was a real
        // leak path at some point.
        let required = [
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_API_KEY",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "CLAUDECODE",
        ];
        for key in required {
            assert!(
                ENV_REMOVE_LIST.contains(&key),
                "ENV_REMOVE_LIST missing critical entry: {}",
                key
            );
        }
    }

    #[test]
    fn env_remove_list_has_no_duplicates() {
        let mut seen = std::collections::HashSet::new();
        for key in ENV_REMOVE_LIST {
            assert!(
                seen.insert(*key),
                "duplicate entry in ENV_REMOVE_LIST: {}",
                key
            );
        }
    }

    #[test]
    fn native_config_is_minimal() {
        let cfg = ClaudeEnvConfig::native();
        assert_eq!(cfg.auth_mode, AuthMode::Native);
        assert!(cfg.enriched_path.is_none());
        assert!(cfg.extra.is_empty());
        assert!(cfg.extra_remove.is_empty());
    }

    #[test]
    fn builder_chain_threads_values_through() {
        let mut extra = HashMap::new();
        extra.insert("ANTHROPIC_BASE_URL".to_string(), "https://x".to_string());
        let cfg = ClaudeEnvConfig::native()
            .with_path("/usr/local/bin:/usr/bin".to_string())
            .with_extra(extra.clone())
            .with_extra_remove(vec!["FOO".to_string()]);
        assert_eq!(
            cfg.enriched_path.as_deref(),
            Some("/usr/local/bin:/usr/bin")
        );
        assert_eq!(cfg.extra, extra);
        assert_eq!(cfg.extra_remove, vec!["FOO".to_string()]);
    }

    // `Command::new(...).env_remove(...)` lacks a public read-back API in
    // stable Rust, so we can't assert "env was actually removed" directly
    // without spawning. The behavioural guarantee is covered by the
    // integration test in `commands/session_meta.rs` once title_gen is wired
    // up to apply_to_command (Phase A · 3.3.2). This module's tests focus on
    // the config builder + list invariants, which are pure data.
    #[test]
    fn apply_to_command_runs_without_panic_for_minimal_config() {
        let cfg = ClaudeEnvConfig::native();
        let mut cmd = Command::new("true");
        apply_to_command(&mut cmd, &cfg);
    }

    #[test]
    fn apply_to_command_runs_for_full_config() {
        let mut extra = HashMap::new();
        extra.insert("ANTHROPIC_AUTH_TOKEN".to_string(), "injected".to_string());
        extra.insert("ANTHROPIC_BASE_URL".to_string(), "https://x".to_string());
        let cfg = ClaudeEnvConfig {
            auth_mode: AuthMode::ThirdParty,
            enriched_path: Some("/usr/local/bin".to_string()),
            extra,
            extra_remove: vec!["CCSWITCH_LOCK".to_string()],
        };
        let mut cmd = Command::new("true");
        apply_to_command(&mut cmd, &cfg);
        // No panic = order of operations held; the Command is now ready to
        // spawn. Output-level verification happens in title_gen integration
        // tests.
    }
}
