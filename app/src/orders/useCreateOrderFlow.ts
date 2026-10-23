import { useEffect, useRef, useState } from "react";
import type {
  DraftParticipantDTO,
  ProductApiClient,
  ProductOrderDraftDTO
} from "../api/productApi";
import {
  buildInviteLink,
  canPrepareOrderTrigger,
  createDraftInputFromValues,
  isOrderDraftEditable,
  orderFormValidationError,
  publishedZhixuSummaries,
  updateDraftInputFromValues
} from "./form";
import {
  orderFailureMessage,
  unconfirmedRequiredParticipantLabels
} from "./messages";
import {
  DRAFT_STATUS_LABELS,
  IDLE_ORDER_ACTION,
  emptyOrderFormValues,
  type CreateOrderFormValues,
  type DraftParticipantsState,
  type OrderActionState,
  type OrderInviteActions,
  type PublishedZhixuSummary,
  type ZhixuCatalogState
} from "./types";
import {
  orderTriggerSignExpectation,
  requestCreateOrderWalletAddress,
  signOrderTriggerWithInjectedWallet
} from "./wallet";

export interface CreateOrderFlowInput {
  readonly api: ProductApiClient;
  /** 当前会话锚定钱包：开单准备/提交的身份声明（真实身份仍由会话决定）。 */
  readonly walletAddress?: string | undefined;
  /** 创建成功回调（页面据此提示并跳到订单页）。 */
  readonly onCreated?: ((result: CreateOrderCreatedResult) => void) | undefined;
  /** 写路径 401：宿主清会话切登录面；返回是否已接管。 */
  readonly onSessionExpired?: ((error: unknown) => boolean) | undefined;
}

export interface CreateOrderCreatedResult {
  readonly draftId: string;
  readonly title: string;
  readonly orderId?: string | undefined;
}

export interface CreateOrderFlow {
  readonly zhixus: ZhixuCatalogState;
  readonly selectedZhixuId?: string | undefined;
  readonly selectedZhixu?: PublishedZhixuSummary | undefined;
  readonly values: CreateOrderFormValues;
  readonly draft?: ProductOrderDraftDTO | undefined;
  readonly participants: DraftParticipantsState;
  readonly draftAction: OrderActionState;
  readonly inviteActions: OrderInviteActions;
  readonly registerAction: OrderActionState;
  readonly refreshZhixus: () => Promise<void>;
  readonly selectZhixu: (zhixuId: string) => void;
  readonly updateValues: (patch: Partial<CreateOrderFormValues>) => void;
  readonly createOrSaveDraft: () => Promise<void>;
  readonly reloadParticipants: () => Promise<void>;
  readonly sendInvite: (participant: DraftParticipantDTO, contact: string) => Promise<void>;
  readonly registerOrder: () => Promise<void>;
}

/**
 * 开单流程状态机（页面只渲染，不自行发请求）。
 *
 * 步骤：已发布秩序目录 → 选秩序（装修/阶段由页面读）→ 生成/保存订单内容草稿
 * → 参与方确认（邀请链接）→ 本人确认并创建订单。
 * 失败态一律落在对应动作状态里；没有草稿/没有参与方确认时不发签名请求。
 */
export function useCreateOrderFlow(input: CreateOrderFlowInput): CreateOrderFlow {
  const { api, walletAddress, onCreated, onSessionExpired } = input;
  const [zhixus, setZhixus] = useState<ZhixuCatalogState>({ status: "loading" });
  const [selectedZhixuId, setSelectedZhixuId] = useState<string | undefined>(undefined);
  const [values, setValues] = useState<CreateOrderFormValues>(() => emptyOrderFormValues());
  const [draft, setDraft] = useState<ProductOrderDraftDTO | undefined>(undefined);
  const [participants, setParticipants] = useState<DraftParticipantsState>({ status: "idle" });
  const [draftAction, setDraftAction] = useState<OrderActionState>(IDLE_ORDER_ACTION);
  const [inviteActions, setInviteActions] = useState<OrderInviteActions>({});
  const [registerAction, setRegisterAction] = useState<OrderActionState>(IDLE_ORDER_ACTION);

  // 慢网下旧响应不得覆盖新响应（与 App 的 home 加载同口径）。
  const catalogSequenceRef = useRef(0);
  const participantsSequenceRef = useRef(0);
  // 长链路（准备→本人确认→提交）同步互斥：按钮 pending 生效前挡住第二次点击。
  const registerInflightRef = useRef(false);

  async function refreshZhixus(): Promise<void> {
    const sequence = catalogSequenceRef.current + 1;
    catalogSequenceRef.current = sequence;
    setZhixus({ status: "loading" });
    try {
      const items = await api.listZhixus();
      if (catalogSequenceRef.current !== sequence) {
        return;
      }
      setZhixus({ status: "ready", items: publishedZhixuSummaries(items) });
    } catch (error) {
      if (catalogSequenceRef.current !== sequence) {
        return;
      }
      if (onSessionExpired?.(error)) {
        return;
      }
      setZhixus({ status: "error", message: orderFailureMessage(error, "秩序目录加载失败") });
    }
  }

  useEffect(() => {
    void refreshZhixus();
    // 目录只随客户端实例变化重载；refreshZhixus 是事件入口，不参与依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  function selectZhixu(zhixuId: string): void {
    if (zhixuId === selectedZhixuId) {
      return;
    }
    // 切换秩序即作废旧草稿/参与方/动作状态：A→B 回切不得复用旧草稿。
    setSelectedZhixuId(zhixuId);
    setValues(emptyOrderFormValues());
    setDraft(undefined);
    setParticipants({ status: "idle" });
    setDraftAction(IDLE_ORDER_ACTION);
    setInviteActions({});
    setRegisterAction(IDLE_ORDER_ACTION);
    participantsSequenceRef.current += 1;
  }

  function updateValues(patch: Partial<CreateOrderFormValues>): void {
    setValues((current) => ({ ...current, ...patch }));
  }

  /** 草稿回读 + 参与方刷新：触发前的权威状态来源。 */
  async function loadDraftSnapshot(draftId: string): Promise<void> {
    const sequence = participantsSequenceRef.current + 1;
    participantsSequenceRef.current = sequence;
    setParticipants({ status: "loading" });
    try {
      const snapshot = await api.getOrderDraft(draftId);
      if (participantsSequenceRef.current !== sequence) {
        return;
      }
      setDraft(snapshot.draft);
      setParticipants({ status: "ready", participants: snapshot.participants });
    } catch (error) {
      if (participantsSequenceRef.current !== sequence) {
        return;
      }
      if (onSessionExpired?.(error)) {
        return;
      }
      setParticipants({ status: "error", message: orderFailureMessage(error, "参与方状态加载失败") });
    }
  }

  async function createOrSaveDraft(): Promise<void> {
    if (draftAction.phase === "pending") {
      return;
    }
    if (!selectedZhixuId) {
      setDraftAction({ phase: "error", message: "请先选择一条已发布的秩序。" });
      return;
    }
    const validationError = orderFormValidationError(values);
    if (validationError) {
      setDraftAction({ phase: "error", message: validationError });
      return;
    }
    if (draft && !isOrderDraftEditable(draft.status)) {
      setDraftAction({
        phase: "error",
        message: `订单当前状态是「${DRAFT_STATUS_LABELS[draft.status]}」，内容不能再修改。`
      });
      return;
    }
    setDraftAction({ phase: "pending", message: draft ? "正在保存订单内容" : "正在生成订单内容" });
    try {
      if (!draft) {
        const created = await api.createOrderDraft(createDraftInputFromValues(selectedZhixuId, values));
        setDraft(created);
        setDraftAction({
          phase: "success",
          message: "订单内容已生成。接下来邀请参与方确认，再由你本人确认创建订单。"
        });
        await loadDraftSnapshot(created.draftId);
        return;
      }
      const updated = await api.updateOrderDraft(draft.draftId, updateDraftInputFromValues(values));
      setDraft(updated);
      setDraftAction({ phase: "success", message: "订单内容已保存。" });
      await loadDraftSnapshot(updated.draftId);
    } catch (error) {
      if (onSessionExpired?.(error)) {
        return;
      }
      setDraftAction({ phase: "error", message: orderFailureMessage(error, "订单内容保存失败") });
    }
  }

  async function reloadParticipants(): Promise<void> {
    if (!draft) {
      return;
    }
    await loadDraftSnapshot(draft.draftId);
  }

  async function sendInvite(participant: DraftParticipantDTO, contact: string): Promise<void> {
    if (!draft) {
      return;
    }
    const roleSlotId = participant.roleSlotId;
    const trimmedContact = contact.trim();
    if (!trimmedContact) {
      setInviteActions((current) => ({
        ...current,
        [roleSlotId]: { phase: "error", message: "请先填写该参与方的联系方式，再生成邀请。" }
      }));
      return;
    }
    setInviteActions((current) => ({
      ...current,
      [roleSlotId]: { phase: "pending", message: "正在生成邀请" }
    }));
    try {
      const created = await api.createOrderDraftInvite(draft.draftId, {
        roleSlotId,
        contact: trimmedContact,
        ...(participant.displayName.trim() ? { displayName: participant.displayName.trim() } : {})
      });
      const baseHref = typeof window === "undefined" ? "http://localhost/" : window.location.href;
      const inviteLink = buildInviteLink(baseHref, created.invite.inviteId, created.inviteToken);
      setDraft(created.draft);
      setInviteActions((current) => ({
        ...current,
        [roleSlotId]: {
          phase: "success",
          message: "邀请已生成：把链接发给对方，对方确认后本页状态会更新。",
          invite: created.invite,
          inviteLink
        }
      }));
      await loadDraftSnapshot(created.draft.draftId);
    } catch (error) {
      if (onSessionExpired?.(error)) {
        return;
      }
      setInviteActions((current) => ({
        ...current,
        [roleSlotId]: { phase: "error", message: orderFailureMessage(error, "邀请生成失败") }
      }));
    }
  }

  async function registerOrder(): Promise<void> {
    if (registerInflightRef.current) {
      return;
    }
    if (!draft) {
      setRegisterAction({ phase: "error", message: "请先生成订单内容，再创建订单。" });
      return;
    }
    if (!walletAddress) {
      setRegisterAction({ phase: "error", message: "尚未完成参与者登录，不能创建订单。" });
      return;
    }
    registerInflightRef.current = true;
    setRegisterAction({ phase: "pending", message: "正在核对参与方确认状态" });
    try {
      // 先用服务端当前状态判定，不拿本地陈旧参与方清单去签名。
      const current = await api.getOrderDraft(draft.draftId);
      setDraft(current.draft);
      setParticipants({ status: "ready", participants: current.participants });
      const missing = unconfirmedRequiredParticipantLabels(current.participants);
      if (missing.length > 0) {
        setRegisterAction({
          phase: "error",
          message: `还有必填参与方没有完成确认：${missing.join("、")}。请先生成邀请并等待对方确认。`
        });
        return;
      }
      if (!canPrepareOrderTrigger(current.draft.status)) {
        setRegisterAction({
          phase: "error",
          message: `订单当前状态是「${DRAFT_STATUS_LABELS[current.draft.status]}」，还不能创建。请先完成参与方确认并刷新状态。`
        });
        return;
      }
      setRegisterAction({ phase: "pending", message: "正在准备本次确认内容" });
      const account = await requestCreateOrderWalletAddress();
      const prepared = await api.prepareOrderTrigger(draft.draftId, { walletAddress: account });
      const expectation = orderTriggerSignExpectation();
      if (prepared.stateMachineAddress.toLowerCase() !== expectation.verifyingContract.toLowerCase()) {
        throw new Error("开单准备的部署信息与当前环境不一致，已拒绝本次确认。");
      }
      setRegisterAction({ phase: "pending", message: "等待你本人确认" });
      const signature = await signOrderTriggerWithInjectedWallet({
        typedData: prepared.typedData,
        walletAddress: account,
        expected: expectation,
        preparedSubmitters: [prepared.submitter]
      });
      setRegisterAction({ phase: "pending", message: "正在提交订单" });
      const result = await api.triggerOrder(draft.draftId, {
        prepareId: prepared.prepareId,
        signature,
        walletAddress: account
      });
      setDraft(result.draft);
      setRegisterAction({ phase: "success", message: "订单已创建，正在同步订单与任务。" });
      onCreated?.({
        draftId: draft.draftId,
        title: result.draft.title,
        ...(result.draft.triggeredOrderId ? { orderId: result.draft.triggeredOrderId } : {})
      });
    } catch (error) {
      if (onSessionExpired?.(error)) {
        return;
      }
      setRegisterAction({ phase: "error", message: orderFailureMessage(error, "订单创建失败") });
    } finally {
      registerInflightRef.current = false;
    }
  }

  const selectedZhixu = zhixus.status === "ready"
    ? zhixus.items.find((item) => item.zhixuId === selectedZhixuId)
    : undefined;

  return {
    zhixus,
    selectedZhixuId,
    selectedZhixu,
    values,
    draft,
    participants,
    draftAction,
    inviteActions,
    registerAction,
    refreshZhixus,
    selectZhixu,
    updateValues,
    createOrSaveDraft,
    reloadParticipants,
    sendInvite,
    registerOrder
  };
}
