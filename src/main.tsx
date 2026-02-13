import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  handleClearAndReload = () => {
    try {
      localStorage.removeItem("tokenicode-settings");
      localStorage.removeItem("tokenicode_custom_previews");
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
            color: "#333",
            padding: 32,
            textAlign: "center",
          }}
        >
          <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: "#888", fontSize: 14, marginBottom: 24, maxWidth: 480 }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: "8px 20px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Retry
            </button>
            <button
              onClick={this.handleClearAndReload}
              style={{
                padding: "8px 20px",
                borderRadius: 8,
                border: "none",
                background: "#8B6CC5",
                color: "#fff",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Clear data & Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
