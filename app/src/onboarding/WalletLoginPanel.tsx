import { KeyRound, Wallet } from "lucide-react";
import { useState } from "react";

/**
 * 非 local 部署的参与者面登录入口：服务端对参与者读写强制钱包会话锚定，
 * 没有会话时首屏请求 401。此前唯一能触发控制证明的入口藏在邀请流程里，
 * 普通进入/刷新/会话过期的参与者没有任何登录通道——这里补上独立的
 * 钱包登录：连接钱包 → challenge → personal_sign → verify → 重载待办。
 */
export function WalletLoginPanel({
  hasWallet,
  onLogin
}: {
  /** 是否检测到浏览器钱包注入。 */
  readonly hasWallet: boolean;
  readonly onLogin: () => Promise<void>;
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
        登录在当前标签页内保持，过期后重新签名。
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
    </section>
  );
}
