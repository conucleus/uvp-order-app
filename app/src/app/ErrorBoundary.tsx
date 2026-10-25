import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | undefined;
}

/**
 * 应用级错误边界：渲染抛错如实呈现、不自动重试，只提供整页恢复动作。
 */
export class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("order-app render error", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <main className="app-shell" role="alert">
        <section className="system-banner system-banner-error">
          <strong>界面渲染出错</strong>
          <span>
            页面组件渲染时出错，已停止渲染并如实展示错误；没有提交、签名或链上动作被自动重试。
          </span>
        </section>
        <section className="empty-state">
          <AlertTriangle aria-hidden="true" />
          <h2>渲染错误</h2>
          <p className="blocked-copy">{error.message || String(error)}</p>
          <div className="submit-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
            <button
              className="quiet-button"
              type="button"
              onClick={() => {
                window.location.hash = "#section=tasks";
                window.location.reload();
              }}
            >
              回到待办首页
            </button>
          </div>
          {error.stack ? (
            <details className="error-boundary-stack">
              <summary>错误堆栈</summary>
              <pre>{error.stack}</pre>
            </details>
          ) : null}
        </section>
      </main>
    );
  }
}
