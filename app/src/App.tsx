import {
  AlertCircle,
  Bell,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  FolderKanban,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import { createProductApiClient, type ProductApiSource, type ProductHomeData } from "./api/productApi";
import { createOrderAppActions } from "./actions/orderAppActions";
import { participantQueryFromSession, readParticipantSession, shortWallet } from "./auth/participant";
import { NotificationCenter, useOrderAppNotifications } from "./notifications/NotificationCenter";
import type { OrderAppNotificationDTO } from "./notifications/types";
import { InviteOnboarding } from "./onboarding/InviteOnboarding";
import { readOrderAppRoute, routeHash, type OrderAppRoute, type OrderAppSection } from "./routes/appRoutes";
import type { TaskSubmissionProof } from "./task-model";
import { TaskWorkspace } from "./workspace/TaskWorkspace";
import "./app/collaboration-notifications.css";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: ProductHomeData }
  | { readonly status: "error"; readonly message: string };

export default function App() {
  const api = useMemo(() => createProductApiClient(), []);
  const actions = useMemo(() => createOrderAppActions(api), [api]);
  const [session] = useState(() => readParticipantSession());
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [route, setRoute] = useState<OrderAppRoute>(() => readOrderAppRoute());
  const [submissionProofs, setSubmissionProofs] = useState<Readonly<Record<string, TaskSubmissionProof>>>({});
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    function handleHashChange() {
      setRoute(readOrderAppRoute());
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void api.loadParticipantHome(participantQueryFromSession(session))
      .then((data) => {
        if (!cancelled) {
          setLoadState({ status: "ready", data });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadState({
            status: "error",
            message: error instanceof Error ? error.message : "参与者服务加载失败"
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, session]);

  const data = loadState.status === "ready" ? loadState.data : undefined;
  const selectedTask = useMemo(() => selectTask(data?.tasks ?? [], route.taskId), [data?.tasks, route.taskId]);
  const selectedOrder = useMemo(
    () => selectOrder(data?.orders ?? [], route.orderId, selectedTask),
    [data?.orders, route.orderId, selectedTask]
  );
  const selectedSubmissionProof = selectedTask ? submissionProofs[selectedTask.taskId] : undefined;
  const notificationState = useOrderAppNotifications(data, session);

  function navigate(nextRoute: OrderAppRoute) {
    window.location.hash = routeHash(nextRoute);
    setRoute(nextRoute);
  }

  function handleRefresh() {
    setLoadState({ status: "loading" });
    void api.loadParticipantHome(participantQueryFromSession(session))
      .then((nextData) => setLoadState({ status: "ready", data: nextData }))
      .catch((error) => setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "参与者服务加载失败"
      }));
  }

  function handleOpenNotification(notification: OrderAppNotificationDTO) {
    void notificationState.markRead(notification);
    navigate({
      section: notification.taskId ? "tasks" : "orders",
      orderId: notification.orderId,
      taskId: notification.taskId
    });
    setNotificationsOpen(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <ClipboardList />
          </span>
          <div>
            <p>UVP Signal Console</p>
            <h1>我的待办</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <SourceBadge source={data?.source} loading={loadState.status === "loading"} />
          <button className="icon-button" onClick={handleRefresh} type="button" aria-label="刷新">
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </header>

      {loadState.status === "error" ? (
        <SystemBanner tone="error" title="参与者服务加载失败" text={loadState.message} />
      ) : null}
      {data?.source.kind === "missing" ? (
        <SystemBanner
          tone="warn"
          title="参与者服务未配置"
          text="请设置 VITE_UVP_CHAIN_SERVICES_URL 或 VITE_PRODUCT_API_BASE_URL；本应用不会自动伪造真实订单。"
        />
      ) : null}
      {data?.source.kind === "demo" ? (
        <SystemBanner
          tone="info"
          title="开发样例模式"
          text="当前数据来自 @uvp-eth/product-dto 样例，仅用于本地验证人机待办界面，不代表真实订单。"
        />
      ) : null}

      {route.inviteId ? (
        <InviteOnboarding
          inviteId={route.inviteId}
          actions={actions}
          session={session}
          onAccepted={handleRefresh}
          onDismiss={() => navigate({ section: "tasks" })}
        />
      ) : (
        <>
          <section className="participant-strip" aria-label="参与者信息">
            <div>
              <span className="overline">参与者</span>
              <strong>{data?.participant.displayName ?? "加载中"}</strong>
              <small>{data?.participant.roleLabels.join(" / ") || "等待身份匹配"}</small>
            </div>
            <div>
              <span className="overline">钱包</span>
              <strong>{shortWallet(data?.participant.walletAddress ?? session.walletAddress)}</strong>
              <small>
                {data?.source.kind === "real"
                  ? data.tasks.length > 0
                    ? `匹配 ${data.tasks.length} 个待办`
                    : "已连接但暂无分配任务"
                  : "用于匹配订单职责和提交签名"}
              </small>
            </div>
            <button
              className="quiet-button notification-toggle"
              type="button"
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <Bell aria-hidden="true" />
              通知{notificationState.unreadCount > 0 ? ` ${notificationState.unreadCount}` : ""}
            </button>
          </section>

          {notificationsOpen ? (
            <NotificationCenter
              loadState={notificationState.loadState}
              onMarkRead={(notification) => {
                void notificationState.markRead(notification);
              }}
              onOpenNotification={handleOpenNotification}
            />
          ) : null}

          <section className="metrics-grid" aria-label="工作概览">
            <Metric label="待处理" value={data?.summary.openTaskCount ?? 0} icon={<FileCheck2 />} />
            <Metric label="运行订单" value={data?.summary.orderCount ?? 0} icon={<FolderKanban />} />
            <Metric label="受阻" value={data?.summary.blockedTaskCount ?? 0} icon={<AlertCircle />} />
            <Metric label="已完成" value={data?.summary.completedTaskCount ?? 0} icon={<CheckCircle2 />} />
          </section>

          <nav className="section-tabs" aria-label="参与者视图">
            <SectionButton
              active={route.section === "tasks"}
              label="我的待办"
              icon={<ClipboardList />}
              onClick={() => navigate({ section: "tasks", taskId: selectedTask?.taskId, orderId: selectedOrder?.orderId })}
            />
            <SectionButton
              active={route.section === "orders"}
              label="订单"
              icon={<FolderKanban />}
              onClick={() => navigate({ section: "orders", taskId: selectedTask?.taskId, orderId: selectedOrder?.orderId })}
            />
            <SectionButton
              active={route.section === "proof"}
              label="证明"
              icon={<ShieldCheck />}
              onClick={() => navigate({ section: "proof", taskId: selectedTask?.taskId, orderId: selectedOrder?.orderId })}
            />
          </nav>

          <section className="workspace" aria-busy={loadState.status === "loading"}>
            {loadState.status === "loading" ? (
              <LoadingState />
            ) : (
              <TaskWorkspace
                actions={actions}
                data={data}
                route={route}
                selectedOrder={selectedOrder}
                selectedTask={selectedTask}
                participantWallet={data?.participant.walletAddress ?? session.walletAddress}
                source={data?.source}
                submissionProof={selectedSubmissionProof}
                onSelectTask={(taskId) => {
                  const task = data?.tasks.find((item) => item.taskId === taskId);
                  navigate({ section: "tasks", taskId, orderId: task?.orderId ?? selectedOrder?.orderId });
                }}
                onPrepareTaskSubmit={(taskId, input) => actions.prepareTaskSubmit(taskId, input)}
                onSubmitTask={(taskId, input) => actions.submitTask(taskId, input)}
                onProofReady={(proof) => setSubmissionProofs((current) => ({
                  ...current,
                  [proof.taskId]: proof
                }))}
                onSubmitted={handleRefresh}
              />
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Metric({ label, value, icon }: { readonly label: string; readonly value: number; readonly icon: ReactElement }) {
  return (
    <div className="metric">
      <span aria-hidden="true">{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function SectionButton({
  active,
  label,
  icon,
  onClick
}: {
  readonly active: boolean;
  readonly label: OrderAppSection extends never ? never : string;
  readonly icon: ReactElement;
  readonly onClick: () => void;
}) {
  return (
    <button className={`section-tab ${active ? "is-active" : ""}`} onClick={onClick} type="button">
      {icon}
      {label}
    </button>
  );
}

function SourceBadge({ source, loading }: { readonly source?: ProductApiSource; readonly loading: boolean }) {
  if (loading) {
    return <span className="source-badge source-loading">加载中</span>;
  }
  if (!source || source.kind === "missing") {
    return <span className="source-badge source-missing">未连接</span>;
  }
  if (source.kind === "demo") {
    return <span className="source-badge source-demo">开发样例模式</span>;
  }
  return <span className="source-badge source-real">已连接</span>;
}

function SystemBanner({ tone, title, text }: { readonly tone: "info" | "warn" | "error"; readonly title: string; readonly text: string }) {
  return (
    <section className={`system-banner system-banner-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      <span>{text}</span>
    </section>
  );
}

function LoadingState() {
  return (
    <section className="empty-state">
      <RefreshCw className="spin" aria-hidden="true" />
      <h2>正在加载待办</h2>
      <p>正在读取参与者订单、任务和证明摘要。</p>
    </section>
  );
}

function selectTask(tasks: readonly ProductTaskDTO[], taskId: string | undefined): ProductTaskDTO | undefined {
  return tasks.find((task) => task.taskId === taskId) ?? tasks.find((task) => task.status === "open") ?? tasks[0];
}

function selectOrder(
  orders: readonly ProductOrderDTO[],
  orderId: string | undefined,
  task: ProductTaskDTO | undefined
): ProductOrderDTO | undefined {
  return orders.find((order) => order.orderId === orderId) ??
    orders.find((order) => order.orderId === task?.orderId) ??
    orders.find((order) => order.status === "active") ??
    orders[0];
}
