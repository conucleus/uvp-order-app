import { Fingerprint, KeyRound, Wallet } from "lucide-react";
import { useState } from "react";

/**
 * 非 local 部署的参与者面登录入口：服务端对参与者读写强制钱包会话锚定，
 * 没有会话时首屏请求 401。这里独立于邀请流程提供钱包登录通道：
 * 连接钱包 → challenge → personal_sign → verify → 重载待办。
 */
export function WalletLoginPanel({
  hasWallet,
  onLogin,
  onOpenRegistration
}: {
  /** 是否检测到浏览器钱包注入。 */
  readonly hasWallet: boolean;
  readonly onLogin: () => Promise<void>;
  /** 注册与身份入口：未登录的新实体可先查看注册页（公开身份事实只读）。 */
  readonly onOpenRegistration?: (() => void) | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleLogin() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onLogin();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "钱包登录失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="empty-state" aria-label="钱包登录">
      <KeyRound aria-hidden="true" />
      <h2>需要钱包登录</h2>
      <p>
        此部署要求钱包会话锚定参与者身份。连接浏览器钱包完成一次签名即可查看你的订单与待办；
        登录在本浏览器内保持（跨标签页共用），过期后重新签名。
      </p>
      {hasWallet ? (
        <button className="primary-button" type="button" disabled={busy} onClick={() => void handleLogin()}>
          <Wallet aria-hidden="true" />
          {busy ? "等待钱包签名…" : "连接钱包并登录"}
        </button>
      ) : (
        <p>未检测到浏览器钱包：请先安装钱包扩展（如 MetaMask）后刷新本页。</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {onOpenRegistration ? (
        <button className="quiet-button" type="button" onClick={onOpenRegistration} data-testid="open-registration-button">
          <Fingerprint aria-hidden="true" />
          注册与身份
        </button>
      ) : null}
    </section>
  );
}
