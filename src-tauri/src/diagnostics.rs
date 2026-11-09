//! 生产日志落盘与诊断包导出。
//!
//! 背景：用户反馈里「内存瞬间几十 GB」「读不了图」「偶发重启后恢复」这类稳定性问题数量不多
//! 但风险最高，光靠「重启试试」没法追踪。生产包里 `eprintln!` 与 `console.log` 都不落盘，
//! 这里通过 `tauri-plugin-log` 把 Rust 与前端日志写到同一份带时间戳的轮转文件，并提供
//! 「打开日志目录」「导出诊断包（zip）」两个命令给设置页的反馈 Tab 使用。
//!
//! 位置（由 `app_log_dir` 决定，identifier = com.tinyzhuang.tokenicode）：
//! - macOS   `~/Library/Logs/com.tinyzhuang.tokenicode/tokenicode.log`
//! - Windows `%LOCALAPPDATA%\com.tinyzhuang.tokenicode\logs\tokenicode.log`
//! - Linux   `~/.local/share/com.tinyzhuang.tokenicode/logs/tokenicode.log`
//!
//! 轮转：单文件超过 [`LOG_MAX_FILE_BYTES`] 时改名为 `tokenicode_<日期时间>.log`，
//! 最多保留 [`LOG_KEEP_ROTATED`] 份历史，再加一份当前文件。
//!
//! 脱敏：所有日志行在写入前都经过 [`redact_secrets`]（API key / Bearer / token 参数 /
//! URL userinfo / JWT 等），诊断包里的 Provider 地址只保留 scheme + host。

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// 日志文件名（不含扩展名），轮转文件为 `tokenicode_YYYY-MM-DD_HH-MM-SS.log`。
pub const LOG_FILE_STEM: &str = "tokenicode";
/// 单个日志文件上限：5 MB。
pub const LOG_MAX_FILE_BYTES: u128 = 5 * 1024 * 1024;
/// 轮转后保留的历史文件份数（不含当前活动文件）。
pub const LOG_KEEP_ROTATED: usize = 5;
/// 诊断包里日志总量上限：30 MB（按修改时间从新到旧收录，超出即停）。
const ZIP_LOG_BUDGET_BYTES: u64 = 30 * 1024 * 1024;

// ── 脱敏 ───────────────────────────────────────────────────────────────

struct Redaction {
    pattern: Regex,
    replacement: &'static str,
}

fn redactions() -> &'static [Redaction] {
    static CELL: OnceLock<Vec<Redaction>> = OnceLock::new();
    CELL.get_or_init(|| {
        vec![
            // Anthropic / OpenAI 风格 key：sk-ant-api03-xxxx、sk-xxxx
            Redaction {
                pattern: Regex::new(r"\bsk-[A-Za-z0-9_\-]{8,}").unwrap(),
                replacement: "sk-***",
            },
            // Authorization: Bearer <token>
            Redaction {
                pattern: Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._\-]{8,}").unwrap(),
                replacement: "Bearer ***",
            },
            // JWT（三段 base64url）
            Redaction {
                pattern: Regex::new(
                    r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}",
                )
                .unwrap(),
                replacement: "eyJ***",
            },
            // URL userinfo：https://user:pass@host → https://user:***@host
            Redaction {
                pattern: Regex::new(r"(?i)(https?://[^/\s:@]+):([^/\s@]+)@").unwrap(),
                replacement: "${1}:***@",
            },
            // URL 查询参数：?key=… &token=… &api_key=…
            Redaction {
                pattern: Regex::new(
                    r#"(?i)([?&](?:key|api_key|apikey|token|access_token|secret|password|sig|signature)=)[^&\s"']+"#,
                )
                .unwrap(),
                replacement: "${1}***",
            },
            // 键值对：ANTHROPIC_API_KEY=xxx、x-api-key: xxx、"auth_token": "xxx"、password=xxx
            // `token` 必须是整词（避免误伤 input_tokens / tokenicode）；键名后允许一个闭引号（JSON 形式）。
            Redaction {
                pattern: Regex::new(
                    r#"(?i)\b([a-z0-9_\-]*(?:api[_\-]?key|auth[_\-]?token|access[_\-]?token|refresh[_\-]?token|secret|password|passwd)[a-z0-9_\-]*|token)(["']?\s*[=:]\s*["']?)([^\s"',;&\]\}]{4,})"#,
                )
                .unwrap(),
                replacement: "${1}${2}***",
            },
        ]
    })
}

/// 把一行文本里的凭据替换成 `***`。没有命中时原样返回。
pub fn redact_secrets(input: &str) -> String {
    let mut out = std::borrow::Cow::Borrowed(input);
    for r in redactions() {
        if r.pattern.is_match(&out) {
            out = std::borrow::Cow::Owned(r.pattern.replace_all(&out, r.replacement).into_owned());
        }
    }
    out.into_owned()
}

/// Provider 地址只保留 `scheme://host[:port]`，丢掉路径、查询参数与 userinfo。
pub fn redact_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let (scheme, rest) = match trimmed.split_once("://") {
        Some((s, r)) => (s, r),
        None => return "[invalid-url]".to_string(),
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    // 去掉 user:pass@
    let host = authority.rsplit('@').next().unwrap_or(authority);
    if host.is_empty() {
        return "[invalid-url]".to_string();
    }
    format!("{}://{}", scheme, host)
}

// ── 日志插件装配 ───────────────────────────────────────────────────────

/// 组装 tauri-plugin-log：文件目标（轮转）+ debug 构建下的 stderr。
/// 级别：release = Info，debug = Debug；第三方 crate 一律压到 Warn。
pub fn build_log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use log::LevelFilter;
    use tauri_plugin_log::{Builder, RotationStrategy, Target, TargetKind, TimezoneStrategy};

    let level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    };

    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some(LOG_FILE_STEM.to_string()),
    })];
    if cfg!(debug_assertions) {
        // `pnpm tauri dev` 下仍能在终端看到，和以前 eprintln 的体验一致。
        targets.push(Target::new(TargetKind::Stderr));
    }

    let mut builder = Builder::new()
        // 先清掉默认的 Stdout + LogDir，否则 LogDir 会被注册两次、每行写两遍
        .clear_targets()
        .targets(targets)
        .level(level)
        .max_file_size(LOG_MAX_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(LOG_KEEP_ROTATED))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .format(|out, message, record| {
            out.finish(format_args!(
                "{} [{}] [{}] {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
                record.level(),
                record.target(),
                redact_secrets(&message.to_string()),
            ))
        });

    for noisy in [
        "hyper",
        "hyper_util",
        "reqwest",
        "rustls",
        "h2",
        "tao",
        "wry",
        "tokio_tungstenite",
        "tungstenite",
        "notify",
        "tracing",
        "zbus",
        "tauri_plugin_mcp",
    ] {
        builder = builder.level_for(noisy, LevelFilter::Warn);
    }
    // updater 的 debug 会把整份 latest.json（含各平台签名）打进日志，只留 info 以上
    builder = builder.level_for("tauri_plugin_updater", LevelFilter::Info);

    builder.build()
}

/// 应用日志目录（不存在时创建）。
pub fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("无法解析日志目录: {}", e))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建日志目录: {}", e))?;
    }
    Ok(dir)
}

// ── 诊断包 ─────────────────────────────────────────────────────────────

/// 前端收集的上下文。Rust 侧再补 OS / 版本 / 日志目录等。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct DiagnosticsMeta {
    pub app_name: String,
    pub app_version: String,
    pub locale: Option<String>,
    pub provider_name: Option<String>,
    pub provider_preset: Option<String>,
    pub provider_api_format: Option<String>,
    /// 原始 Base URL，写入前会被 [`redact_url`] 裁成 scheme + host。
    pub provider_base_url: Option<String>,
    pub model: Option<String>,
    /// 最近一个会话的 CLI session id（UUID）。
    pub session_id: Option<String>,
    pub cli_version: Option<String>,
    pub cli_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IncludedLog {
    pub name: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsExportResult {
    pub path: String,
    pub bytes: u64,
    pub log_files: Vec<IncludedLog>,
}

/// 收集日志目录里的 `tokenicode*.log`，按修改时间从新到旧排序。
pub fn collect_log_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return vec![];
    };
    let mut files: Vec<(PathBuf, std::time::SystemTime)> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let name = path.file_name()?.to_string_lossy().into_owned();
            if !name.starts_with(LOG_FILE_STEM) || !name.ends_with(".log") {
                return None;
            }
            let modified = e.metadata().ok()?.modified().ok()?;
            Some((path, modified))
        })
        .collect();
    files.sort_by(|a, b| b.1.cmp(&a.1));
    files.into_iter().map(|(p, _)| p).collect()
}

fn os_version_probe() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()?;
        let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return if v.is_empty() { None } else { Some(format!("macOS {}", v)) };
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("cmd")
            .args(["/C", "ver"])
            .creation_flags(0x08000000)
            .output()
            .ok()?;
        let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return if v.is_empty() { None } else { Some(v) };
    }
    #[cfg(target_os = "linux")]
    {
        let text = std::fs::read_to_string("/etc/os-release").ok()?;
        return text
            .lines()
            .find_map(|l| l.strip_prefix("PRETTY_NAME="))
            .map(|v| v.trim_matches('"').to_string());
    }
    #[allow(unreachable_code)]
    None
}

/// 组装 diagnostics.json 的内容（纯函数，便于测试）。
pub fn build_report(
    meta: &DiagnosticsMeta,
    log_dir: &Path,
    os_version: Option<String>,
) -> serde_json::Value {
    serde_json::json!({
        "generated_at": chrono::Local::now().to_rfc3339(),
        "app": {
            "name": meta.app_name,
            "version": meta.app_version,
            "tauri": tauri::VERSION,
            "debug_build": cfg!(debug_assertions),
        },
        "system": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "os_version": os_version,
        },
        "cli": {
            "version": meta.cli_version,
            "path": meta.cli_path,
        },
        "provider": {
            "name": meta.provider_name,
            "preset": meta.provider_preset,
            "api_format": meta.provider_api_format,
            "base_url": meta.provider_base_url.as_deref().map(redact_url),
        },
        "model": meta.model,
        "last_session_id": meta.session_id,
        "locale": meta.locale,
        "log_dir": log_dir.to_string_lossy(),
        "redaction": "日志逐行经过 redact_secrets（API key / Bearer / token 参数 / URL userinfo / JWT），Provider 地址仅保留 scheme + host。",
    })
}

/// 把日志与报告打成 zip。返回实际收录的日志清单。
pub fn write_diagnostics_zip(
    log_dir: &Path,
    dest: &Path,
    report: &serde_json::Value,
) -> Result<Vec<IncludedLog>, String> {
    use zip::write::SimpleFileOptions;
    use zip::CompressionMethod;

    if let Some(parent) = dest.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目标目录: {}", e))?;
        }
    }
    let file = std::fs::File::create(dest).map_err(|e| format!("无法创建 zip: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let mut included = Vec::new();
    let mut budget = ZIP_LOG_BUDGET_BYTES;
    for path in collect_log_files(log_dir) {
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        let size = meta.len();
        if size > budget {
            break;
        }
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        // 读入内存再逐行脱敏——日志写入时已脱敏，这里是第二道保险。
        let content = std::fs::read(&path).map_err(|e| format!("读取 {} 失败: {}", name, e))?;
        let text = String::from_utf8_lossy(&content);
        let mut sanitized = String::with_capacity(text.len());
        for line in text.lines() {
            sanitized.push_str(&redact_secrets(line));
            sanitized.push('\n');
        }
        zip.start_file(format!("logs/{}", name), opts)
            .map_err(|e| format!("zip 写入失败: {}", e))?;
        zip.write_all(sanitized.as_bytes())
            .map_err(|e| format!("zip 写入失败: {}", e))?;
        budget -= size;
        included.push(IncludedLog { name, bytes: size });
    }

    let mut report = report.clone();
    report["included_logs"] = serde_json::to_value(&included).unwrap_or_default();
    zip.start_file("diagnostics.json", opts)
        .map_err(|e| format!("zip 写入失败: {}", e))?;
    zip.write_all(
        serde_json::to_string_pretty(&report)
            .unwrap_or_else(|_| "{}".to_string())
            .as_bytes(),
    )
    .map_err(|e| format!("zip 写入失败: {}", e))?;

    zip.start_file("README.txt", opts)
        .map_err(|e| format!("zip 写入失败: {}", e))?;
    zip.write_all(
        "TOKENICODE 诊断包\n\n\
         diagnostics.json — 应用 / CLI / 系统 / Provider（已脱敏）/ 模型 / 最近会话 id\n\
         logs/            — 最近的运行日志（按修改时间从新到旧，已逐行脱敏）\n\n\
         日志不含 API Key、Token、代理密码等凭据；如仍发现敏感信息请在反馈时告知。\n"
            .as_bytes(),
    )
    .map_err(|e| format!("zip 写入失败: {}", e))?;

    zip.finish().map_err(|e| format!("zip 收尾失败: {}", e))?;
    Ok(included)
}

// ── Tauri 命令 ─────────────────────────────────────────────────────────

/// 返回日志目录路径（不存在则创建）。
#[tauri::command]
pub fn get_log_dir(app: AppHandle) -> Result<String, String> {
    Ok(log_dir(&app)?.to_string_lossy().into_owned())
}

/// 用系统文件管理器打开日志目录，返回其路径。
#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<String, String> {
    let dir = log_dir(&app)?;
    // 确保至少有一个文件可看：刚安装、还没写过日志时也给个空文件。
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(format!("{}.log", LOG_FILE_STEM)));
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| format!("无法打开日志目录: {}", e))?;
    log::info!("[diagnostics] 用户打开日志目录 {}", dir.display());
    Ok(dir.to_string_lossy().into_owned())
}

/// 导出诊断包到 `dest_path`（前端通过保存对话框选好的 .zip 路径）。
#[tauri::command]
pub async fn export_diagnostics(
    app: AppHandle,
    dest_path: String,
    meta: DiagnosticsMeta,
) -> Result<DiagnosticsExportResult, String> {
    let dir = log_dir(&app)?;
    let dest = PathBuf::from(&dest_path);
    if dest.extension().and_then(|e| e.to_str()) != Some("zip") {
        return Err("导出路径必须以 .zip 结尾".to_string());
    }
    log::info!(
        "[diagnostics] 导出诊断包 → {} (provider={:?}, model={:?}, session={:?})",
        dest.display(),
        meta.provider_name,
        meta.model,
        meta.session_id
    );
    // 把刚写的那行也冲到文件里再打包。
    log::logger().flush();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let report = build_report(&meta, &dir, os_version_probe());
        let included = write_diagnostics_zip(&dir, &dest, &report)?;
        let bytes = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        Ok::<_, String>(DiagnosticsExportResult {
            path: dest.to_string_lossy().into_owned(),
            bytes,
            log_files: included,
        })
    })
    .await
    .map_err(|e| format!("导出任务异常: {}", e))??;

    log::info!(
        "[diagnostics] 诊断包完成: {} bytes, {} 个日志文件",
        result.bytes,
        result.log_files.len()
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_api_keys_and_bearer() {
        let s = "key sk-ant-api03-AbCdEfGhIjKlMnOp and Authorization: Bearer abcdefghijklmnop";
        let r = redact_secrets(s);
        assert!(!r.contains("AbCdEfGh"), "{}", r);
        assert!(!r.contains("abcdefghijklmnop"), "{}", r);
        assert!(r.contains("sk-***"));
        assert!(r.contains("Bearer ***"));
    }

    #[test]
    fn redacts_env_style_pairs_but_keeps_token_counts() {
        let r = redact_secrets(
            r#"ANTHROPIC_API_KEY=abcd1234efgh x-api-key: zzzz9999 "auth_token": "tok_12345678" input_tokens: 1234 tokenicode=ok"#,
        );
        assert!(!r.contains("abcd1234efgh"), "{}", r);
        assert!(!r.contains("zzzz9999"), "{}", r);
        assert!(!r.contains("tok_12345678"), "{}", r);
        assert!(r.contains("input_tokens: 1234"), "{}", r);
        assert!(r.contains("tokenicode=ok"), "{}", r);
    }

    #[test]
    fn redacts_url_userinfo_and_query() {
        let r = redact_secrets(
            "proxy http://alice:s3cret@127.0.0.1:7890 url https://x.com/v1?key=abcdef&model=opus",
        );
        assert!(r.contains("http://alice:***@127.0.0.1:7890"), "{}", r);
        assert!(r.contains("?key=***&model=opus"), "{}", r);
    }

    #[test]
    fn redacts_jwt() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        let r = redact_secrets(&format!("token={}", jwt));
        assert!(!r.contains("SflKxwRJ"), "{}", r);
    }

    #[test]
    fn leaves_plain_lines_alone() {
        let s = "2026-11-09 CLI spawned: pid=123, bin=/usr/local/bin/claude, permission_mode=default";
        assert_eq!(redact_secrets(s), s);
    }

    #[test]
    fn redact_url_keeps_scheme_and_host_only() {
        assert_eq!(
            redact_url("https://api.example.com/v1/messages?key=abc"),
            "https://api.example.com"
        );
        assert_eq!(
            redact_url("http://user:pw@10.0.0.1:8080/anthropic"),
            "http://10.0.0.1:8080"
        );
        assert_eq!(redact_url("not a url"), "[invalid-url]");
        assert_eq!(redact_url("  "), "");
    }

    #[test]
    fn collects_logs_newest_first_and_ignores_other_files() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("tokenicode_2026-11-01_10-00-00.log");
        let cur = dir.path().join("tokenicode.log");
        std::fs::write(&old, "old").unwrap();
        std::fs::write(dir.path().join("other.txt"), "x").unwrap();
        std::fs::write(dir.path().join("notes.log"), "x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&cur, "new").unwrap();
        let files = collect_log_files(dir.path());
        assert_eq!(files, vec![cur, old]);
    }

    #[test]
    fn writes_zip_with_logs_report_and_readme() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("tokenicode.log"),
            "line one\nANTHROPIC_API_KEY=supersecretvalue\n",
        )
        .unwrap();
        let dest = dir.path().join("out").join("diag.zip");
        let meta = DiagnosticsMeta {
            app_name: "TOKENICODE".into(),
            app_version: "0.11.0".into(),
            provider_base_url: Some("https://api.example.com/v1?key=abc".into()),
            ..Default::default()
        };
        let report = build_report(&meta, dir.path(), Some("macOS 15".into()));
        let included = write_diagnostics_zip(dir.path(), &dest, &report).unwrap();
        assert_eq!(included.len(), 1);

        let file = std::fs::File::open(&dest).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec!["README.txt", "diagnostics.json", "logs/tokenicode.log"]
        );

        let mut log_text = String::new();
        std::io::Read::read_to_string(
            &mut archive.by_name("logs/tokenicode.log").unwrap(),
            &mut log_text,
        )
        .unwrap();
        assert!(log_text.contains("line one"));
        assert!(!log_text.contains("supersecretvalue"));

        let mut json_text = String::new();
        std::io::Read::read_to_string(
            &mut archive.by_name("diagnostics.json").unwrap(),
            &mut json_text,
        )
        .unwrap();
        let json: serde_json::Value = serde_json::from_str(&json_text).unwrap();
        assert_eq!(json["provider"]["base_url"], "https://api.example.com");
        assert_eq!(json["app"]["version"], "0.11.0");
        assert_eq!(json["included_logs"][0]["name"], "tokenicode.log");
    }
}
