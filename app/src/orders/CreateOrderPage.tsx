import {
  AlertCircle,
  CheckCircle2,
  Copy,
  FileCheck2,
  FilePlus2,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UsersRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ZhixuDetailDTO, ZhixuStageDTO } from "@uvp-eth/product-dto";
import type { DraftParticipantDTO, ProductApiClient } from "../api/productApi";
import {
  decorationSlotsForStage,
  decorationTheme,
  stageExecutorSelectionNote
} from "../decoration/decorationSupport";
import { useOrderAppDecorations } from "../decoration/useZhixuDecorations";
import {
  DRAFT_STATUS_LABELS,
  PARTICIPANT_STATUS_LABELS,
  type OrderActionState,
  type OrderInviteActionState
} from "./types";
import {
  useCreateOrderFlow,
  type CreateOrderCreatedResult
} from "./useCreateOrderFlow";
import "./orders.css";

/**
 * 参与者开单页：选已发布秩序 → 读装修/阶段 → 填触发内容 → 参与方确认 →
 * 本人确认并创建订单。
 *
 * 边界：
 * - 秩序目录只展示服务端判定为已发布的条目（planPublication.status），
 *   没有发布秩序时显示空态，不伪造目录。
 * - 装修取不到与"没有装修"分开呈现；阶段/角色/证据来自秩序详情。
 * - 参与方邀请由创建人签发，邀请链接交给对方确认；未确认时不发签名请求。
 * - 阶段执行者当前接口只支持订单内选定：本页显式说明不可在此预选，不伪造。
 * - 界面用产业语言，不展示哈希/区块/地址。
 */
export interface CreateOrderPageProps {
  readonly api: ProductApiClient;
  /** 当前会话锚定钱包（准备/提交的身份声明；真实身份由服务端会话决定）。 */
  readonly walletAddress?: string | undefined;
  readonly onBack: () => void;
  readonly onCreated?: ((result: CreateOrderCreatedResult) => void) | undefined;
  /** 写路径 401：宿主清会话切登录面；返回是否已接管。 */
  readonly onSessionExpired?: ((error: unknown) => boolean) | undefined;
}

export function CreateOrderPage({
  api,
  walletAddress,
  onBack,
  onCreated,
  onSessionExpired
}: CreateOrderPageProps) {
  const flow = useCreateOrderFlow({
    api,
    ...(walletAddress !== undefined ? { walletAddress } : {}),
    ...(onCreated ? { onCreated } : {}),
    ...(onSessionExpired ? { onSessionExpired } : {})
  });
  const [contacts, setContacts] = useState<Readonly<Record<string, string>>>({});
  const [copiedRoleSlotId, setCopiedRoleSlotId] = useState<string | undefined>(undefined);

  const selectedZhixuId = flow.selectedZhixuId;
  const decorationIds = useMemo(
    () => (selectedZhixuId ? [selectedZhixuId] : []),
    [selectedZhixuId]
  );
  const decorationState = useOrderAppDecorations(api, decorationIds, selectedZhixuId !== undefined);
  const snapshot = selectedZhixuId ? decorationState.byZhixuId[selectedZhixuId] : undefined;
  const zhixu = snapshot?.zhixu;
  const theme = decorationTheme(snapshot?.decoration);

  useEffect(() => {
    setContacts({});
    setCopiedRoleSlotId(undefined);
  }, [selectedZhixuId]);

  const orderedStages = useMemo(
    () => (zhixu ? [...zhixu.stages].sort((left, right) => left.index - right.index) : []),
    [zhixu]
  );
  const executorStages = useMemo(() => {
    if (!zhixu) {
      return [] as readonly { readonly stage: ZhixuStageDTO; readonly note: string }[];
    }
    return [...zhixu.stages]
      .sort((left, right) => left.index - right.index)
      .flatMap((stage) => {
        const note = stageExecutorSelectionNote(zhixu, stage);
        return note ? [{ stage, note }] : [];
      });
  }, [zhixu]);

  const draft = flow.draft;
  const participantList = flow.participants.status === "ready" ? flow.participants.participants : [];
  // 只统计必填角色的确认数：选填角色已确认不影响"能否创建"的判定。
  const acceptedRequiredCount = participantList.filter(
    (participant) => participant.required && participant.status === "accepted" && participant.walletAddress
  ).length;
  const requiredCount = participantList.filter((participant) => participant.required).length;
  const draftEditable = draft === undefined
    || (draft.status !== "triggering" && draft.status !== "triggered" && draft.status !== "cancelled");

  async function copyInviteLink(roleSlotId: string, link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedRoleSlotId(roleSlotId);
    } catch {
      // 剪贴板不可用时链接仍在只读输入框里，参与者可手动复制。
      setCopiedRoleSlotId(undefined);
    }
  }

  return (
    <section className="create-order-page workspace-block" data-testid="create-order-page">
      <div className="section-heading create-order-heading">
        <FilePlus2 aria-hidden="true" />
        <div>
          <span className="overline">参与者开单</span>
          <h2>创建订单</h2>
          <p>选一条已发布的秩序，填写触发内容，确认参与方后由你本人确认创建订单。</p>
        </div>
        <button className="quiet-button" type="button" onClick={onBack} data-testid="create-order-back">
          返回我的待办
        </button>
      </div>

      <CatalogBlock flow={flow} />

      {selectedZhixuId ? (
        <section className="create-order-block" aria-labelledby="create-order-service-title" data-testid="create-order-decoration">
          <h3 id="create-order-service-title">2. 服务内容与阶段</h3>
          {!snapshot && decorationState.status === "loading" ? (
            <p className="muted-copy" role="status">
              <RefreshCw className="spin" aria-hidden="true" /> 正在读取这条秩序的服务说明。
            </p>
          ) : null}
          {snapshot && !zhixu ? (
            <section className="system-banner system-banner-error" role="alert" data-testid="create-order-decoration-error">
              <strong>秩序详情加载失败</strong>
              <span>{snapshot.decorationError ?? "无法读取这条秩序的服务说明，请稍后重试。"}</span>
            </section>
          ) : null}
          {zhixu ? (
            <>
              {snapshot?.decorationError ? (
                <section className="system-banner system-banner-warn" role="alert" data-testid="create-order-decoration-warning">
                  <strong>装修内容暂时取不到</strong>
                  <span>阶段与角色按秩序定义显示；展示主题和材料明细可能不完整（{snapshot.decorationError}）。</span>
                </section>
              ) : null}
              {!snapshot?.decorationError && !theme ? (
                <p className="muted-copy" data-testid="create-order-decoration-missing">
                  这条秩序尚未提供展示装修；以下内容按秩序定义显示。
                </p>
              ) : null}
              <div className="create-order-theme">
                <div>
                  <h4>{theme?.displayName ?? zhixu.title}</h4>
                  <p>{theme?.description ?? zhixu.subtitle}</p>
                  {theme && theme.tags && theme.tags.length > 0 ? (
                    <div className="create-order-tags">
                      {theme.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  ) : null}
                </div>
                {theme && theme.highlights && theme.highlights.length > 0 ? (
                  <ul className="create-order-highlights">
                    {theme.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                  </ul>
                ) : null}
              </div>
              <div className="create-order-service-grid">
                <div className="create-order-service-card">
                  <h4>
                    <UsersRound aria-hidden="true" />
                    参与方角色
                  </h4>
                  {zhixu.roleSlots.length === 0 ? (
                    <p className="muted-copy">秩序没有声明参与方角色。</p>
                  ) : (
                    <ul className="create-order-role-list">
                      {zhixu.roleSlots.map((role) => (
                        <li key={role.slotId}>
                          <strong>{role.title}</strong>
                          <span>{role.label}{role.required ? " · 必填" : " · 选填"}</span>
                          <p>{role.duty}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="create-order-service-card">
                  <h4>
                    <FileCheck2 aria-hidden="true" />
                    阶段与材料
                  </h4>
                  <ol className="create-order-stage-list">
                    {orderedStages.map((stage) => (
                      <StageItem
                        key={stage.stageId}
                        decoration={snapshot?.decoration}
                        stage={stage}
                        zhixu={zhixu}
                      />
                    ))}
                  </ol>
                </div>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {selectedZhixuId ? (
        <section className="create-order-block" aria-labelledby="create-order-content-title" data-testid="create-order-form">
          <h3 id="create-order-content-title">3. 填写触发内容</h3>
          <p className="muted-copy">
            以下内容构成订单档案。生成订单内容后仍可修改，进入创建流程后不可再改。
          </p>
          <div className="create-order-form-grid">
            <label className="create-order-field" htmlFor="create-order-title">
              <span>订单名称</span>
              <input
                id="create-order-title"
                value={flow.values.title}
                disabled={!draftEditable}
                onChange={(event) => flow.updateValues({ title: event.target.value })}
                placeholder="例如：中国—中亚二手车出口订单"
              />
            </label>
            <label className="create-order-field" htmlFor="create-order-business-type">
              <span>业务类型</span>
              <input
                id="create-order-business-type"
                value={flow.values.businessType}
                disabled={!draftEditable}
                onChange={(event) => flow.updateValues({ businessType: event.target.value })}
                placeholder={flow.selectedZhixu?.applicableBusiness[0] ?? "按双方约定填写"}
              />
            </label>
            <label className="create-order-field create-order-field-wide" htmlFor="create-order-goods">
              <span>车辆与单证摘要</span>
              <textarea
                id="create-order-goods"
                rows={4}
                value={flow.values.goodsText}
                disabled={!draftEditable}
                onChange={(event) => flow.updateValues({ goodsText: event.target.value })}
                placeholder={"每行一条，例如：\n2021 款 SUV，行驶 4.2 万公里\n出口报关单与检测报告随车"}
              />
            </label>
            <label className="create-order-field" htmlFor="create-order-amount">
              <span>成交总额</span>
              <input
                id="create-order-amount"
                inputMode="decimal"
                value={flow.values.totalAmount}
                disabled={!draftEditable}
                onChange={(event) => flow.updateValues({ totalAmount: event.target.value })}
                placeholder="例如：128000"
              />
            </label>
            <label className="create-order-field" htmlFor="create-order-currency">
              <span>币种</span>
              <input
                id="create-order-currency"
                value={flow.values.currency}
                disabled={!draftEditable}
                onChange={(event) => flow.updateValues({ currency: event.target.value })}
                placeholder={flow.selectedZhixu?.supportedPaymentMethods[0] ?? "例如：USDC"}
              />
            </label>
            <label className="create-order-field create-order-field-wide" htmlFor="create-order-notes">
              <span>备注（选填）</span>
              <textarea
                id="create-order-notes"
                rows={2}
                value={flow.values.notes}
                disabled={!draftEditable}
                onChange={(event) => flow.updateValues({ notes: event.target.value })}
                placeholder="如有交付安排或特别说明，可在此填写"
              />
            </label>
          </div>
          <ActionNotice action={flow.draftAction} testId="create-order-draft-status" />
          <div className="create-order-actions">
            <button
              className="primary-button"
              type="button"
              data-testid="create-order-save-draft"
              disabled={flow.draftAction.phase === "pending" || !draftEditable}
              onClick={() => void flow.createOrSaveDraft()}
            >
              {flow.draftAction.phase === "pending" ? <Loader2 className="spin" aria-hidden="true" /> : null}
              {draft ? "保存内容修改" : "生成订单内容"}
            </button>
          </div>
        </section>
      ) : null}

      {draft ? (
        <section className="create-order-block" aria-labelledby="create-order-participants-title" data-testid="create-order-participants">
          <h3 id="create-order-participants-title">4. 参与方与确认</h3>
          <p className="muted-copy">
            参与方来自这条秩序的参与角色。生成邀请链接发给对方，对方完成确认后这里的状态才会更新。
          </p>
          {flow.participants.status === "loading" ? (
            <p className="muted-copy" role="status">
              <RefreshCw className="spin" aria-hidden="true" /> 正在读取参与方确认状态。
            </p>
          ) : null}
          {flow.participants.status === "error" ? (
            <section className="system-banner system-banner-error" role="alert" data-testid="create-order-participants-error">
              <strong>参与方状态加载失败</strong>
              <span>{flow.participants.message}</span>
            </section>
          ) : null}
          {flow.participants.status === "ready" ? (
            <ul className="create-order-participant-list">
              {flow.participants.participants.map((participant) => (
                <ParticipantItem
                  key={participant.participantId}
                  action={flow.inviteActions[participant.roleSlotId]}
                  contact={contacts[participant.roleSlotId] ?? participant.contact}
                  copied={copiedRoleSlotId === participant.roleSlotId}
                  onContactChange={(value) => setContacts((current) => ({
                    ...current,
                    [participant.roleSlotId]: value
                  }))}
                  onCopy={(link) => void copyInviteLink(participant.roleSlotId, link)}
                  onInvite={() => void flow.sendInvite(participant, contacts[participant.roleSlotId] ?? participant.contact)}
                  participant={participant}
                />
              ))}
            </ul>
          ) : null}
          <div className="create-order-actions">
            <button
              className="quiet-button"
              type="button"
              data-testid="create-order-refresh-participants"
              disabled={flow.participants.status === "loading"}
              onClick={() => void flow.reloadParticipants()}
            >
              <RefreshCw aria-hidden="true" />
              刷新参与方状态
            </button>
          </div>
        </section>
      ) : null}

      {selectedZhixuId ? (
        <>
          <section className="create-order-block" aria-labelledby="create-order-executors-title" data-testid="create-order-executors">
            <h3 id="create-order-executors-title">5. 执行者安排</h3>
            {executorStages.length === 0 ? (
              <p className="muted-copy">这条秩序没有声明需要在订单内选定的执行者。</p>
            ) : (
              <>
                <ul className="create-order-executor-list">
                  {executorStages.map(({ stage, note }) => (
                    <li key={stage.stageId}>
                      <strong>{stage.name}</strong>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
                <p className="create-order-notice" data-testid="create-order-executor-unavailable">
                  本版开单不为阶段预选执行者：执行者按约定在订单内选定，创建订单后由订单内的选择动作完成，这里不作预选。
                </p>
              </>
            )}
          </section>

          <section className="create-order-block" aria-labelledby="create-order-submit-title" data-testid="create-order-submit">
            <h3 id="create-order-submit-title">6. 确认并创建订单</h3>
            <dl className="create-order-summary">
              <div>
                <dt>使用秩序</dt>
                <dd>{flow.selectedZhixu?.title ?? "未选择"}</dd>
              </div>
              <div>
                <dt>订单名称</dt>
                <dd>{flow.values.title.trim() || "未填写"}</dd>
              </div>
              <div>
                <dt>参与方确认</dt>
                <dd>{draft ? `${acceptedRequiredCount} / ${requiredCount} 位必填参与方已确认` : "尚未生成订单内容"}</dd>
              </div>
              <div>
                <dt>当前状态</dt>
                <dd>{draft ? DRAFT_STATUS_LABELS[draft.status] : "尚未生成订单内容"}</dd>
              </div>
            </dl>
            <p className="create-order-notice">
              <ShieldCheck aria-hidden="true" />
              创建订单需要你本人确认；确认内容以本页订单档案为准。服务端不会代你确认。
            </p>
            <ActionNotice action={flow.registerAction} testId="create-order-register-status" />
            <div className="create-order-actions">
              <button
                className="primary-button"
                type="button"
                data-testid="create-order-register"
                disabled={flow.registerAction.phase === "pending"}
                onClick={() => void flow.registerOrder()}
              >
                {flow.registerAction.phase === "pending" ? <Loader2 className="spin" aria-hidden="true" /> : null}
                确认并创建订单
              </button>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}

function CatalogBlock({ flow }: { readonly flow: ReturnType<typeof useCreateOrderFlow> }) {
  return (
    <section className="create-order-block" aria-labelledby="create-order-catalog-title" data-testid="create-order-catalog">
      <h3 id="create-order-catalog-title">1. 选择秩序</h3>
      {flow.zhixus.status === "loading" ? (
        <p className="muted-copy" role="status">
          <RefreshCw className="spin" aria-hidden="true" /> 正在读取已发布秩序。
        </p>
      ) : null}
      {flow.zhixus.status === "error" ? (
        <section className="system-banner system-banner-error" role="alert" data-testid="create-order-catalog-error">
          <strong>秩序目录加载失败</strong>
          <span>{flow.zhixus.message}</span>
          <button className="quiet-button" type="button" onClick={() => void flow.refreshZhixus()}>
            <RefreshCw aria-hidden="true" />
            重新加载
          </button>
        </section>
      ) : null}
      {flow.zhixus.status === "ready" && flow.zhixus.items.length === 0 ? (
        <section className="empty-state create-order-empty" data-testid="create-order-empty-zhixus">
          <AlertCircle aria-hidden="true" />
          <h2>暂无可开单的秩序</h2>
          <p>当前没有已发布的秩序。发布方发布后，这里会出现可以开单的条目。</p>
          <button className="quiet-button" type="button" onClick={() => void flow.refreshZhixus()}>
            <RefreshCw aria-hidden="true" />
            重新加载
          </button>
        </section>
      ) : null}
      {flow.zhixus.status === "ready" && flow.zhixus.items.length > 0 ? (
        <div className="create-order-zhixu-list" role="list" aria-label="已发布秩序">
          {flow.zhixus.items.map((item) => {
            const selected = item.zhixuId === flow.selectedZhixuId;
            return (
              <div role="listitem" key={item.zhixuId}>
                <button
                  className={`create-order-zhixu-card ${selected ? "is-selected" : ""}`}
                  type="button"
                  aria-pressed={selected}
                  data-testid={`create-order-zhixu-${item.zhixuId}`}
                  onClick={() => flow.selectZhixu(item.zhixuId)}
                >
                  <span className="create-order-zhixu-title">
                    <strong>{item.title}</strong>
                    {selected ? <CheckCircle2 aria-hidden="true" /> : null}
                  </span>
                  <span className="create-order-zhixu-subtitle">{item.subtitle}</span>
                  <span className="create-order-zhixu-meta">
                    {item.publicationLabel} · {item.reviewLabel} · {item.stageCount} 个阶段 · {item.roleSlotCount} 个参与方角色
                  </span>
                  {item.applicableBusiness.length > 0 ? (
                    <span className="create-order-zhixu-meta">适用：{item.applicableBusiness.join("、")}</span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function StageItem({
  decoration,
  stage,
  zhixu
}: {
  readonly decoration: Parameters<typeof decorationSlotsForStage>[0];
  readonly stage: ZhixuStageDTO;
  readonly zhixu: ZhixuDetailDTO;
}) {
  const slots = decorationSlotsForStage(decoration, stage.stageId);
  const executorNote = stageExecutorSelectionNote(zhixu, stage);
  return (
    <li className="create-order-stage">
      <div className="create-order-stage-heading">
        <span>{stage.index + 1}</span>
        <strong>{stage.name}</strong>
        <small>负责：{stage.ownerRole}</small>
      </div>
      {executorNote ? <p className="muted-copy">{executorNote}</p> : null}
      {slots.length > 0 ? (
        <ul className="create-order-stage-evidence">
          {slots.map((slot) => (
            <li key={slot.key}>
              <span>{slot.label}</span>
              <small>{slot.required === false ? "选填" : "必填"}</small>
            </li>
          ))}
        </ul>
      ) : stage.evidence.length > 0 ? (
        <p className="muted-copy">材料：{stage.evidence.join("、")}（明细由发布方线下约定）</p>
      ) : (
        <p className="muted-copy">本阶段按双方约定提交阶段确认。</p>
      )}
    </li>
  );
}

function ParticipantItem({
  action,
  contact,
  copied,
  onContactChange,
  onCopy,
  onInvite,
  participant
}: {
  readonly action?: OrderInviteActionState | undefined;
  readonly contact: string;
  readonly copied: boolean;
  readonly onContactChange: (value: string) => void;
  readonly onCopy: (link: string) => void;
  readonly onInvite: () => void;
  readonly participant: DraftParticipantDTO;
}) {
  const accepted = participant.status === "accepted";
  const noteStatus = participant.status === "accepted" ? "ok"
    : participant.status === "rejected" ? "error"
      : participant.status === "invited" ? "info"
        : "muted";
  return (
    <li className="create-order-participant" data-testid={`create-order-participant-${participant.roleSlotId}`}>
      <div className="create-order-participant-heading">
        <div>
          <strong>{participant.displayName.trim() || participant.roleLabel}</strong>
          <span>{participant.roleLabel}{participant.required ? " · 必填" : " · 选填"}</span>
        </div>
        <span className={`create-order-status create-order-status-${noteStatus}`}>
          {PARTICIPANT_STATUS_LABELS[participant.status]}
        </span>
      </div>
      {accepted ? (
        <p className="muted-copy">该参与方已确认，可以参与本订单。</p>
      ) : (
        <>
          <div className="create-order-invite-row">
            <label className="create-order-field" htmlFor={`create-order-contact-${participant.roleSlotId}`}>
              <span>给「{participant.displayName.trim() || participant.roleLabel}」的联系方式</span>
              <input
                id={`create-order-contact-${participant.roleSlotId}`}
                value={contact}
                placeholder="手机号或邮箱"
                onChange={(event) => onContactChange(event.target.value)}
              />
            </label>
            <button
              className="quiet-button"
              type="button"
              data-testid={`create-order-invite-${participant.roleSlotId}`}
              disabled={action?.phase === "pending"}
              onClick={onInvite}
            >
              <Link2 aria-hidden="true" />
              {action?.phase === "pending" ? "正在生成" : "生成邀请"}
            </button>
          </div>
          {action?.phase === "success" && action.inviteLink ? (
            <div className="create-order-invite-link" data-testid={`create-order-invite-link-${participant.roleSlotId}`}>
              <label className="create-order-field" htmlFor={`create-order-invite-link-input-${participant.roleSlotId}`}>
                <span>邀请链接</span>
                <input
                  id={`create-order-invite-link-input-${participant.roleSlotId}`}
                  readOnly
                  value={action.inviteLink}
                  aria-label="邀请链接"
                />
              </label>
              <button className="quiet-button" type="button" onClick={() => onCopy(action.inviteLink ?? "")}>
                <Copy aria-hidden="true" />
                {copied ? "已复制" : "复制链接"}
              </button>
              <p className="muted-copy">{action.message}</p>
            </div>
          ) : null}
          {action?.phase === "error" ? (
            <p className="create-order-action create-order-action-error" role="alert">{action.message}</p>
          ) : null}
        </>
      )}
    </li>
  );
}

function ActionNotice({
  action,
  testId
}: {
  readonly action: OrderActionState;
  readonly testId?: string | undefined;
}) {
  if (action.phase === "idle" || !action.message) {
    return null;
  }
  const role = action.phase === "error" ? "alert" : "status";
  return (
    <p
      className={`create-order-action create-order-action-${action.phase}`}
      role={role}
      data-testid={testId}
    >
      {action.phase === "success" ? <CheckCircle2 aria-hidden="true" /> : null}
      {action.phase === "error" ? <AlertCircle aria-hidden="true" /> : null}
      {action.phase === "pending" ? <Loader2 className="spin" aria-hidden="true" /> : null}
      <span>{action.message}</span>
    </p>
  );
}

