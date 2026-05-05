import { AlertCircle, CheckCircle2, ShieldCheck, Wallet, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProductInvitePreviewDTO } from "../api/productApi";
import type { OrderAppActions } from "../actions/orderAppActions";
import type { ParticipantSession } from "../auth/participant";
import { shortWallet } from "../auth/participant";

type InviteLoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly invite: ProductInvitePreviewDTO }
  | { readonly status: "accepted"; readonly invite: ProductInvitePreviewDTO }
  | { readonly status: "rejected" }
  | { readonly status: "error"; readonly message: string };

interface InviteOnboardingProps {
  readonly inviteId: string;
  readonly actions: OrderAppActions;
  readonly session: ParticipantSession;
  readonly onAccepted: () => void;
  readonly onDismiss: () => void;
}

export function InviteOnboarding({ inviteId, actions, session, onAccepted, onDismiss }: InviteOnboardingProps) {
  const [walletAddress, setWalletAddress] = useState(session.walletAddress ?? "");
  const [displayName, setDisplayName] = useState("");
  const [contact, setContact] = useState("");
  const [loadState, setLoadState] = useState<InviteLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void actions.previewInvite(inviteId, walletAddress ? { walletAddress } : {})
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
            message: error instanceof Error ? error.message : "邀请加载失败"
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [actions, inviteId, walletAddress]);

  const invite = loadState.status === "ready" || loadState.status === "accepted" ? loadState.invite : undefined;
  const canAccept = Boolean(invite?.acceptance?.canAccept && walletAddress.trim() && displayName.trim() && contact.trim());

  function handleAccept() {
    if (!invite || !canAccept) {
      return;
    }
    setLoadState({ status: "loading" });
    void actions.acceptInvite(inviteId, {
      displayName: displayName.trim(),
      walletAddress: walletAddress.trim(),
      contact: contact.trim()
    })
      .then(() => {
        setLoadState({ status: "accepted", invite });
        onAccepted();
      })
      .catch((error) => {
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "接受邀请失败"
        });
      });
  }

  function handleReject() {
    setLoadState({ status: "loading" });
    void actions.rejectInvite(inviteId, {
      displayName: displayName.trim() || undefined,
      contact: contact.trim() || undefined
    })
      .then(() => setLoadState({ status: "rejected" }))
      .catch((error) => {
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "拒绝邀请失败"
        });
      });
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
        <h2>邀请不可用</h2>
        <p>{loadState.message}</p>
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
          <Fact label="凭证" value={(invite?.role?.requiredEvidence ?? []).join(" / ") || "按待办要求提交"} />
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
          <span>签名钱包</span>
          <input value={walletAddress} onChange={(event) => setWalletAddress(event.target.value)} />
        </label>
        <div className="invite-actions">
          <button className="quiet-button" type="button" onClick={handleReject}>拒绝</button>
          <button className="primary-button" type="button" disabled={!canAccept} onClick={handleAccept}>接受角色</button>
        </div>
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
