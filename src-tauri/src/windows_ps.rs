//! PowerShell command builder for Windows (Phase A · 3.3.3).
//!
//! Windows has a long-standing class of bugs where `powershell -Command
//! "<script>"` breaks when the script or the arguments embedded in it
//! contain characters the cmd.exe / PowerShell parser treats specially:
//! unbalanced quotes, backticks, `$`, parentheses, CJK under non-UTF-8
//! code pages, percent signs inside paths, etc.
//!
//! Historical symptoms in Her:
//!   - User with Chinese username → PATH injection silently fails because
//!     the path gets re-decoded as GBK mid-pipeline.
//!   - Paths containing `'` → we used `'{}'` with `.replace('\'', "''")`
//!     SQL-style escaping. Worked for apostrophes, missed backticks.
//!   - Paths containing `&` → PowerShell interprets as command separator.
//!
//! `powershell -EncodedCommand <base64>` takes a Base64-encoded UTF-16LE
//! string and PowerShell decodes it internally before parsing. The shell
//! never sees the raw script on its command line, so there is no parser
//! to confuse. Microsoft documents this as the recommended path for
//! programmatic invocation.
//!
//! Usage (Windows-only call site):
//! ```ignore
//! let mut cmd = windows_ps::build_encoded_command(
//!     "[Environment]::SetEnvironmentVariable('Path', 'C:\\新用户\\bin', 'User')"
//! );
//! cmd.creation_flags(CREATE_NO_WINDOW).output()?;
//! ```
//!
//! The module compiles on all platforms (no Windows-only API is used in
//! the module body — only `std::process::Command::new("powershell")` and
//! string encoding). This lets the pure-logic unit tests run on CI macOS
//! / Linux runners. The module is only *called* from Windows code paths.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::process::Command;

/// Build a `powershell -NoProfile -NonInteractive -EncodedCommand <b64>`
/// command for the given script.
///
/// The script is encoded as UTF-16LE then Base64. PowerShell's
/// `-EncodedCommand` reverses that. Any character representable in
/// UTF-16 (i.e. the whole Unicode BMP plus surrogates) is safe — there
/// is no shell-level parsing of the script body at all.
///
/// Caller is responsible for setting `creation_flags(0x08000000)` (no
/// console window) if desired — this helper does not, because not every
/// caller wants to suppress output.
///
/// `#[allow(dead_code)]`: the only call sites are inside
/// `#[cfg(target_os = "windows")]` blocks in `setup.rs`, so on macOS /
/// Linux builds this function appears unused. The module itself compiles
/// cross-platform so the unit tests can run anywhere.
#[allow(dead_code)]
pub fn build_encoded_command(script: &str) -> Command {
    let encoded = encode_ps_script(script);
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded]);
    cmd
}

/// Internal: encode a UTF-8 Rust string as UTF-16LE Base64 (PowerShell's
/// accepted format for `-EncodedCommand`).
#[allow(dead_code)]
pub fn encode_ps_script(script: &str) -> String {
    // `encode_utf16` produces u16 values in native endian. We need LE
    // bytes explicitly — `to_le_bytes` guarantees that regardless of
    // host endianness. (Windows is always little-endian, but being
    // explicit costs nothing and makes the intent obvious.)
    let utf16_le: Vec<u8> = script
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();
    BASE64.encode(&utf16_le)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hand-verified against `powershell -EncodedCommand` behavior: this
    /// matches what `[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("Write-Host hi"))`
    /// produces inside a real PowerShell session.
    #[test]
    fn encodes_ascii_script_as_utf16le_base64() {
        let got = encode_ps_script("Write-Host hi");
        // "Write-Host hi" as UTF-16LE:
        //   W=57 00, r=72 00, i=69 00, t=74 00, e=65 00, -=2D 00,
        //   H=48 00, o=6F 00, s=73 00, t=74 00, (space)=20 00,
        //   h=68 00, i=69 00
        // Base64 of those 26 bytes:
        assert_eq!(got, "VwByAGkAdABlAC0ASABvAHMAdAAgAGgAaQA=");
    }

    #[test]
    fn encodes_cjk_characters() {
        // Real-world scenario: user with Chinese username
        // "C:\用户\bin" — '用'=7528, '户'=6237.
        let got = encode_ps_script("C:\\用户\\bin");
        // Decode back and verify round-trip. We don't hard-code the
        // expected base64 here because it's enough to confirm the
        // decoder gets the same string back.
        let decoded_bytes = BASE64.decode(&got).expect("valid base64");
        assert_eq!(decoded_bytes.len() % 2, 0);
        let utf16: Vec<u16> = decoded_bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let decoded_string = String::from_utf16(&utf16).expect("valid UTF-16");
        assert_eq!(decoded_string, "C:\\用户\\bin");
    }

    #[test]
    fn encodes_shell_metacharacters_without_escape() {
        // The whole point of this module: characters that would break
        // a naive `powershell -Command "..."` invocation should pass
        // through unchanged because the shell never parses them.
        let tricky = r#"$env:PATH = 'C:\`a''b&c|d"e'"#;
        let encoded = encode_ps_script(tricky);
        let decoded_bytes = BASE64.decode(&encoded).expect("valid base64");
        let utf16: Vec<u16> = decoded_bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let decoded = String::from_utf16(&utf16).expect("valid UTF-16");
        assert_eq!(decoded, tricky);
    }

    #[test]
    fn empty_script_produces_empty_base64() {
        assert_eq!(encode_ps_script(""), "");
    }

    #[test]
    fn build_command_sets_expected_args() {
        let cmd = build_encoded_command("Write-Host hi");
        // Can't easily inspect `cmd.get_args()` across Rust versions in a
        // stable way without unstable API. Instead, verify the program
        // name — the encoding is already covered by the tests above.
        assert_eq!(cmd.get_program(), "powershell");
        let args: Vec<_> = cmd.get_args().collect();
        assert_eq!(args.len(), 4);
        assert_eq!(args[0], "-NoProfile");
        assert_eq!(args[1], "-NonInteractive");
        assert_eq!(args[2], "-EncodedCommand");
        assert_eq!(args[3], "VwByAGkAdABlAC0ASABvAHMAdAAgAGgAaQA=");
    }
}
