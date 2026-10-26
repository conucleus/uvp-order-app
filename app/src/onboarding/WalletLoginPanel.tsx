import { KeyRound, Wallet } from "lucide-react";
import { useState } from "react";

/**
 * 参与者面登录入口：连接钱包 → challenge → personal_sign → verify → 会话
 * token 写入宿主存储。登录失败按错误信息如实呈现，不自动重试。
 */
export function WalletLoginPanel({
  hasWallet,
  onLogin
}: {
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
        连接浏览器钱包完成一次签名即可进入你的订单工作台；
        登录在本浏览器内保持（跨标签页共用），过期后重新签名。
      </p>
      {hasWallet ? (
        <button className="primary-button" type="button" disabled={busy} onClick={() => void handleLogin()}>
          <Wallet aria-hidden="true" />
          {busy ? "等待钱包签名…" : "连接钱包并登录"}
        </button>
      ) : (
        <p>未发现浏览器钱包：请先安装钱包扩展（如 MetaMask）后刷新本页。</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
