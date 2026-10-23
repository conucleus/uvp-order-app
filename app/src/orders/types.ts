import type {
  DraftParticipantDTO,
  DraftParticipantStatus,
  ProductOrderDraftDTO,
  ProductOrderDraftStatus,
  ProductOrderInviteDTO
} from "../api/productApi";

export interface CreateOrderFormValues {
  readonly title: string;
  readonly businessType: string;
  readonly goodsText: string;
  readonly totalAmount: string;
  readonly currency: string;
  readonly notes: string;
}

export type OrderActionPhase = "idle" | "pending" | "success" | "error";

export interface OrderActionState {
  readonly phase: OrderActionPhase;
  readonly message?: string | undefined;
}

export interface OrderInviteActionState extends OrderActionState {
  readonly invite?: ProductOrderInviteDTO | undefined;
  readonly inviteLink?: string | undefined;
}

export type OrderInviteActions = Readonly<Record<string, OrderInviteActionState>>;

export type ZhixuCatalogState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly items: readonly PublishedZhixuSummary[] }
  | { readonly status: "error"; readonly message: string };

export interface PublishedZhixuSummary {
  readonly zhixuId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly reviewLabel: string;
  readonly publicationLabel: string;
  readonly stageCount: number;
  readonly roleSlotCount: number;
  readonly applicableBusiness: readonly string[];
  readonly supportedPaymentMethods: readonly string[];
  readonly updatedAt: string;
}

export type DraftParticipantsState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly participants: readonly DraftParticipantDTO[];
    }
  | { readonly status: "error"; readonly message: string };

export interface OrderDraftSnapshot {
  readonly draft: ProductOrderDraftDTO;
  readonly participants: readonly DraftParticipantDTO[];
}

export const DRAFT_STATUS_LABELS: Readonly<Record<ProductOrderDraftStatus, string>> = {
  draft: "草稿",
  awaiting_participants: "等待参与方确认",
  ready_to_trigger: "可以创建",
  triggering: "正在创建",
  triggered: "已创建",
  failed: "创建失败，可重试",
  cancelled: "已取消"
};

export const PARTICIPANT_STATUS_LABELS: Readonly<Record<DraftParticipantStatus, string>> = {
  missing: "未邀请",
  invited: "等待确认",
  accepted: "已确认",
  rejected: "已拒绝",
  replaced: "已替换"
};

export const IDLE_ORDER_ACTION: OrderActionState = { phase: "idle" };

export function emptyOrderFormValues(): CreateOrderFormValues {
  return {
    title: "",
    businessType: "",
    goodsText: "",
    totalAmount: "",
    currency: "",
    notes: ""
  };
}
