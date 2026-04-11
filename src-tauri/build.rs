fn main() {
    // Tell cargo to rebuild the crate whenever any feedback-related env var
    // changes. option_env! is evaluated at compile time; without these hints
    // cargo will happily reuse a stale build where the vars were None.
    println!("cargo:rerun-if-env-changed=FEISHU_APP_ID");
    println!("cargo:rerun-if-env-changed=FEISHU_APP_SECRET");
    println!("cargo:rerun-if-env-changed=FEISHU_RECEIVE_ID");
    println!("cargo:rerun-if-env-changed=FEISHU_RECEIVE_ID_TYPE");

    tauri_build::build()
}
