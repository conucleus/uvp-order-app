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
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import {
  createProductApiClient,
  isWalletIdentityRequired,
  persistWalletSessionToken,
  readPersistedWalletSessionToken,
  type ProductApiClient,
  type ProductHomeData
} from "./api/productApi";
import { createOrderAppActions } from "./actions/orderAppActions";
import { participantQueryFromSession, readParticipantSession, shortWallet } from "./auth/participant";
import { NotificationCenter, useOrderAppNotifications } from "./notifications/NotificationCenter";
import type { OrderAppNotificationDTO } from "./notifications/types";
import { InviteOnboarding } from "./onboarding/InviteOnboarding";
import { WalletLoginPanel } from "./onboarding/WalletLoginPanel";
import {
  clearInviteSearchParams,
  readInviteEntryFromSearch,
  readOrderAppRoute,
  routeHash,
  type InviteEntry,
  type OrderAppRoute,
  type OrderAppSection
} from "./routes/appRoutes";
import { personalSignWithInjectedWallet } from "./wallet/injectedWallet";
import type { TaskSubmissionProof } from "./task-model";
import { TaskWorkspace } from "./workspace/TaskWorkspace";
import "./app/collaboration-notifications.css";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: ProductHomeData }
  | { readonly status: "error"; readonly message: string }
  /** 非 local 部署缺有效钱包会话：切换到钱包登录入口而不是报错死路。 */
  | { readonly status: "unauthenticated"; readonly message: string };

export default function App() {
  const clientState = useMemo<{ readonly api?: ProductApiClient; readonly message?: string }>(() => {
    try {
      return {
        api: createProductApiClient({
          // accept 邀请的钱包控制证明走服务端会话（challenge → personal_sign → verify）。
          personalSign: (address, message) => personalSignWithInjectedWallet({ address, message })
        })
      };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "参与者服务地址未配置。"
      };
    }
  }, []);

  if (!clientState.api) {
    return <UnconfiguredShell message={clientState.message ?? "参与者服务地址未配置。"} />;
  }
  return <AppShell api={clientState.api} />;
}

function UnconfiguredShell({ message }: { readonly message: string }) {
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
          <span className="source-badge source-missing">未连接</span>
        </div>
      </header>
      <SystemBanner tone="warn" title="参与者服务未配置" text={message} />
      <section className="empty-state" aria-label="我的待办">
        <FileCheck2 aria-hidden="true" />
        <h2>暂无待办</h2>
        <p>连接参与者服务后，这里会显示与你的钱包或邀请身份匹配的订单任务。</p>
      </section>
    </main>
  );
}

function AppShell({ api }: { readonly api: ProductApiClient }) {
  const actions = useMemo(() => createOrderAppActions(api), [api]);
  const [session] = useState(() => readParticipantSession());
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  // 会话恢复：proveWalletControl 留存的 token 会话级持久化，刷新页面时
  // 先恢复再请求——非 local 部署没有会话锚定身份的请求一律 401。
  const [sessionRestored] = useState(() => api.restoreSessionToken(readPersistedWalletSessionToken()));
  const [route, setRoute] = useState<OrderAppRoute>(() => readOrderAppRoute());
  // ?invite=&inviteToken= 只作为进入应用的邀请入口读取进 state；地址栏上的
  // 一次性令牌保留到流程终态（accept/reject 成功或明确离开）才清除——
  // 中途失败/刷新必须能重新读到令牌重试，挂载即清会把可重试失败变成死路。
  // 路由只认 hash，search 残留不会在 hash 导航后还原邀请面板；渲染条件是
  // route.inviteId || inviteEntry，离开流程时两者同步清掉，工作区恢复可达。
  const [inviteEntry, setInviteEntry] = useState<InviteEntry | undefined>(() => readInviteEntryFromSearch());
  const [submissionProofs, setSubmissionProofs] = useState<Readonly<Record<string, TaskSubmissionProof>>>({});
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // 慢网下旧响应不得覆盖新响应：所有 loadParticipantHome 调用共用单调序号。
  const loadSequenceRef = useRef(0);

  useEffect(() => {
    function handleHashChange() {
      setRoute(readOrderAppRoute());
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    loadParticipantHome();
  }, [api, session, sessionRestored]);

  function loadParticipantHome(options: { readonly silent?: boolean } = {}) {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    // 静默刷新（提交成功后的投影刷新）不退回整页 loading：工作区保持挂载，
    // 提交确认结果不被卸载清掉；新数据到达后原地替换。
    if (!options.silent) {
      setLoadState({ status: "loading" });
    }
    void api.loadParticipantHome(participantQueryFromSession(session))
      .then((data) => {
        if (loadSequenceRef.current === sequence) {
          setLoadState({ status: "ready", data });
        }
      })
      .catch((error) => {
        if (loadSequenceRef.current !== sequence) {
          return;
        }
        if (isWalletIdentityRequired(error)) {
          // 持久化的会话已失效（或从未建立）：清掉残留 token，给出登录
          // 入口——重发同一无会话请求只会再吃一次 401。
          persistWalletSessionToken(undefined);
          api.restoreSessionToken(undefined);
          setLoadState({ status: "unauthenticated", message: error.message });
          return;
        }
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "参与者服务加载失败"
        });
      });
  }

  async function handleWalletLogin(): Promise<void> {
    const address = await actions.requestWalletAddress();
    await actions.proveWalletControl({ address });
    loadParticipantHome();
  }

  const data = loadState.status === "ready" ? loadState.data : undefined;
  const selectedTask = useMemo(() => selectTask(data?.tasks ?? [], route.taskId), [data?.tasks, route.taskId]);
  const selectedOrder = useMemo(
    () => selectOrder(data?.orders ?? [], route.orderId, selectedTask),
    [data?.orders, route.orderId, selectedTask]
  );
  const selectedSubmissionProof = selectedTask ? submissionProofs[selectedTask.taskId] : undefined;
  // 通知中心与主客户端共用同一钱包会话（会话锚定身份单一来源）；
  // 取值器按 api 记忆，避免每次渲染都触发通知 effect 重跑。
  const notificationSessionToken = useMemo(() => () => api.currentSessionToken(), [api]);
  const notificationState = useOrderAppNotifications(data, session, notificationSessionToken);

  function navigate(nextRoute: OrderAppRoute) {
    window.location.hash = routeHash(nextRoute);
    setRoute(nextRoute);
  }

  function handleRefresh(options: { readonly silent?: boolean } = {}) {
    loadParticipantHome(options);
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

  /** accept 终态成功：服务端已消费一次性令牌，立即从地址栏清除并刷新待办。 */
  function handleInviteAccepted() {
    clearInviteSearchParams();
    handleRefresh();
  }

  function dismissInviteEntry() {
    // 明确离开邀请流程（放弃，或终态成功后的返回）才消费 URL 上的令牌。
    clearInviteSearchParams();
    setInviteEntry(undefined);
    navigate({ section: "tasks" });
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
          <button className="icon-button" onClick={() => handleRefresh()} type="button" aria-label="刷新">
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </header>

      {loadState.status === "error" ? (
        <SystemBanner tone="error" title="参与者服务加载失败" text={loadState.message} />
      ) : null}

      {route.inviteId || inviteEntry ? (
        <InviteOnboarding
          inviteId={route.inviteId ?? inviteEntry?.inviteId ?? ""}
          inviteToken={inviteEntry?.inviteToken}
          actions={actions}
          session={session}
          onAccepted={handleInviteAccepted}
          onRejected={clearInviteSearchParams}
          onDismiss={dismissInviteEntry}
        />
      ) : loadState.status === "unauthenticated" ? (
        // 非 local 部署的无会话态：登录是唯一可用入口，不渲染待办工作区
        //（渲染了也只是一整屏 401 派生错误）。
        <WalletLoginPanel hasWallet={actions.hasInjectedWallet()} onLogin={handleWalletLogin} />
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
                {data
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
                onSubmitted={() => handleRefresh({ silent: true })}
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

function SourceBadge({ source, loading }: { readonly source?: ProductHomeData["source"] | undefined; readonly loading: boolean }) {
  if (loading) {
    return <span className="source-badge source-loading">加载中</span>;
  }
  if (!source) {
    return <span className="source-badge source-missing">未连接</span>;
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
    orders.find((order) => order.status === "registered") ??
    orders[0];
}
