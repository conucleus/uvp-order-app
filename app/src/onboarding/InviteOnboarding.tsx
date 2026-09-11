import { AlertCircle, CheckCircle2, ShieldCheck, Wallet, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { ProductApiError, type ProductInvitePreviewDTO } from "../api/productApi";
import type { OrderAppActions } from "../actions/orderAppActions";
import type { ParticipantSession } from "../auth/participant";
import { shortWallet } from "../auth/participant";
import { InjectedWalletError } from "../wallet/injectedWallet";

type InviteLoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly invite: ProductInvitePreviewDTO }
  | { readonly status: "accepted"; readonly invite: ProductInvitePreviewDTO }
  | { readonly status: "rejected" }
  | { readonly status: "error"; readonly message: string; readonly retryable: boolean };

interface InviteOnboardingProps {
  readonly inviteId: string;
  /** 一次性邀请令牌（创建邀请时下发、随邀请链接送达）；accept/reject 必须回呈。 */
  readonly inviteToken?: string | undefined;
  readonly actions: OrderAppActions;
  readonly session: ParticipantSession;
  readonly onAccepted: () => void;
  readonly onRejected?: (() => void) | undefined;
  readonly onDismiss: () => void;
}

const PREVIEW_DEBOUNCE_MS = 400;

function isEvmWalletAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/u.test(value);
}

/**
 * 终态失败判定：令牌比对失败 / 邀请不存在或已过期（403/404/410）时同一
 * 链接重试不可能成功；其余失败（拒签、网络闪断、超时、会话未建立）都
 * 允许在当前步骤重试——一次性令牌只在服务端 accept/reject 成功时消费。
 */
function isTerminalInviteFailure(error: unknown): boolean {
  return error instanceof ProductApiError
    && (error.status === 403 || error.status === 404 || error.status === 410);
}

function inviteFailureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

/** 可重试失败如实展示：拒签提示可重签，网络/服务端闪断提示可重试。 */
function retryableInviteFailureCopy(error: unknown, fallback: string): string {
  const message = inviteFailureMessage(error, fallback);
  if (error instanceof InjectedWalletError && error.code === "wallet_rejected") {
    return `${message}本次操作未提交，可重新点击再次发起钱包签名。`;
  }
  return `${message}本次操作未提交，可直接重试。`;
}

function terminalInviteFailureCopy(error: unknown): string {
  return `${inviteFailureMessage(error, "邀请令牌无效。")}该邀请已不可重试，请联系邀请方重新发送邀请链接。`;
}

export function InviteOnboarding({ inviteId, inviteToken, actions, session, onAccepted, onRejected, onDismiss }: InviteOnboardingProps) {
  const [walletAddress, setWalletAddress] = useState(session.walletAddress ?? "");
  const [displayName, setDisplayName] = useState("");
  const [contact, setContact] = useState("");
  const [loadState, setLoadState] = useState<InviteLoadState>({ status: "loading" });
  // accept/reject 长链路（challenge→签名→verify→提交）在途时保持表单挂载，
  // 失败后用户输入原样保留，直接重试当前动作。
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  // 预览加载失败后的手动重试计数：递增即重跑加载 effect。
  const [previewAttempt, setPreviewAttempt] = useState(0);
  // 受控输入只进防抖值；只有 0x 格式合法的地址才触发服务端 alreadyBound 探测。
  const [probedWalletAddress, setProbedWalletAddress] = useState(() => {
    const initial = (session.walletAddress ?? "").trim();
    return initial && isEvmWalletAddress(initial) ? initial : "";
  });

  useEffect(() => {
    const trimmed = walletAddress.trim();
    if (trimmed && !isEvmWalletAddress(trimmed)) {
      return undefined;
    }
    const timer = window.setTimeout(() => setProbedWalletAddress(trimmed), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [walletAddress]);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    // 预览与 accept/reject 同一凭据口径：服务端按 token 哈希比对（缺失 403），
    // 预览请求必须携带邀请链接里的一次性令牌。
    void actions.previewInvite(inviteId, {
      ...(probedWalletAddress ? { walletAddress: probedWalletAddress } : {}),
      ...(inviteToken ? { token: inviteToken } : {})
    })
      .then((invite) => {
        if (cancelled) {
          return;
        }
        setDisplayName((current) => current || invite.participant.displayName);
        setContact((current) => current || invite.participant.contact);
        setLoadState({ status: "ready", invite });
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadState({
            status: "error",
            message: inviteFailureMessage(error, "邀请加载失败"),
            retryable: !isTerminalInviteFailure(error)
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [actions, inviteId, inviteToken, probedWalletAddress, previewAttempt]);

  const invite = loadState.status === "ready" || loadState.status === "accepted" ? loadState.invite : undefined;
  const walletFormatOk = isEvmWalletAddress(walletAddress.trim());
  const tokenMissing = !inviteToken;
  const canAccept = Boolean(
    invite?.acceptance?.canAccept && walletFormatOk && displayName.trim() && contact.trim() && !tokenMissing
  );

  /**
   * 服务端 accept 契约要求"已证明钱包控制的会话"。有浏览器钱包时走
   * 服务端会话（challenge → personal_sign → verify）；没有钱包时退化为
   * query 自报（服务端仅 local 运行时接受，其余环境会返回 401 并如实展示）。
   */
  async function ensureWalletSessionProof(wallet: string): Promise<{ readonly sessionToken?: string | undefined }> {
    if (!actions.hasInjectedWallet()) {
      return {};
    }
    const connected = await actions.requestWalletAddress();
    if (connected.toLowerCase() !== wallet.toLowerCase()) {
      throw new Error("浏览器钱包当前连接的地址与绑定钱包不一致；请先在钱包中切换到该地址。");
    }
    const proof = await actions.proveWalletControl({ address: wallet });
    return { sessionToken: proof.sessionToken };
  }

  async function handleAccept() {
    if (!invite || !canAccept || busy) {
      return;
    }
    setBusy(true);
    setActionError(undefined);
    try {
      const options = await ensureWalletSessionProof(walletAddress.trim());
      await actions.acceptInvite(inviteId, {
        displayName: displayName.trim(),
        walletAddress: walletAddress.trim(),
        contact: contact.trim(),
        token: inviteToken ?? ""
      }, options);
      setLoadState({ status: "accepted", invite });
      onAccepted();
    } catch (error) {
      if (isTerminalInviteFailure(error)) {
        setLoadState({ status: "error", message: terminalInviteFailureCopy(error), retryable: false });
        return;
      }
      setActionError(retryableInviteFailureCopy(error, "接受邀请失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (busy || tokenMissing) {
      return;
    }
    setBusy(true);
    setActionError(undefined);
    try {
      await actions.rejectInvite(inviteId, {
        token: inviteToken ?? "",
        displayName: displayName.trim() || undefined,
        contact: contact.trim() || undefined
      });
      setLoadState({ status: "rejected" });
      onRejected?.();
    } catch (error) {
      if (isTerminalInviteFailure(error)) {
        setLoadState({ status: "error", message: terminalInviteFailureCopy(error), retryable: false });
        return;
      }
      setActionError(retryableInviteFailureCopy(error, "拒绝邀请失败"));
    } finally {
      setBusy(false);
    }
  }

  if (loadState.status === "loading") {
    return (
      <section className="invite-panel" aria-busy="true">
        <Wallet aria-hidden="true" />
        <h2>正在读取邀请</h2>
      </section>
    );
  }

  if (loadState.status === "error") {
    return (
      <section className="invite-panel invite-panel-error" role="alert">
        <AlertCircle aria-hidden="true" />
        <h2>{loadState.retryable ? "邀请加载失败" : "邀请不可用"}</h2>
        <p>{loadState.message}</p>
        {loadState.retryable ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
          >
            重试加载
          </button>
        ) : null}
        <button className="quiet-button" type="button" onClick={onDismiss}>返回待办</button>
      </section>
    );
  }

  if (loadState.status === "rejected") {
    return (
      <section className="invite-panel">
        <XCircle aria-hidden="true" />
        <h2>已拒绝邀请</h2>
        <button className="quiet-button" type="button" onClick={onDismiss}>返回待办</button>
      </section>
    );
  }

  if (loadState.status === "accepted") {
    return (
      <section className="invite-panel invite-panel-success">
        <CheckCircle2 aria-hidden="true" />
        <h2>角色已绑定</h2>
        <p>{shortWallet(walletAddress)} 已绑定到 {invite?.role?.label ?? invite?.participant.roleLabel}。</p>
        <button className="quiet-button" type="button" onClick={onDismiss}>查看我的待办</button>
      </section>
    );
  }

  return (
    <section className="invite-workspace" aria-labelledby="invite-title">
      <div className="invite-summary">
        <div className="section-heading">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h2 id="invite-title">{invite?.draft.title}</h2>
            <p>{invite?.role?.label ?? invite?.participant.roleLabel}</p>
          </div>
        </div>
        <dl className="invite-facts">
          <Fact label="职责" value={invite?.role?.duty ?? "待确认"} />
          <Fact label="凭证" value={(invite?.role?.evidenceSpec ?? []).map((slot) => slot.label).join(" / ") || "按待办要求提交"} />
          <Fact label="到期" value={invite ? new Date(invite.invite.expiresAt).toLocaleString() : "待确认"} />
          <Fact label="钱包" value={shortWallet(walletAddress)} />
        </dl>
        {invite?.walletBinding?.alreadyBound ? (
          <p className="blocked-copy">该钱包已绑定到本订单的 {invite.walletBinding.boundRoleLabel ?? "其他角色"}。</p>
        ) : null}
        {invite?.acceptance && !invite.acceptance.canAccept ? (
          <p className="blocked-copy">{acceptanceCopy(invite.acceptance.status)}</p>
        ) : null}
      </div>

      <div className="invite-binding">
        <label>
          <span>显示名称</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          <span>联系方式</span>
          <input value={contact} onChange={(event) => setContact(event.target.value)} />
        </label>
        <label>
          <span>绑定钱包</span>
          <input
            aria-label="绑定钱包"
            value={walletAddress}
            onChange={(event) => setWalletAddress(event.target.value)}
          />
          {walletAddress.trim() && !walletFormatOk ? (
            <small className="blocked-copy">请填写 0x 开头的 42 位钱包地址；格式合法后才会校验绑定状态。</small>
          ) : (
            <small>
              该地址将绑定到角色并接收待办；检测到浏览器钱包时，接受前需用该钱包完成一次会话签名以证明控制权。
            </small>
          )}
        </label>
        {tokenMissing ? (
          <p className="blocked-copy" role="alert">
            邀请链接缺少一次性令牌（inviteToken）：请使用邀请方提供的完整链接打开本页，否则无法接受或拒绝邀请。
          </p>
        ) : null}
        <div className="invite-actions">
          {/* reject 同样强制回呈 token（服务端哈希比对）：缺令牌时禁用，
              不发出注定 403 的请求；提示已在上方 tokenMissing 文案给出。 */}
          <button className="quiet-button" type="button" disabled={tokenMissing || busy} onClick={() => void handleReject()}>
            {busy ? "正在提交…" : "拒绝"}
          </button>
          <button className="primary-button" type="button" disabled={!canAccept || busy} onClick={() => void handleAccept()}>
            {busy ? "正在提交…" : "接受角色"}
          </button>
        </div>
        {actionError ? <p className="blocked-copy" role="alert">{actionError}</p> : null}
      </div>
    </section>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function acceptanceCopy(status: string): string {
  if (status === "expired") {
    return "邀请已过期，请联系订单创建方重新邀请。";
  }
  if (status === "already_accepted") {
    return "邀请已被接受，请使用已绑定钱包进入待办。";
  }
  if (status === "wallet_already_bound") {
    return "当前钱包已绑定本订单的其他角色。";
  }
  if (status === "role_already_filled") {
    return "该角色已经完成绑定。";
  }
  if (status === "rejected" || status === "revoked") {
    return "邀请已不可用。";
  }
  return "当前邀请暂不可接受。";
}
