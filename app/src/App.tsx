// 订单 app 的唯一工作台流程：钱包会话 → 开单 / 邀请接受 / 订单房间。
// 客户端能力全部来自 @uvp-eth/uvp-client/browser；本文件只做路由与装配。

import { ClipboardList, FilePlus2, FolderKanban } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { createProductClient, getBrowserEthereumProvider } from "@uvp-eth/uvp-client/browser";
import { CreateOrderPage, InvitePage, OrderRoomPage } from "./kernel/pages";
import { createPorts, type Ports } from "./kernel/ports";
import { personalSignKernel, requestWalletAddressKernel } from "./kernel/signing";
import { WalletLoginPanel } from "./onboarding/WalletLoginPanel";
import {
  clearInviteSearchParams,
  readInviteEntryFromSearch,
  readOrderAppRoute,
  routeHash,
  type InviteEntry,
  type OrderAppRoute
} from "./routes/appRoutes";
import {
  createBrowserWalletSessionTokenStore,
  createParticipantSession,
  type ParticipantSession
} from "./session";

interface Runtime {
  readonly session: ParticipantSession;
  readonly ports: Ports;
}

type RuntimeState = { readonly ok: true; readonly runtime: Runtime } | { readonly ok: false; readonly message: string };

export default function App() {
  const runtimeState = useMemo<RuntimeState>(() => {
    const baseUrl = (import.meta.env.VITE_UVP_CHAIN_SERVICES_URL ?? "").trim();
    if (baseUrl.length === 0) {
      return {
        ok: false,
        message:
          "参与者服务地址未配置：请设置 VITE_UVP_CHAIN_SERVICES_URL。Order App 只连接真实参与者服务，没有本地样例数据回退。"
      };
    }
    try {
      const session = createParticipantSession({
        baseUrl,
        personalSign: personalSignKernel,
        tokenStore: createBrowserWalletSessionTokenStore()
      });
      const client = createProductClient({
        baseUrl,
        getSessionToken: () => session.currentSessionToken()
      });
      return { ok: true, runtime: { session, ports: createPorts(client) } };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }, []);

  if (!runtimeState.ok) {
    return <UnconfiguredShell message={runtimeState.message} />;
  }
  return <AppShell runtime={runtimeState.runtime} />;
}

function AppShell({ runtime }: { readonly runtime: Runtime }) {
  const [sessionToken, setSessionToken] = useState<string | undefined>(() => runtime.session.currentSessionToken());
  const [route, setRoute] = useState<OrderAppRoute>(() => readOrderAppRoute());
  const [invite, setInvite] = useState<InviteEntry | undefined>(() => readInviteEntryFromSearch());
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    function handleHashChange() {
      setRoute(readOrderAppRoute());
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const authenticated = sessionToken !== undefined;
  const hasWallet = getBrowserEthereumProvider() !== undefined;

  async function login(): Promise<void> {
    const address = await requestWalletAddressKernel();
    await runtime.session.proveWalletControl(address);
    setSessionToken(runtime.session.currentSessionToken());
  }

  function logout(): void {
    runtime.session.restoreSessionToken(undefined);
    setSessionToken(undefined);
    setInvite(undefined);
  }

  function navigate(next: OrderAppRoute): void {
    window.location.hash = routeHash(next);
    setRoute(next);
  }

  function dismissInvite(): void {
    clearInviteSearchParams();
    setInvite(undefined);
  }

  function handleInviteAccepted(): void {
    dismissInvite();
    navigate({ section: "orders" });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <ClipboardList />
          </span>
          <div>
            <p>UVP Order App</p>
            <h1>订单工作台</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`source-badge ${authenticated ? "source-real" : "source-missing"}`}>
            {authenticated ? "已登录" : "未登录"}
          </span>
          {authenticated ? (
            <button className="quiet-button" type="button" onClick={logout}>
              退出登录
            </button>
          ) : null}
        </div>
      </header>

      {notice ? <SystemBanner tone="info" title="草稿已创建" text={notice} /> : null}

      {!authenticated ? (
        <WalletLoginPanel hasWallet={hasWallet} onLogin={login} />
      ) : invite ? (
        <InvitePage
          ports={runtime.ports}
          inviteId={invite.inviteId}
          inviteToken={invite.inviteToken}
          onAccepted={handleInviteAccepted}
          onRejected={() => {
            dismissInvite();
            navigate({ section: "orders" });
          }}
          onDismiss={dismissInvite}
        />
      ) : (
        <>
          <nav className="section-tabs" aria-label="工作台视图">
            <SectionButton
              active={route.section === "create"}
              label="开单"
              icon={<FilePlus2 />}
              onClick={() => navigate({ section: "create" })}
            />
            <SectionButton
              active={route.section === "orders"}
              label="订单房间"
              icon={<FolderKanban />}
              onClick={() => navigate({ section: "orders" })}
            />
          </nav>
          <section className="workspace">
            {route.section === "orders" ? (
              <OrderRoomPage
                ports={runtime.ports}
                orderId={route.orderId}
                onBack={() => navigate({ section: "create" })}
              />
            ) : (
              <CreateOrderPage
                ports={runtime.ports}
                defaultConfigId={import.meta.env.VITE_UVP_CONFIG_ID}
                defaultConfigVersion={import.meta.env.VITE_UVP_CONFIG_VERSION}
                onCreated={(result) => setNotice(`草稿 ${result.draftId} 已创建；一次性邀请链接见下方「邀请链接」。`)}
                onBack={() => navigate({ section: "create" })}
              />
            )}
          </section>
        </>
      )}
    </main>
  );
}

function SectionButton({
  active,
  label,
  icon,
  onClick
}: {
  readonly active: boolean;
  readonly label: string;
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

function UnconfiguredShell({ message }: { readonly message: string }) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <ClipboardList />
          </span>
          <div>
            <p>UVP Order App</p>
            <h1>订单工作台</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="source-badge source-missing">未配置</span>
        </div>
      </header>
      <SystemBanner tone="warn" title="参与者服务未配置" text={message} />
      <section className="empty-state" aria-label="参与者服务未配置">
        <ClipboardList aria-hidden="true" />
        <h2>暂无订单视图</h2>
        <p>配置参与者服务地址后，这里会显示与当前钱包会话匹配的开单、邀请与订单房间。</p>
      </section>
    </main>
  );
}

function SystemBanner({
  tone,
  title,
  text
}: {
  readonly tone: "info" | "warn" | "error";
  readonly title: string;
  readonly text: string;
}) {
  return (
    <section className={`system-banner system-banner-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      <span>{text}</span>
    </section>
  );
}
