/* 订单要求包读面：OrderRequirementsBundleDTO 的 requirements/句柄元数据与
 * 预设引用，按句柄展示解析/无权限/不可达/解密失败/摘要不符/类型不支持状态；
 * 相对方合意先核对服务端下发的合意消息再交钱包签名，确认信号选择在
 * AcceptancePanel 内完成。
 */
import { ArrowLeft, FileText, Fingerprint, ListChecks, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { orderRequirementsConsentMessage } from "@uvp-eth/product-dto";
import type {
  OrderRequirementDTO,
  OrderRequirementsConsentDTO
} from "@uvp-eth/product-dto";
import {
  ProductApiError,
  type DraftParticipantDTO,
  type OrderRequirementsReadResult,
  type ProductApiClient
} from "../api/productApi";
import { shortWallet } from "../auth/participant";
import type { OrderAppActions } from "../actions/orderAppActions";
import { sameAddress } from "../task-model";
import { personalSignWithInjectedWallet } from "../wallet/injectedWallet";
import { AcceptancePanel } from "./AcceptancePanel";
import { consentFailureCopy } from "./consent";
import {
  createRequirementsResolver,
  fileResourcePrincipal,
  handleFailureCopy,
  handleStatusLabel,
  resolveFileHandle,
  type HandleResolutionView
} from "./handles";
import "./requirements.css";

export interface RequirementsPageProps {
  readonly api: ProductApiClient;
  readonly actions: OrderAppActions;
  readonly draftId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly walletAddress?: string | undefined;
  readonly onBack: () => void;
  readonly onOpenDraft?: ((draftId: string) => void) | undefined;
  readonly onSessionExpired?: ((error: unknown) => boolean) | undefined;
  readonly onSubmitted?: (() => void) | undefined;
}

type BundleState =
  | { readonly status: "missing_draft" }
  | { readonly status: "loading" }
  | { readonly status: "empty"; readonly draftId: string }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly read: OrderRequirementsReadResult;
      readonly participants: readonly DraftParticipantDTO[];
      readonly participantsError: boolean;
    };

type ConsentState =
  | { readonly status: "idle" }
  | { readonly status: "signing" }
  | { readonly status: "error"; readonly message: string };

export function RequirementsPage({
  api,
  actions,
  draftId,
  taskId,
  walletAddress,
  onBack,
  onOpenDraft,
  onSessionExpired,
  onSubmitted
}: RequirementsPageProps) {
  const [bundleState, setBundleState] = useState<BundleState>({ status: "missing_draft" });
  const [reloadKey, setReloadKey] = useState(0);
  const [draftInput, setDraftInput] = useState("");
  const [handleViews, setHandleViews] = useState<Readonly<Record<string, HandleResolutionView>>>({});
  const [consents, setConsents] = useState<readonly OrderRequirementsConsentDTO[]>([]);
  const [consentState, setConsentState] = useState<ConsentState>({ status: "idle" });
  const wallet = walletAddress?.trim();

  useEffect(() => {
    if (!draftId) {
      setBundleState({ status: "missing_draft" });
      return undefined;
    }
    let active = true;
    setBundleState({ status: "loading" });
    setConsentState({ status: "idle" });
    void (async () => {
      try {
        const read = await api.getOrderRequirementsBundle(
          draftId,
          wallet ? { walletAddress: wallet } : {}
        );
        let participants: readonly DraftParticipantDTO[] = [];
        let participantsError = false;
        try {
          participants = (await api.getOrderDraft(draftId)).participants;
        } catch {
          participantsError = true;
        }
        if (active) {
          setBundleState({ status: "ready", read, participants, participantsError });
          setConsents(read.bundle.consents ?? []);
        }
      } catch (error) {
        if (!active) {
          return;
        }
        if (isRequirementsNotFound(error)) {
          setBundleState({ status: "empty", draftId });
          return;
        }
        if (onSessionExpired?.(error)) {
          return;
        }
        setBundleState({ status: "error", message: bundleFailureCopy(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, [api, draftId, wallet, reloadKey]);

  const bundle = bundleState.status === "ready" ? bundleState.read.bundle : undefined;
  const consentMessage = bundleState.status === "ready" ? bundleState.read.consentMessage : undefined;
  const acceptedWallets = useMemo(
    () =>
      bundleState.status === "ready"
        ? bundleState.participants
            .filter((participant) => participant.status === "accepted" && participant.walletAddress)
            .map((participant) => participant.walletAddress as string)
        : [],
    [bundleState]
  );
  const acceptedKey = acceptedWallets.join(",");
  const declarer = bundle?.declaredBy ?? "";
  const resolver = useMemo(
    () =>
      createRequirementsResolver({
        declarerWallet: declarer,
        acceptedWallets: acceptedKey.length > 0 ? acceptedKey.split(",") : []
      }),
    [acceptedKey, declarer]
  );

  useEffect(() => {
    if (!bundle) {
      setHandleViews({});
      return undefined;
    }
    let active = true;
    const handles = bundle.requirements.flatMap((requirement) => requirement.handles);
    const initial: Record<string, HandleResolutionView> = {};
    for (const handle of handles) {
      initial[handle.key] = { status: "pending" };
    }
    setHandleViews(initial);
    const principal = fileResourcePrincipal(wallet);
    for (const handle of handles) {
      void resolveFileHandle(handle, resolver, principal).then((view) => {
        if (active) {
          setHandleViews((current) => ({ ...current, [handle.key]: view }));
        }
      });
    }
    return () => {
      active = false;
    };
  }, [bundle, resolver, wallet]);

  async function handleConsent() {
    if (!bundle || !draftId || !wallet || !consentMessage || consentState.status === "signing") {
      return;
    }
    setConsentState({ status: "signing" });
    try {
      if (orderRequirementsConsentMessage(draftId, bundle.requirementsHash) !== consentMessage) {
        setConsentState({
          status: "error",
          message: "服务端下发的合意消息与要求包不一致，已拒绝签名。"
        });
        return;
      }
      const signature = await personalSignWithInjectedWallet({
        address: wallet,
        message: consentMessage
      });
      const result = await api.consentOrderRequirements(draftId, {
        requirementsHash: bundle.requirementsHash,
        signature,
        walletAddress: wallet
      });
      setConsents(result.consents.length > 0 ? result.consents : [result.consent]);
      setConsentState({ status: "idle" });
    } catch (error) {
      if (onSessionExpired?.(error)) {
        return;
      }
      setConsentState({ status: "error", message: consentFailureCopy(error) });
    }
  }

  const currentWalletConsent =
    wallet !== undefined
      ? consents.find((consent) => sameAddress(consent.walletAddress, wallet))
      : undefined;

  return (
    <div className="requirements-page" data-testid="requirements-page">
      <section className="workspace-block requirements-panel requirements-topbar">
        <div>
          <button className="quiet-button" type="button" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            返回待办
          </button>
          <div className="section-heading">
            <ListChecks aria-hidden="true" />
            <div>
              <h2>订单要求包</h2>
              <p>句柄元数据、解析状态与相对方合意；正文与密钥留在引擎外。</p>
            </div>
          </div>
        </div>
        <button
          className="quiet-button"
          type="button"
          onClick={() => setReloadKey((current) => current + 1)}
          disabled={!draftId}
        >
          <RefreshCw aria-hidden="true" />
          刷新
        </button>
      </section>

      {bundleState.status === "missing_draft" ? (
        <section className="workspace-block requirements-panel">
          <div className="section-heading">
            <FileText aria-hidden="true" />
            <div>
              <h2>打开要求包</h2>
              <p>入口形如 <code>#?section=requirements&amp;draftId=&lt;draftId&gt;</code>；也可以在这里填入草稿编号。</p>
            </div>
          </div>
          <form
            className="requirements-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              const next = draftInput.trim();
              if (next) {
                onOpenDraft?.(next);
              }
            }}
          >
            <label>
              草稿编号
              <input
                value={draftInput}
                onChange={(event) => setDraftInput(event.target.value)}
                placeholder="draft-..."
              />
            </label>
            <button
              className="primary-button"
              type="submit"
              disabled={draftInput.trim().length === 0 || !onOpenDraft}
            >
              打开
            </button>
          </form>
        </section>
      ) : bundleState.status === "loading" ? (
        <section className="workspace-block requirements-panel" role="status">
          <p className="requirements-note">
            <RefreshCw className="spin" aria-hidden="true" /> 正在读取要求包…
          </p>
        </section>
      ) : bundleState.status === "empty" ? (
        <section className="workspace-block requirements-panel">
          <div className="section-heading">
            <FileText aria-hidden="true" />
            <div>
              <h2>尚未声明要求包</h2>
              <p>该草稿还没有声明要求包（requirements_not_found）；这与读取失败不同。</p>
            </div>
          </div>
        </section>
      ) : bundleState.status === "error" ? (
        <section className="workspace-block requirements-panel">
          <p className="requirements-error" role="alert">
            {bundleState.message}
          </p>
        </section>
      ) : (
        <>
          <section className="workspace-block requirements-panel" aria-labelledby="requirements-bundle-title">
            <div className="section-heading">
              <FileText aria-hidden="true" />
              <div>
                <h2 id="requirements-bundle-title">要求包</h2>
                <p>
                  草稿 {bundleState.read.draft.draftId} · {bundleState.read.draft.title}
                </p>
              </div>
            </div>

            <div className="detail-grid">
              <div className="detail-item">
                <span>requirementsHash</span>
                <strong className="requirements-mono" data-testid="requirements-hash">
                  {bundleState.read.bundle.requirementsHash}
                </strong>
              </div>
              <div className="detail-item">
                <span>声明人</span>
                <strong>{shortWallet(bundleState.read.bundle.declaredBy)}</strong>
              </div>
              <div className="detail-item">
                <span>schema</span>
                <strong>{bundleState.read.bundle.schemaVersion}</strong>
              </div>
              <div className="detail-item">
                <span>可编辑</span>
                <strong>
                  {bundleState.read.editable ? "是（草稿仍可变，hash 会随内容变）" : "否（已随单冻结）"}
                </strong>
              </div>
            </div>

            {bundleState.participantsError ? (
              <p className="requirements-warn">
                参与方清单读取失败：受保护句柄按 fail-closed 显示为无权读取。
              </p>
            ) : null}

            <div className="requirement-list">
              {bundleState.read.bundle.requirements.length === 0 ? (
                <p className="requirements-note">要求包未声明任何要求（没有文件）。</p>
              ) : (
                bundleState.read.bundle.requirements.map((requirement) => (
                  <RequirementCard
                    key={requirement.key}
                    requirement={requirement}
                    views={handleViews}
                  />
                ))
              )}
            </div>
          </section>

          <section className="workspace-block requirements-panel" aria-labelledby="requirements-consent-title">
            <div className="section-heading">
              <Fingerprint aria-hidden="true" />
              <div>
                <h2 id="requirements-consent-title">相对方合意</h2>
                <p>签名覆盖草稿编号与当前 requirementsHash；由服务端按草稿参与者与签名裁决。</p>
              </div>
            </div>

            <div className="requirements-consent-target">
              <span>签名对象</span>
              <code className="requirements-mono">{bundleState.read.bundle.requirementsHash}</code>
            </div>

            {consents.length === 0 ? (
              <p className="requirements-note">还没有相对方记录合意。</p>
            ) : (
              <ul className="consent-list">
                {consents.map((consent) => (
                  <li key={`${consent.walletAddress}:${consent.signedAt}`}>
                    <ShieldCheck aria-hidden="true" />
                    <span>{shortWallet(consent.walletAddress)}</span>
                    <small>{consent.signedAt}</small>
                  </li>
                ))}
              </ul>
            )}

            {wallet === undefined ? (
              <p className="requirements-note">需要钱包登录后才能签名合意。</p>
            ) : null}
            {wallet !== undefined && sameAddress(wallet, bundleState.read.bundle.declaredBy) ? (
              <p className="requirements-note">当前钱包是开单人，服务端不接受对自己的要求包合意。</p>
            ) : null}

            <div className="requirements-actions">
              <button
                className="primary-button"
                type="button"
                data-testid="consent-button"
                disabled={
                  !wallet ||
                  consentState.status === "signing" ||
                  (wallet !== undefined && sameAddress(wallet, bundleState.read.bundle.declaredBy))
                }
                onClick={() => void handleConsent()}
              >
                <Fingerprint aria-hidden="true" />
                {consentState.status === "signing"
                  ? "等待钱包签名…"
                  : currentWalletConsent
                    ? "重新签名合意"
                    : "签名并合意"}
              </button>
            </div>

            {currentWalletConsent ? (
              <p className="requirements-success" data-testid="consent-status">
                已合意
              </p>
            ) : null}
            {consentState.status === "error" ? (
              <p className="requirements-error" role="alert" data-testid="consent-error">
                {consentState.message}
              </p>
            ) : null}

            <details className="requirements-consent-message">
              <summary>查看将签名的消息</summary>
              <pre>{bundleState.read.consentMessage}</pre>
            </details>
          </section>
        </>
      )}

      <AcceptancePanel
        api={api}
        actions={actions}
        taskId={taskId}
        walletAddress={wallet}
        onSessionExpired={onSessionExpired}
        onSubmitted={onSubmitted}
      />
    </div>
  );
}

function RequirementCard({
  requirement,
  views
}: {
  readonly requirement: OrderRequirementDTO;
  readonly views: Readonly<Record<string, HandleResolutionView>>;
}) {
  return (
    <article className="requirement-card">
      <header>
        <div>
          <h3>{requirement.label ?? requirement.key}</h3>
          <code>{requirement.key}</code>
        </div>
        {requirement.stageId ? <span className="requirements-chip">环节 {requirement.stageId}</span> : null}
      </header>

      <div className="requirement-meta">
        {requirement.dueAt ? <span>时限：{requirement.dueAt}</span> : <span>时限：未声明</span>}
        {requirement.presetRef ? (
          <span className="requirement-preset">
            预设：{requirement.presetRef.name}@{requirement.presetRef.version}
            <code className="requirements-mono">{requirement.presetRef.hash}</code>
          </span>
        ) : (
          <span>预设：未引用</span>
        )}
      </div>

      {requirement.handles.length === 0 ? (
        <p className="requirements-note">该要求未声明句柄（没有文件）。</p>
      ) : (
        <ul className="handle-list">
          {requirement.handles.map((handle) => {
            const view: HandleResolutionView = views[handle.key] ?? { status: "pending" };
            const failure = handleFailureCopy(view.status);
            return (
              <li
                className={`handle-row handle-status-${view.status}`}
                data-testid={`handle-row-${handle.key}`}
                key={handle.key}
              >
                <div className="handle-head">
                  <strong>{handle.key}</strong>
                  <span
                    className={`handle-status handle-status-${view.status}`}
                    data-testid={`handle-status-${handle.key}`}
                  >
                    {handleStatusLabel(view.status)}
                  </span>
                </div>

                <dl className="handle-meta">
                  <div>
                    <dt>文件类型</dt>
                    <dd>{handle.fileType}</dd>
                  </div>
                  <div>
                    <dt>可见性</dt>
                    <dd>{visibilityLabel(handle.visibility)}</dd>
                  </div>
                  {handle.contentHash ? (
                    <div>
                      <dt>内容 hash</dt>
                      <dd className="requirements-mono">{handle.contentHash}</dd>
                    </div>
                  ) : null}
                  {handle.cipherHash ? (
                    <div>
                      <dt>密文 hash</dt>
                      <dd className="requirements-mono">{handle.cipherHash}</dd>
                    </div>
                  ) : null}
                  {handle.cipher ? (
                    <div>
                      <dt>加密</dt>
                      <dd>{handle.cipher.alg}（密钥引用不展示）</dd>
                    </div>
                  ) : null}
                  {handle.policyRef ? (
                    <div>
                      <dt>策略引用</dt>
                      <dd>{handle.policyRef}</dd>
                    </div>
                  ) : null}
                </dl>

                {view.status === "resolved" && view.resolved ? (
                  <div className="handle-resolved">
                    <p>
                      解析后摘要 <code className="requirements-mono">{view.resolved.hash}</code>
                    </p>
                    {view.resolved.kind === "text" ? (
                      <details>
                        <summary>查看已解析内容</summary>
                        <pre>{previewText(view.resolved.content)}</pre>
                      </details>
                    ) : (
                      <p>二进制文件：{view.resolved.content.byteLength} 字节（正文不在此展示）。</p>
                    )}
                  </div>
                ) : null}

                {failure ? <p className="handle-failure">{failure}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function visibilityLabel(visibility: string | undefined): string {
  switch (visibility) {
    case "public":
      return "public";
    case "protected":
      return "protected";
    case "private":
      return "private";
    default:
      return "未声明（resolver 按 private）";
  }
}

function previewText(content: string): string {
  const limit = 4_000;
  return content.length > limit ? `${content.slice(0, limit)}\n…（已截断展示）` : content;
}

function isRequirementsNotFound(error: unknown): boolean {
  return error instanceof ProductApiError
    && error.errorCode === "requirements_not_found";
}

function bundleFailureCopy(error: unknown): string {
  if (!(error instanceof ProductApiError)) {
    return error instanceof Error ? error.message : "要求包读取失败。";
  }
  switch (error.errorCode) {
    case "draft_not_found":
      return "草稿不存在（draft_not_found）。";
    case "draft_access_denied":
      return "当前钱包无权读取该草稿的要求包（draft_access_denied）。";
    case "wallet_identity_required":
      return "需要钱包登录后才能读取要求包。";
    case "wrong_wallet":
      return "钱包会话地址与当前钱包不一致，请重新登录。";
    case "invalid_wallet":
      return "钱包地址不合法（invalid_wallet）。";
    default:
      return error.errorCode ? `${error.message}（${error.errorCode}）` : error.message;
  }
}
