import { AlertCircle, CheckCircle2, ShieldCheck, Wallet, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isWalletIdentityRequired, ProductApiError, type ProductInvitePreviewDTO } from "../api/productApi";
import type { OrderAppActions } from "../actions/orderAppActions";
import type { ParticipantSession } from "../auth/participant";
import { shortWallet } from "../auth/participant";
import { InjectedWalletError } from "../wallet/injectedWallet";

type InviteLoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly invite: ProductInvitePreviewDTO }
  | { readonly status: "accepted"; readonly invite: ProductInvitePreviewDTO }
  | { readonly status: "rejected" }
  | {
      readonly status: "error";
      readonly message: string;
      readonly retryable: boolean;
      /** 非"邀请不可用"类终态（如钱包身份缺失）的定制标题。 */
      readonly errorTitle?: string | undefined;
      /** 服务端错误体原文（message 已提取时保留），供展开核对。 */
      readonly bodyText?: string | undefined;
    };

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
 * 终态失败判定：令牌比对失败 / 邀请不存在、已过期或已被消费（403/404/
 * 409/410）时同一链接重试不可能成功；其余失败（拒签、网络闪断、会话未
 * 建立）都允许在当前步骤重试——一次性令牌只在服务端 accept/reject 成功
 * 时消费。409 中的 wallet_already_bound 是例外（占用的是钱包不是邀请），
 * 由 reportInviteActionFailure 先行分流为可重试。
 */
function isTerminalInviteFailure(error: unknown): boolean {
  return error instanceof ProductApiError
    && (error.status === 403 || error.status === 404 || error.status === 409 || error.status === 410);
}

/**
 * 409 终态冲突（并发双 accept 的败者、已接受/已拒绝后的重复操作、角色
 * 已被占用）：按服务端错误码给本地化文案，英文 message 不直出。
 * wallet_already_bound 不在此列——该 409 下邀请仍 active，按可换钱包
 * 重试的表单内提示处理（见 isWalletAlreadyBoundConflict）。
 */
function conflictInviteFailureCopy(error: unknown): string {
  const errorCode = error instanceof ProductApiError ? error.errorCode : undefined;
  if (errorCode === "invite_already_accepted") {
    return "该邀请已被接受，不能再重复操作；请使用已绑定的钱包进入待办查看角色。";
  }
  if (errorCode === "invite_rejected") {
    return "该邀请已被拒绝，不能再接受；如需参与请联系邀请方重新发送邀请。";
  }
  if (errorCode === "role_already_filled") {
    return "该邀请对应的角色已被其他参与者绑定，换钱包也不能接受；如需参与请联系邀请方。";
  }
  return `${inviteFailureMessage(error, "邀请状态已变更。")}该邀请不可重试，请联系邀请方重新发送邀请链接。`;
}

/**
 * 409 wallet_already_bound：占用的是钱包不是邀请——服务端校验失败不消费
 * 一次性令牌，邀请仍 active，换一个未绑定本订单的钱包重试同一链接即可
 * 完成接受。按可重试处理（表单保持挂载），不按终态卸载。
 */
function isWalletAlreadyBoundConflict(error: unknown): boolean {
  return error instanceof ProductApiError
    && error.status === 409
    && error.errorCode === "wallet_already_bound";
}

function walletAlreadyBoundFailureCopy(): string {
  return "该钱包已绑定本订单的另一角色，不能同时担任两个角色；邀请仍然有效，请更换绑定钱包后重试。";
}

/**
 * 请求超时（status 0，客户端未收到服务端响应）：服务端可能已处理——
 * 超时不等于未提交，不得引导重签；如实按"结果未知"呈现并引导查询。
 */
function isTimeoutInviteFailure(error: unknown): boolean {
  return error instanceof ProductApiError && error.status === 0;
}

function timeoutInviteFailureCopy(error: unknown): string {
  return `${inviteFailureMessage(error, "请求超时。")}本次操作结果未知：邀请可能已经生效，请刷新页面或重新打开邀请链接查看当前状态；确认结果前请勿重复发起。`;
}

/**
 * 401 wallet_identity_required：参与者面（含邀请预览/接受/拒绝）要求钱包
 * 会话身份，非 local 部署不接受自报钱包——无钱包会话的受邀者重发同一
 * 请求永远得到同一 401。按终态处理并引导安装/连接钱包，不给"可直接
 * 重试"的假出口。
 */
function isWalletIdentityInviteFailure(error: unknown): boolean {
  return isWalletIdentityRequired(error);
}

function walletIdentityInviteFailureCopy(error: unknown): string {
  return `${inviteFailureMessage(error, "参与者服务要求钱包身份。")}请先安装并连接浏览器钱包、完成钱包登录后重新打开邀请链接；未建立钱包身份前重试同一请求不会成功。`;
}

function inviteErrorBodyText(error: unknown): string | undefined {
  return error instanceof ProductApiError ? error.bodyText : undefined;
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

  // 终态闩（accepted/rejected/不可重试 error，单向置位）：置位后钱包输入
  // 防抖与预览刷新都不再重跑——迟到的 400ms 探测会把刚落档的终态出口
  // 无差别冲回 loading→ready 表单，accept/reject 的失败结论闪现即被替换。
  // 用 ref 而不是把 loadState 加进预览 effect 依赖：ready 本身也会触发
  // 预览重发，形成循环。action 调用点在 setLoadState 的同一提交内同步置
  // 位（effect 要等提交后才跑，期间在途预览的 .then 仍会读到 false）；
  // 本 effect 兜底预览链路自己落的不可重试终态。
  const inviteSettledRef = useRef(false);
  useEffect(() => {
    if (loadState.status === "accepted" || loadState.status === "rejected"
      || (loadState.status === "error" && !loadState.retryable)) {
      inviteSettledRef.current = true;
    }
  }, [loadState]);

  useEffect(() => {
    if (inviteSettledRef.current) {
      return undefined;
    }
    const trimmed = walletAddress.trim();
    if (trimmed && !isEvmWalletAddress(trimmed)) {
      return undefined;
    }
    const timer = window.setTimeout(() => setProbedWalletAddress(trimmed), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [walletAddress]);

  useEffect(() => {
    // 终态后失效：不闪 loading、不发预览 POST（见 inviteSettledRef 注释）。
    if (inviteSettledRef.current) {
      return undefined;
    }
    let cancelled = false;
    setLoadState({ status: "loading" });
    // 预览与 accept/reject 同一凭据口径：服务端按 token 哈希比对（缺失 403），
    // 预览请求必须携带邀请链接里的一次性令牌。
    void actions.previewInvite(inviteId, {
      ...(probedWalletAddress ? { walletAddress: probedWalletAddress } : {}),
      ...(inviteToken ? { token: inviteToken } : {})
    })
      .then((invite) => {
        if (cancelled || inviteSettledRef.current) {
          return;
        }
        setDisplayName((current) => current || invite.participant.displayName);
        setContact((current) => current || invite.participant.contact);
        setLoadState({ status: "ready", invite });
      })
      .catch((error) => {
        // 在途预览不得覆盖终态：请求发出后 accept/reject 可能已落档结论。
        if (!cancelled && !inviteSettledRef.current) {
          const walletIdentityFailure = isWalletIdentityInviteFailure(error);
          setLoadState({
            status: "error",
            message: walletIdentityFailure
              ? walletIdentityInviteFailureCopy(error)
              : inviteFailureMessage(error, "邀请加载失败"),
            retryable: !isTerminalInviteFailure(error) && !walletIdentityFailure,
            ...(walletIdentityFailure ? { errorTitle: "需要钱包身份" } : {}),
            ...(inviteErrorBodyText(error) ? { bodyText: inviteErrorBodyText(error) } : {})
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

  /**
   * accept/reject 请求本身的失败分类（会话建立阶段除外——那里请求尚未
   * 发出，失败恒为"未提交可重试"）：
   * - 409 wallet_already_bound：邀请仍 active，表单保持挂载，引导换钱包；
   * - 403/404/410/409 其余终态：409 用本地化冲突文案，英文 message 不直出；
   * - 超时（status 0）：结果未知，引导查询而不是重签；
   * - 钱包身份缺失：终态引导连接钱包；
   * - 其余（拒签/网络闪断）：未提交，可重试。
   */
  function reportInviteActionFailure(error: unknown, fallback: string): void {
    if (isWalletAlreadyBoundConflict(error)) {
      setActionError(walletAlreadyBoundFailureCopy());
      return;
    }
    if (isTerminalInviteFailure(error)) {
      // 终态同步置闩：不等 effect——同一事件循环内在途预览的 .then 仍可能
      // 把 error 出口覆盖回 ready 表单。
      inviteSettledRef.current = true;
      setLoadState({
        status: "error",
        message: error instanceof ProductApiError && error.status === 409
          ? conflictInviteFailureCopy(error)
          : terminalInviteFailureCopy(error),
        retryable: false
      });
      return;
    }
    if (isWalletIdentityInviteFailure(error)) {
      inviteSettledRef.current = true;
      setLoadState({
        status: "error",
        message: walletIdentityInviteFailureCopy(error),
        retryable: false,
        errorTitle: "需要钱包身份",
        ...(inviteErrorBodyText(error) ? { bodyText: inviteErrorBodyText(error) } : {})
      });
      return;
    }
    if (isTimeoutInviteFailure(error)) {
      setActionError(timeoutInviteFailureCopy(error));
      return;
    }
    setActionError(retryableInviteFailureCopy(error, fallback));
  }

  async function handleAccept() {
    if (!invite || !canAccept || busy) {
      return;
    }
    setBusy(true);
    setActionError(undefined);
    try {
      let options: { readonly sessionToken?: string | undefined } = {};
      try {
        options = await ensureWalletSessionProof(walletAddress.trim());
      } catch (error) {
        // 会话链路失败时 accept 请求尚未发出：按未提交可重试如实呈现。
        setActionError(retryableInviteFailureCopy(error, "建立钱包会话失败"));
        return;
      }
      try {
        await actions.acceptInvite(inviteId, {
          displayName: displayName.trim(),
          walletAddress: walletAddress.trim(),
          contact: contact.trim(),
          token: inviteToken ?? ""
        }, options);
      } catch (error) {
        reportInviteActionFailure(error, "接受邀请失败");
        return;
      }
      inviteSettledRef.current = true;
      setLoadState({ status: "accepted", invite });
      onAccepted();
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
      try {
        await actions.rejectInvite(inviteId, {
          token: inviteToken ?? "",
          displayName: displayName.trim() || undefined,
          contact: contact.trim() || undefined
        });
      } catch (error) {
        reportInviteActionFailure(error, "拒绝邀请失败");
        return;
      }
      inviteSettledRef.current = true;
      setLoadState({ status: "rejected" });
      onRejected?.();
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
        <h2>{loadState.errorTitle ?? (loadState.retryable ? "邀请加载失败" : "邀请不可用")}</h2>
        <p>{loadState.message}</p>
        {loadState.bodyText ? (
          <details className="invite-error-body">
            <summary>服务端原始响应</summary>
            <pre>{loadState.bodyText}</pre>
          </details>
        ) : null}
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
