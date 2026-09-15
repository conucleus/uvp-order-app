import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | undefined;
}

/**
 * 应用级错误边界：子组件渲染抛错不再整页灰白（React 卸载整棵树的默认
 * 行为）。错误如实呈现——不吞错、不装成功、不自动重试；恢复导航只提供
 * 明确的整页动作（重载 / 回待办首页），因为边界无法判断崩溃的子树内部
 * 哪些状态还能被信任。
 */
export class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 降级日志通道：边界渲染时组件树已不可信，console 是最后可靠的出口。
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
                // 回默认待办路由后整页重载：崩溃可能来自某个订单/任务子树，
                // 保留原 hash 重载可能立刻复现同一错误（appRoutes 只认
                // section=tasks 形态的 hash）。
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
