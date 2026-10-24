import {
  type ChainProofRowDTO,
  type EvidenceProofDTO,
  type OrderRequirementsBundleDTO,
  type OrderRequirementsConsentDTO,
  type OrderRequirementsTriggerAnchorDTO,
  type PrepareProductTaskSubmitInput,
  type ProductExecutorPatchMode,
  type ProductOrderDTO,
  type ProductParticipantProfileDTO,
  type ProductSubmissionDTO,
  type ProductSubmissionStatus,
  type ProductSubmitIntent,
  type ProductTaskDTO,
  type SubmitProductTaskInput,
  type ZhixuDetailDTO,
  type ZhixuSummaryDTO
} from "@uvp-eth/product-dto";
import type { ProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";
import type {
  DecorationDataView,
  DecorationEvidenceSlotView,
  DecorationTaskDeclarationView,
  DecorationThemeView,
  DecorationVersionView,
  ZhixuDecorationView
} from "../decoration/types";
import { participantPath } from "./participantPath";
import { deadlineSortMs } from "../tasks/model/taskUtils";
import { EscrowReadError, parseOrderEscrowList, parseOrderEscrowTranche } from "../escrow/read";
import type { OrderEscrowReadResult } from "../escrow/types";

// 写侧契约单源：提交意图、prepare/submit 请求体、
// 提交回执与证据证明以 @uvp-eth/product-dto 为唯一出处（形状按
// uvp-chain-services 服务端真身裁定——statusLabel 与 EvidenceProofDTO 的
// evidenceId/payloadRef/storageURI 服务端恒产出，为必填），本模块只做
// transport，不手写镜像。
export type {
  EvidenceProofDTO,
  PrepareProductTaskSubmitInput,
  ProductSubmissionDTO,
  ProductSubmissionStatus,
  ProductSubmitIntent,
  SubmitProductTaskInput,
  ZhixuSummaryDTO
} from "@uvp-eth/product-dto";

type Hex = `0x${string}`;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type Eip712TypedDataDTO = Readonly<{
  readonly domain: Readonly<Record<string, unknown>>;
  readonly types: Readonly<Record<string, readonly { readonly name: string; readonly type: string }[]>>;
  readonly primaryType: string;
  readonly message: Readonly<Record<string, unknown>>;
}>;

export type ProductApiSource = Readonly<{
  readonly kind: "real";
  readonly baseUrl: string;
}>;

export interface ProductApiSummaryDTO {
  readonly orderCount: number;
  readonly openTaskCount: number;
  readonly blockedTaskCount: number;
  /** 已提交待索引的任务数：服务端任务词表没有完成态，这是可真实统计的终向指标。 */
  readonly submittedTaskCount: number;
}

export interface ProductHomeData {
  readonly participant: ProductParticipantProfileDTO;
  readonly summary: ProductApiSummaryDTO;
  readonly orders: readonly ProductOrderDTO[];
  readonly tasks: readonly ProductTaskDTO[];
  readonly source: ProductApiSource;
}

/**
 * 开单草稿（Product BFF `/product/order-drafts` 档案面）。
 *
 * 状态词表与服务端一致：草稿内容进入触发流程后不可再改；`ready_to_trigger`
 * 表示参与方条件已满足、可以准备本人确认。草稿是"订单从何而来"的档案，
 * 不是链上事实本身。
 */
export type ProductOrderDraftStatus =
  | "draft"
  | "awaiting_participants"
  | "ready_to_trigger"
  | "triggering"
  | "triggered"
  | "failed"
  | "cancelled";

export type DraftParticipantStatus = "missing" | "invited" | "accepted" | "rejected" | "replaced";

export interface ProductOrderDraftDTO {
  readonly draftId: string;
  readonly zhixuId: string;
  readonly planId: string;
  readonly planHash: string;
  readonly title: string;
  readonly businessType: string;
  readonly goods?: readonly string[] | undefined;
  readonly totalAmount: string;
  readonly currency: string;
  readonly exportRegion?: string | undefined;
  readonly destinationRegion?: string | undefined;
  readonly expectedCompletionDate?: string | undefined;
  readonly notes?: string | undefined;
  readonly status: ProductOrderDraftStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly triggeredOrderId?: string | undefined;
  readonly triggerTxHash?: string | undefined;
}

/** 草稿参与方：按秩序角色槽位在建单时生成，确认状态来自邀请接受事实。 */
export interface DraftParticipantDTO {
  readonly participantId: string;
  readonly draftId: string;
  readonly roleSlotId: string;
  readonly roleLabel: string;
  readonly displayName: string;
  readonly walletAddress?: string | undefined;
  readonly contact: string;
  readonly status: DraftParticipantStatus;
  readonly required: boolean;
  readonly acceptedAt?: string | undefined;
  readonly rejectedAt?: string | undefined;
}

export interface CreateOrderDraftInput {
  readonly zhixuId: string;
  readonly title: string;
  readonly businessType: string;
  readonly goods?: readonly string[];
  readonly totalAmount: string;
  readonly currency: string;
  readonly notes?: string;
}

export type UpdateOrderDraftInput = Partial<
  Pick<
    ProductOrderDraftDTO,
    | "title"
    | "businessType"
    | "goods"
    | "totalAmount"
    | "currency"
    | "exportRegion"
    | "destinationRegion"
    | "expectedCompletionDate"
    | "notes"
  >
>;

export interface CreateOrderInviteInput {
  readonly roleSlotId: string;
  readonly contact: string;
  readonly displayName?: string | undefined;
}

/** 邀请记录（服务端不下发 token 明文，tokenHash 也不在产品面展示）。 */
export interface ProductOrderInviteDTO {
  readonly inviteId: string;
  readonly draftId: string;
  readonly participantId: string;
  readonly roleSlotId: string;
  readonly status: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

/** 邀请创建响应：一次性明文 token 只在本次响应出现，用于拼邀请链接。 */
export interface ProductOrderInviteCreationDTO {
  readonly invite: ProductOrderInviteDTO;
  readonly draft: ProductOrderDraftDTO;
  readonly inviteToken: string;
}

/** 草稿详情读取：内容 + 当前参与方确认状态（服务端同一响应返回）。 */
export interface ProductOrderDraftDetailDTO {
  readonly draft: ProductOrderDraftDTO;
  readonly participants: readonly DraftParticipantDTO[];
}

/**
 * 订单要求包读取结果：bundle 本身是 product-dto 单源，draft/editable/
 * triggerAnchor 是同一次服务端读取附带的草稿与触发锚字段。
 */
export interface OrderRequirementsReadResult {
  readonly bundle: OrderRequirementsBundleDTO;
  readonly draft: ProductOrderDraftDTO;
  /** 服务端下发的合意签名消息（格式单源在 product-dto，客户端不自拼）。 */
  readonly consentMessage: string;
  /** 当前草稿是否仍允许改要求包（读面展示旗标，不改写）。 */
  readonly editable: boolean;
  readonly triggerAnchor?: OrderRequirementsTriggerAnchorDTO | undefined;
}

/**
 * 相对方合意：requirementsHash 必须取自服务端读面，客户端不自算/不自报；
 * 签名覆盖 (draftId, requirementsHash)，密钥/凭据不进请求。
 */
export interface SubmitOrderRequirementsConsentInput {
  readonly requirementsHash: string;
  readonly signature: string;
  /** local 运行时的自报钱包声明；非 local 以会话锚定地址为准。 */
  readonly walletAddress?: string | undefined;
}

/** 合意回执：服务端落库后的合意记录、当前合意集合与触发锚。 */
export interface OrderRequirementsConsentResultDTO {
  readonly consent: OrderRequirementsConsentDTO;
  readonly consents: readonly OrderRequirementsConsentDTO[];
  readonly triggerAnchor: OrderRequirementsTriggerAnchorDTO;
}

/**
 * prepare 结果：签名对象 + 本次触发身份。
 * `stateMachineAddress` 从 trigger 记录单独取出，供签名前与签名域交叉核对
 * （不信任同一响应里的 humanSummary/typedData 自洽）。
 */
export interface PreparedOrderTriggerDTO {
  readonly prepareId: string;
  readonly triggerId: string;
  readonly draftId: string;
  readonly orderId: string;
  readonly expiresAt: string;
  readonly submitter: string;
  readonly stateMachineAddress: string;
  readonly typedData: Eip712TypedDataDTO;
  readonly summary?: Readonly<Record<string, unknown>> | undefined;
}

export interface TriggerOrderInput {
  readonly prepareId: string;
  readonly signature: string;
  readonly walletAddress: string;
}

/** 触发提交回执：草稿状态 + 参与方 + 触发档案；草稿的 triggeredOrderId 可指向已创建订单。 */
export interface TriggerOrderResultDTO {
  readonly draft: ProductOrderDraftDTO;
  readonly participants?: readonly DraftParticipantDTO[] | undefined;
  readonly trigger?: Readonly<Record<string, unknown>> | undefined;
}

export interface ProductApiClient {
  loadParticipantHome(input?: ParticipantQueryInput): Promise<ProductHomeData>;
  getOrder(orderId: string): Promise<ProductOrderDTO>;
  /**
   * 通用阶段托管读面：GET /product/orders/:orderId/escrow[/:stageId]。
   * 与其它参与者读一致：local 运行时经 walletAddress 自报身份，会话运行时由
   * x-uvp-store-session 锚定（自报值必须与会话地址一致）。
   */
  getOrderEscrow(
    orderId: string,
    stageId?: string,
    input?: ParticipantQueryInput
  ): Promise<OrderEscrowReadResult>;
  getTask(taskId: string, input?: ParticipantQueryInput): Promise<ProductTaskDTO>;
  /** 秩序详情（reader 装修页/阶段数据源；Product API 公共读，不需要钱包会话）。 */
  getZhixu(zhixuId: string): Promise<ZhixuDetailDTO>;
  /**
   * 已发布秩序清单（开单入口）：GET /product/zhixus。
   * 只返回服务端目录投影；是否"可开单"由页面按发布状态与开单声明判定，
   * 不在客户端伪造发布事实。
   */
  listZhixus(): Promise<readonly ZhixuSummaryDTO[]>;
  /** 创建订单草稿（开单第一步）：服务端按秩序角色槽位生成参与方清单。 */
  createOrderDraft(input: CreateOrderDraftInput): Promise<ProductOrderDraftDTO>;
  /** 修改草稿内容（参与方邀请/确认阶段）。进入触发流程后服务端拒绝修改。 */
  updateOrderDraft(draftId: string, input: UpdateOrderDraftInput): Promise<ProductOrderDraftDTO>;
  /** 草稿回读：内容 + 参与方确认状态（触发前必读一次，避免用本地陈旧状态判定）。 */
  getOrderDraft(draftId: string): Promise<ProductOrderDraftDetailDTO>;
  /** 读取草稿的要求包（句柄集合 + 预设引用 + 服务端算出的 requirementsHash）。 */
  getOrderRequirementsBundle(draftId: string, input?: ParticipantQueryInput): Promise<OrderRequirementsReadResult>;
  /** 相对方对当前 requirementsHash 显式签名合意；失败按服务端错误码返回。 */
  consentOrderRequirements(
    draftId: string,
    input: SubmitOrderRequirementsConsentInput
  ): Promise<OrderRequirementsConsentResultDTO>;
  listOrderDraftParticipants(draftId: string): Promise<readonly DraftParticipantDTO[]>;
  /** 生成参与方邀请链接；明文 token 只在本次响应出现一次。 */
  createOrderDraftInvite(draftId: string, input: CreateOrderInviteInput): Promise<ProductOrderInviteCreationDTO>;
  /** 准备开单确认：服务端按草稿/参与方/秩序生成签名对象（身份取会话锚定钱包）。 */
  prepareOrderTrigger(draftId: string, input: { readonly walletAddress: string }): Promise<PreparedOrderTriggerDTO>;
  /** 提交本人确认并创建订单；失败即失败，不返回假订单。 */
  triggerOrder(draftId: string, input: TriggerOrderInput): Promise<TriggerOrderResultDTO>;
  /** Store 装修数据（Store 数据域读侧；缺失即空版本，不是链上事实）。 */
  getDecoration(planId: string): Promise<ZhixuDecorationView>;
  previewInvite(inviteId: string, input?: ParticipantQueryInput): Promise<ProductInvitePreviewDTO>;
  acceptInvite(inviteId: string, input: AcceptInviteInput, options?: InviteRequestOptions): Promise<ProductInviteAcceptanceDTO>;
  rejectInvite(inviteId: string, input?: RejectInviteInput): Promise<ProductInviteAcceptanceDTO>;
  /**
   * 服务端认可的钱包控制证明：/store/auth challenge → 钱包 personal_sign →
   * verify 换取会话 token（x-uvp-store-session）。accept 邀请在非 local
   * 运行时必须携带该会话；签名者由调用方注入。
   */
  proveWalletControl(input: { readonly address: string }): Promise<WalletSessionProof>;
  /** 客户端当前持有的钱包会话 token（proveWalletControl 成功后留存），供通知等旁路请求复用同一会话锚定。 */
  currentSessionToken(): string | undefined;
  /**
   * 恢复/清除钱包会话 token（页面刷新或新开标签页时从 localStorage 恢复；服务端
   * 判定会话失效时清除）。返回是否真的改变了客户端持有的 token。
   */
  restoreSessionToken(token: string | undefined): boolean;
  prepareTaskSubmit(taskId: string, input: PrepareProductTaskSubmitInput): Promise<PreparedTaskSubmitDTO>;
  submitTask(taskId: string, input: SubmitProductTaskInput): Promise<ProductSubmissionDTO>;
  prepareStageExecutorPatch(taskId: string, input: PrepareStageExecutorPatchInput): Promise<PreparedStageExecutorPatchDTO>;
  submitStageExecutorPatch(taskId: string, input: SubmitStageExecutorPatchInput): Promise<StageExecutorPatchSubmissionDTO>;
  prepareStageResourcePatch(taskId: string, input: PrepareStageResourcePatchInput): Promise<PreparedStageResourcePatchDTO>;
  submitStageResourcePatch(taskId: string, input: SubmitStageResourcePatchInput): Promise<StageResourcePatchSubmissionDTO>;
  uploadEvidence(input: CreateEvidenceInput): Promise<EvidenceUploadResponseDTO>;
  getEvidenceProof(evidenceId: string): Promise<EvidenceProofDTO>;
}

export interface ParticipantQueryInput {
  readonly walletAddress?: string | undefined;
  /** 一次性邀请令牌：预览（POST /product/invites/:id body）与 accept/reject 一样按 token 哈希比对，缺失即拒。 */
  readonly token?: string | undefined;
}

/** 钱包消息签名器：与会话 challenge 报文配套（personal_sign 口径）。 */
export type PersonalSigner = (address: string, message: string) => Promise<string>;

export interface WalletSessionProof {
  readonly sessionToken: string;
  readonly anchoredAddress: string;
}

export interface InviteRequestOptions {
  /** 已证明控制的钱包会话 token；服务端以其锚定 accept 身份。 */
  readonly sessionToken?: string | undefined;
}

export interface ProductApiClientOptions {
  readonly baseUrl?: string | undefined;
  readonly fetcher?: Fetcher | undefined;
  /** 单个请求的超时毫秒数；默认对齐 store 工作台 6s 口径。 */
  readonly timeoutMs?: number | undefined;
  /** 证据上传等大载荷请求的超时毫秒数；默认 60s。 */
  readonly uploadTimeoutMs?: number | undefined;
  /** proveWalletControl 用的钱包签名器；缺省直接抛错而不是静默走自报身份。 */
  readonly personalSign?: PersonalSigner | undefined;
}

export interface AcceptInviteInput {
  readonly displayName: string;
  readonly walletAddress: string;
  readonly contact: string;
  /** 一次性邀请令牌（创建邀请时下发，随邀请链接送达）；服务端做哈希比对。 */
  readonly token: string;
}

export interface RejectInviteInput {
  /** 一次性邀请令牌；reject 同样强制回呈。 */
  readonly token: string;
  readonly displayName?: string | undefined;
  readonly contact?: string | undefined;
}

export interface ProductInviteAcceptanceDTO {
  readonly invite?: unknown;
  readonly participant?: unknown;
  readonly draft?: unknown;
}

export interface ProductInvitePreviewDTO {
  readonly invite: {
    readonly inviteId: string;
    readonly status: string;
    readonly expiresAt: string;
    readonly acceptedWalletAddress?: string;
  };
  readonly participant: {
    readonly participantId: string;
    readonly roleLabel: string;
    readonly displayName: string;
    readonly contact: string;
    readonly status: string;
    readonly walletAddress?: string;
  };
  readonly draft: {
    readonly draftId: string;
    readonly title: string;
    readonly businessType: string;
    readonly currency: string;
    readonly totalAmount: string;
  };
  readonly acceptance?: {
    readonly canAccept: boolean;
    readonly status: string;
  };
  readonly role?: {
    readonly roleSlotId: string;
    readonly label: string;
    readonly duty: string;
    readonly evidenceSpec?: readonly {
      readonly key: string;
      readonly label: string;
    }[];
  };
  readonly walletBinding?: {
    readonly walletAddress: string;
    readonly alreadyBound: boolean;
    readonly canAccept: boolean;
    readonly boundRoleLabel?: string;
  };
}

export interface PrepareStageExecutorPatchInput {
  readonly selectorWallet: string;
  readonly targetStageId: string;
  readonly executorWallet: string;
  readonly executorMetadataHash: Hex | string;
  readonly metadataURI: string;
  readonly mode?: ProductExecutorPatchMode | undefined;
  readonly previousExecutorWallet?: string | undefined;
  readonly executorReference?: string | undefined;
}

export interface SubmitStageExecutorPatchInput {
  readonly prepareId?: string | undefined;
  readonly selectorWallet: string;
  readonly typedData?: Eip712TypedDataDTO | undefined;
  readonly signature: string;
  readonly patch?: PreparedStageExecutorPatchDTO | undefined;
  readonly mode?: ProductExecutorPatchMode | undefined;
  readonly previousExecutorWallet?: string | undefined;
  readonly previousExecutorSignature?: string | undefined;
}

export interface PrepareStageResourcePatchInput {
  readonly selectorWallet: string;
  readonly targetStageId: string;
  readonly resourceKey: string;
  readonly manifestURI: string;
  readonly manifestHash: Hex | string;
  readonly policyHash: Hex | string;
}

export interface SubmitStageResourcePatchInput {
  readonly prepareId?: string | undefined;
  readonly selectorWallet: string;
  readonly typedData?: Eip712TypedDataDTO | undefined;
  readonly signature: string;
  readonly patch?: PreparedStageResourcePatchDTO | undefined;
}

export interface PreparedTaskSubmitDTO {
  readonly prepareId: string;
  readonly taskId: string;
  readonly orderId: string;
  readonly intent: ProductSubmitIntent;
  readonly payloadHash: Hex;
  readonly submitter: string;
  readonly expiresAt: string;
  readonly humanSummary?: {
    readonly purpose: string;
    readonly taskTitle: string;
    readonly stage: string;
    readonly action: string;
    readonly validUntil: string;
  };
  readonly typedData: ProductSubmitTypedData;
  readonly evidence: readonly unknown[];
}

export interface PreparedStageExecutorPatchDTO {
  readonly prepareId: string;
  readonly orderId: string;
  readonly selectorTaskId?: string;
  readonly taskId?: string;
  readonly targetStageId: string;
  readonly mode?: ProductExecutorPatchMode;
  readonly previousExecutor?: string;
  readonly patchHash: Hex;
  readonly expiresAt?: string;
  readonly typedData: Eip712TypedDataDTO;
  readonly humanSummary?: {
    readonly purpose?: string;
    readonly taskTitle?: string;
    readonly targetStage?: string;
    readonly action?: string;
    readonly validUntil?: string;
    /** 补丁 EIP-712 域的验签合约（UVPStagePatchModule 地址），与 typedData.domain 交叉核对。 */
    readonly verifyingContract?: string;
  };
}

export interface StageExecutorPatchSubmissionDTO {
  readonly submissionId?: string;
  readonly prepareId: string;
  readonly orderId: string;
  readonly selectorTaskId?: string;
  readonly taskId?: string;
  readonly targetStageId: string;
  readonly mode?: ProductExecutorPatchMode;
  readonly previousExecutor?: string;
  readonly status: ProductSubmissionStatus;
  readonly txHash?: Hex;
  readonly blockNumber?: string;
  readonly errorCode?: string;
  readonly retryable: boolean;
  readonly proofRows: readonly ChainProofRowDTO[];
}

export interface PreparedStageResourcePatchDTO {
  readonly prepareId: string;
  readonly orderId: string;
  readonly taskId?: string;
  readonly targetStageId: string;
  readonly resourceKey: string;
  readonly manifestHash: Hex;
  readonly policyHash: Hex;
  readonly patchHash: Hex;
  readonly expiresAt?: string;
  readonly typedData: Eip712TypedDataDTO;
  readonly humanSummary?: {
    readonly purpose?: string;
    readonly taskTitle?: string;
    readonly targetStage?: string;
    readonly resourceLabel?: string;
    readonly action?: string;
    readonly validUntil?: string;
    /** 补丁 EIP-712 域的验签合约（UVPStagePatchModule 地址），与 typedData.domain 交叉核对。 */
    readonly verifyingContract?: string;
  };
}

export interface StageResourcePatchSubmissionDTO {
  readonly submissionId?: string;
  readonly prepareId: string;
  readonly orderId: string;
  readonly taskId?: string;
  readonly targetStageId: string;
  readonly resourceKey: string;
  readonly status: ProductSubmissionStatus;
  readonly txHash?: Hex;
  readonly blockNumber?: string;
  readonly errorCode?: string;
  readonly retryable: boolean;
  readonly proofRows: readonly ChainProofRowDTO[];
}

export interface CreateEvidenceInput {
  readonly orderId?: string;
  readonly taskId?: string;
  readonly stageIdentifier: string;
  readonly documentType: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly textPayload?: string;
  readonly base64Payload?: string;
  readonly jsonPayload?: unknown;
  readonly metadata?: {
    readonly businessLabel?: string;
    readonly description?: string;
    readonly documentType?: string;
    readonly issuer?: string;
    readonly issuedAt?: string;
    readonly fields?: unknown;
    readonly redactionPolicy?: unknown;
  };
}

export interface EvidenceObjectDTO {
  readonly evidenceId: string;
  readonly orderId?: string;
  readonly taskId?: string;
  readonly stageIdentifier: string;
  readonly ownerParticipantId?: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly storageURI?: string;
  readonly contentHash: Hex;
  readonly metadataHash: Hex;
  readonly payloadHash: Hex;
  readonly payloadRef: string;
  readonly status: string;
  readonly createdAt: string;
  readonly boundSignalTxHash?: Hex;
}

export interface EvidenceUploadResponseDTO {
  readonly evidence: EvidenceObjectDTO;
  readonly payloadHash?: Hex;
  readonly payloadRef?: string;
}

export class ProductApiError extends Error {
  override readonly name = "ProductApiError";
  /** 服务端错误体的 `error` 短码（如 wallet_identity_required）；非 JSON 体为空。 */
  readonly errorCode?: string;
  /** 服务端错误体原文：message 已提取为人类可读文案时保留原始 JSON 供展开核对。 */
  readonly bodyText?: string | undefined;

  constructor(
    readonly status: number,
    readonly endpoint: string,
    message: string,
    errorCode?: string,
    bodyText?: string
  ) {
    super(message);
    if (errorCode !== undefined) {
      this.errorCode = errorCode;
    }
    if (bodyText !== undefined) {
      this.bodyText = bodyText;
    }
  }
}

/** 401 + 该码表示参与者面请求缺有效钱包会话：界面据此切换到钱包登录入口。 */
export const WALLET_IDENTITY_REQUIRED_CODE = "wallet_identity_required";

/** 钱包会话 token 的浏览器级持久化键：刷新页面与新开标签页共用同一会话（与 Store 同口径）。 */
const WALLET_SESSION_STORAGE_KEY = "uvp-order-app:wallet-session";

export function readPersistedWalletSessionToken(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(WALLET_SESSION_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function persistWalletSessionToken(token: string | undefined): void {
  try {
    if (token === undefined) {
      globalThis.localStorage?.removeItem(WALLET_SESSION_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(WALLET_SESSION_STORAGE_KEY, token);
    }
  } catch {
    // 存储不可用（隐私模式/测试环境）只损失跨页恢复，登录流程本身不受影响。
  }
}

export function isWalletIdentityRequired(error: unknown): error is ProductApiError {
  return error instanceof ProductApiError
    && error.status === 401
    && error.errorCode === WALLET_IDENTITY_REQUIRED_CODE;
}

export function createProductApiClient(options: ProductApiClientOptions = {}): ProductApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? runtimeEnv());
  if (!baseUrl) {
    throw new Error(
      "参与者服务地址未配置：请设置 VITE_UVP_CHAIN_SERVICES_URL。Order App 只连接真实参与者服务，没有本地样例数据回退。"
    );
  }
  return new BrowserProductApiClient({
    baseUrl,
    fetcher: options.fetcher ?? globalThis.fetch.bind(globalThis),
    timeoutMs: options.timeoutMs ?? runtimeTimeoutMs("VITE_UVP_ORDER_APP_FETCH_TIMEOUT_MS") ?? DEFAULT_FETCH_TIMEOUT_MS,
    uploadTimeoutMs: options.uploadTimeoutMs ?? runtimeTimeoutMs("VITE_UVP_ORDER_APP_UPLOAD_TIMEOUT_MS") ?? DEFAULT_UPLOAD_TIMEOUT_MS,
    personalSign: options.personalSign
  });
}

/** 与 zhixu-store 工作台同一超时口径：任一请求挂起不得让页面永久 loading。 */
const DEFAULT_FETCH_TIMEOUT_MS = 6000;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
// 证据上传携带 base64 载荷（上限 10MB），超时单独放宽。
const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;

class BrowserProductApiClient implements ProductApiClient {
  /**
   * 钱包会话 token（proveWalletControl 成功后留存）：所有参与者面请求统一
   * 携带 x-uvp-store-session（与 acceptInvite 的会话通道同款）——非 local
   * 运行时服务端对参与者面读写强制会话锚定，仅 query 自报钱包会 401。
   */
  private walletSessionToken: string | undefined;

  constructor(
    private readonly config: {
      readonly baseUrl: string;
      readonly fetcher: Fetcher;
      readonly timeoutMs: number;
      readonly uploadTimeoutMs: number;
      readonly personalSign?: PersonalSigner | undefined;
    }
  ) {}

  currentSessionToken(): string | undefined {
    return this.walletSessionToken;
  }

  restoreSessionToken(token: string | undefined): boolean {
    const changed = this.walletSessionToken !== token;
    this.walletSessionToken = token;
    return changed;
  }

  async loadParticipantHome(input: ParticipantQueryInput = {}): Promise<ProductHomeData> {
    const [meResponse, ordersResponse, tasksResponse] = await Promise.all([
      // /product/me 的 summary.completedTaskCount 是服务端把 submitted（已
      // 提交、等待链上索引）按已完成口径计入的计数，与客户端"按已提交
      // 如实命名、不冒充完成"的口径不同；summary 因此不作为数据源，只取
      // participant——摘要在本地与待办列表同源（同一 /product/me/tasks
      // 投影）计算，避免两处口径漂移。
      this.getJson<{ readonly participant: ProductParticipantProfileDTO }>(
        participantPath("/product/me", input.walletAddress)
      ),
      this.getJson<{ readonly participant?: ProductParticipantProfileDTO; readonly orders: readonly ProductOrderDTO[] }>(
        participantPath("/product/me/orders", input.walletAddress)
      ),
      this.getJson<{ readonly participant?: ProductParticipantProfileDTO; readonly tasks: readonly ProductTaskDTO[] }>(
        participantPath("/product/me/tasks", input.walletAddress)
      )
    ]);

    const orders = sortOrders(ordersResponse.orders);
    const tasks = sortTasks(tasksResponse.tasks);
    return {
      participant: meResponse.participant,
      summary: summarizeParticipantHome(orders, tasks),
      orders,
      tasks,
      source: {
        kind: "real",
        baseUrl: this.config.baseUrl
      }
    };
  }

  async getOrder(orderId: string): Promise<ProductOrderDTO> {
    const response = await this.getJson<{ readonly order: ProductOrderDTO }>(
      `/product/orders/${encodeURIComponent(orderId)}`
    );
    return response.order;
  }

  async getOrderEscrow(
    orderId: string,
    stageId?: string,
    input: ParticipantQueryInput = {}
  ): Promise<OrderEscrowReadResult> {
    const pathname = participantPath(
      `/product/orders/${encodeURIComponent(orderId)}/escrow${
        stageId === undefined ? "" : `/${encodeURIComponent(stageId)}`
      }`,
      input.walletAddress
    );
    const response = await this.getJson<unknown>(pathname);
    try {
      return stageId === undefined
        ? parseOrderEscrowList(orderId, response)
        : parseOrderEscrowTranche(orderId, response);
    } catch (error) {
      if (error instanceof EscrowReadError) {
        throw new ProductApiError(0, pathname, error.message);
      }
      throw error;
    }
  }

  async getTask(taskId: string, input: ParticipantQueryInput = {}): Promise<ProductTaskDTO> {
    const response = await this.getJson<{ readonly task: ProductTaskDTO }>(
      participantPath(`/product/me/tasks/${encodeURIComponent(taskId)}`, input.walletAddress)
    );
    return response.task;
  }

  async getZhixu(zhixuId: string): Promise<ZhixuDetailDTO> {
    const pathname = `/product/zhixus/${encodeURIComponent(zhixuId)}`;
    const response = await this.getJson<{ readonly zhixu?: ZhixuDetailDTO }>(pathname);
    // fail-closed：详情缺失即畸形响应，不用空对象冒充"没有阶段/角色"。
    if (!response.zhixu || typeof response.zhixu.zhixuId !== "string") {
      throw new ProductApiError(0, pathname, "秩序详情响应缺少 zhixu");
    }
    return response.zhixu;
  }

  async listZhixus(): Promise<readonly ZhixuSummaryDTO[]> {
    const pathname = "/product/zhixus";
    const response = await this.getJson<unknown>(pathname);
    if (!isRecord(response) || !Array.isArray(response.zhixus)) {
      throw new ProductApiError(0, pathname, "秩序目录响应缺少 zhixus");
    }
    // 逐条 fail-closed：缺 zhixuId 的条目不可导航/不可开单，跳过而不是
    // 用占位 id 伪造一条秩序。返回空数组由页面显示"没有已发布秩序"。
    return response.zhixus.filter(
      (item): item is ZhixuSummaryDTO => isRecord(item) && typeof item.zhixuId === "string" && item.zhixuId.trim().length > 0
    );
  }

  async createOrderDraft(input: CreateOrderDraftInput): Promise<ProductOrderDraftDTO> {
    const pathname = "/product/order-drafts";
    const response = await this.postJson<unknown>(pathname, input);
    return requiredDraft(response, pathname);
  }

  async updateOrderDraft(draftId: string, input: UpdateOrderDraftInput): Promise<ProductOrderDraftDTO> {
    const pathname = `/product/order-drafts/${encodeURIComponent(draftId)}`;
    const response = await this.requestJson<unknown>("PATCH", pathname, input, this.config.timeoutMs);
    return requiredDraft(response, pathname);
  }

  async getOrderDraft(draftId: string): Promise<ProductOrderDraftDetailDTO> {
    const pathname = `/product/order-drafts/${encodeURIComponent(draftId)}`;
    const response = await this.getJson<unknown>(pathname);
    const draft = requiredDraft(response, pathname);
    if (!isRecord(response) || !Array.isArray(response.participants)) {
      throw new ProductApiError(0, pathname, "草稿详情响应缺少参与方清单");
    }
    return { draft, participants: response.participants as readonly DraftParticipantDTO[] };
  }

  async getOrderRequirementsBundle(
    draftId: string,
    input: ParticipantQueryInput = {}
  ): Promise<OrderRequirementsReadResult> {
    const pathname = participantPath(
      `/product/order-drafts/${encodeURIComponent(draftId)}/requirements`,
      input.walletAddress
    );
    const response = await this.getJson<unknown>(pathname);
    if (!isRecord(response) || !isRecord(response.bundle)) {
      throw new ProductApiError(0, pathname, "要求包响应缺少 bundle");
    }
    const bundle = response.bundle;
    if (typeof bundle.requirementsHash !== "string" || !HASH_PATTERN.test(bundle.requirementsHash)) {
      throw new ProductApiError(0, pathname, "要求包响应缺少合法的 requirementsHash");
    }
    if (typeof bundle.schemaVersion !== "string" || bundle.schemaVersion.trim().length === 0) {
      throw new ProductApiError(0, pathname, "要求包响应缺少 schemaVersion");
    }
    if (typeof bundle.declaredBy !== "string" || bundle.declaredBy.trim().length === 0) {
      throw new ProductApiError(0, pathname, "要求包响应缺少 declaredBy");
    }
    if (!Array.isArray(bundle.requirements) || !Array.isArray(bundle.presets)) {
      throw new ProductApiError(0, pathname, "要求包响应缺少 requirements/presets");
    }
    if (typeof response.consentMessage !== "string" || response.consentMessage.trim().length === 0) {
      throw new ProductApiError(0, pathname, "要求包响应缺少合意签名消息");
    }
    return {
      bundle: bundle as unknown as OrderRequirementsBundleDTO,
      draft: requiredDraft(response, pathname),
      consentMessage: response.consentMessage,
      editable: response.editable === true,
      ...(isRecord(response.triggerAnchor)
        ? { triggerAnchor: response.triggerAnchor as unknown as OrderRequirementsTriggerAnchorDTO }
        : {})
    };
  }

  async consentOrderRequirements(
    draftId: string,
    input: SubmitOrderRequirementsConsentInput
  ): Promise<OrderRequirementsConsentResultDTO> {
    const pathname = `/product/order-drafts/${encodeURIComponent(draftId)}/requirements/consents`;
    const response = await this.postJson<unknown>(pathname, input);
    if (!isRecord(response) || !isRecord(response.consent) || !Array.isArray(response.consents)) {
      throw new ProductApiError(0, pathname, "合意回执缺少 consent/consents");
    }
    const consent = response.consent;
    for (const field of ["walletAddress", "requirementsHash", "signature", "signedAt"] as const) {
      if (typeof consent[field] !== "string" || consent[field].trim().length === 0) {
        throw new ProductApiError(0, pathname, `合意回执缺少 ${field}`);
      }
    }
    const returnedRequirementsHash = consent.requirementsHash as string;
    if (returnedRequirementsHash.toLowerCase() !== input.requirementsHash.toLowerCase()) {
      throw new ProductApiError(0, pathname, "合意回执的 requirementsHash 与当前要求包不一致");
    }
    if (!isRecord(response.triggerAnchor)) {
      throw new ProductApiError(0, pathname, "合意回执缺少 triggerAnchor");
    }
    return {
      consent: consent as unknown as OrderRequirementsConsentDTO,
      consents: response.consents as readonly OrderRequirementsConsentDTO[],
      triggerAnchor: response.triggerAnchor as unknown as OrderRequirementsTriggerAnchorDTO
    };
  }

  async listOrderDraftParticipants(draftId: string): Promise<readonly DraftParticipantDTO[]> {
    const pathname = `/product/orders/${encodeURIComponent(draftId)}/participants`;
    const response = await this.getJson<unknown>(pathname);
    if (!isRecord(response) || !Array.isArray(response.participants)) {
      throw new ProductApiError(0, pathname, "参与方响应缺少 participants");
    }
    return response.participants as readonly DraftParticipantDTO[];
  }

  async createOrderDraftInvite(draftId: string, input: CreateOrderInviteInput): Promise<ProductOrderInviteCreationDTO> {
    const pathname = `/product/orders/${encodeURIComponent(draftId)}/invites`;
    const response = await this.postJson<unknown>(pathname, input);
    // 一次性明文 token 只随创建响应出现：缺失即畸形响应，不能拿无 token
    // 的邀请链接冒充可用的邀请。
    if (!isRecord(response) || typeof response.inviteToken !== "string" || response.inviteToken.length === 0) {
      throw new ProductApiError(0, pathname, "邀请创建响应缺少一次性邀请凭据");
    }
    if (!isRecord(response.invite)) {
      throw new ProductApiError(0, pathname, "邀请创建响应缺少邀请记录");
    }
    if (typeof response.invite.inviteId !== "string" || response.invite.inviteId.length === 0) {
      throw new ProductApiError(0, pathname, "邀请创建响应缺少邀请编号");
    }
    return {
      invite: response.invite as unknown as ProductOrderInviteDTO,
      draft: requiredDraft(response, pathname),
      inviteToken: response.inviteToken
    };
  }

  async prepareOrderTrigger(
    draftId: string,
    input: { readonly walletAddress: string }
  ): Promise<PreparedOrderTriggerDTO> {
    const pathname = `/product/order-drafts/${encodeURIComponent(draftId)}/prepare-trigger`;
    const response = await this.postJson<unknown>(pathname, input);
    if (!isRecord(response) || !isRecord(response.prepared)) {
      throw new ProductApiError(0, pathname, "开单准备响应缺少签名对象");
    }
    // 签名域交叉核对的独立事实：trigger 记录声明的部署地址必须存在且
    // 形状合法，否则拒绝进入签名（不接受"没有域信息"的盲签）。
    const stateMachineAddress = isRecord(response.trigger) ? response.trigger.stateMachineAddress : undefined;
    if (typeof stateMachineAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(stateMachineAddress)) {
      throw new ProductApiError(0, pathname, "开单准备响应缺少可核对的部署地址");
    }
    const prepared = response.prepared;
    if (typeof prepared.prepareId !== "string" || typeof prepared.submitter !== "string" || !isRecord(prepared.typedData)) {
      throw new ProductApiError(0, pathname, "开单准备响应缺少本次确认的签名材料");
    }
    return {
      ...(prepared as unknown as Omit<PreparedOrderTriggerDTO, "stateMachineAddress">),
      stateMachineAddress
    };
  }

  async triggerOrder(draftId: string, input: TriggerOrderInput): Promise<TriggerOrderResultDTO> {
    const pathname = `/product/order-drafts/${encodeURIComponent(draftId)}/trigger`;
    const response = await this.postJson<unknown>(pathname, input);
    const draft = requiredDraft(response, pathname);
    return {
      draft,
      ...(isRecord(response) && Array.isArray(response.participants)
        ? { participants: response.participants as readonly DraftParticipantDTO[] }
        : {}),
      ...(isRecord(response) && isRecord(response.trigger) ? { trigger: response.trigger } : {})
    };
  }

  async getDecoration(planId: string): Promise<ZhixuDecorationView> {
    const pathname = `/store/decoration/${encodeURIComponent(planId)}`;
    const response = await this.getJson<unknown>(pathname);
    return decorationViewFromResponse(planId, response);
  }
  async previewInvite(inviteId: string, input: ParticipantQueryInput = {}): Promise<ProductInvitePreviewDTO> {
    // 与 accept/reject 同一请求形态：token 是与 accept 同权的一次性凭据，
    // 走 body 而不是 URL query（query 会随 URL/Referer/代理日志留痕）；
    // walletAddress 仍走 query 声明通道，由服务端与会话锚定地址核验。
    return await this.requestJson<ProductInvitePreviewDTO>(
      "POST",
      participantPath(`/product/invites/${encodeURIComponent(inviteId)}`, input.walletAddress),
      { token: input.token },
      this.config.timeoutMs
    );
  }

  async acceptInvite(
    inviteId: string,
    input: AcceptInviteInput,
    options: InviteRequestOptions = {}
  ): Promise<ProductInviteAcceptanceDTO> {
    // 身份双通道（服务端 participant-identity 契约）：x-uvp-store-session
    // 是锚定身份；query walletAddress 是声明值，与会话锚定不一致即 403，
    // local 运行时才允许作为自报身份兜底。
    return await this.requestJson<ProductInviteAcceptanceDTO>(
      "POST",
      participantPath(`/product/invites/${encodeURIComponent(inviteId)}/accept`, input.walletAddress),
      input,
      this.config.timeoutMs,
      options.sessionToken ? { "x-uvp-store-session": options.sessionToken } : {}
    );
  }

  async rejectInvite(inviteId: string, input: RejectInviteInput): Promise<ProductInviteAcceptanceDTO> {
    return await this.postJson<ProductInviteAcceptanceDTO>(`/product/invites/${encodeURIComponent(inviteId)}/reject`, input);
  }

  async proveWalletControl(input: { readonly address: string }): Promise<WalletSessionProof> {
    const signer = this.config.personalSign;
    if (!signer) {
      throw new ProductApiError(
        0,
        "/store/auth/challenge",
        "未配置钱包签名器：接受邀请需要先连接浏览器钱包完成会话签名。"
      );
    }
    const address = input.address.trim();
    if (!/^0x[0-9a-fA-F]{40}$/u.test(address)) {
      throw new ProductApiError(0, "/store/auth/challenge", "钱包地址格式不合法，无法发起会话签名。");
    }
    const challenge = await this.postJson<{
      readonly challenge: { readonly nonce: string; readonly message: string; readonly address: string };
    }>("/store/auth/challenge", { address, intent: "login" });
    const signature = await signer(address, challenge.challenge.message);
    const verified = await this.postJson<{
      readonly token: string;
      readonly session: { readonly anchoredAddress?: string | undefined };
    }>("/store/auth/verify", { nonce: challenge.challenge.nonce, signature });
    // 会话留存：后续 me/tasks/orders/prepare-submit/evidence 请求统一携带；
    // 会话级持久化让刷新后无需重新签名（服务端 TTL 是会话真实有效期，
    // 过期即重新登录）。
    this.walletSessionToken = verified.token;
    persistWalletSessionToken(verified.token);
    return {
      sessionToken: verified.token,
      anchoredAddress: verified.session.anchoredAddress ?? address
    };
  }

  async prepareTaskSubmit(taskId: string, input: PrepareProductTaskSubmitInput): Promise<PreparedTaskSubmitDTO> {
    return await this.postJson<PreparedTaskSubmitDTO>(
      `/product/tasks/${encodeURIComponent(taskId)}/prepare-submit`,
      input
    );
  }

  async submitTask(taskId: string, input: SubmitProductTaskInput): Promise<ProductSubmissionDTO> {
    return await this.postJson<ProductSubmissionDTO>(`/product/tasks/${encodeURIComponent(taskId)}/submit`, input);
  }

  async prepareStageExecutorPatch(
    taskId: string,
    input: PrepareStageExecutorPatchInput
  ): Promise<PreparedStageExecutorPatchDTO> {
    return await this.postJson<PreparedStageExecutorPatchDTO>(
      `/product/tasks/${encodeURIComponent(taskId)}/prepare-stage-executor-patch`,
      input
    );
  }

  async submitStageExecutorPatch(
    taskId: string,
    input: SubmitStageExecutorPatchInput
  ): Promise<StageExecutorPatchSubmissionDTO> {
    return await this.postJson<StageExecutorPatchSubmissionDTO>(
      `/product/tasks/${encodeURIComponent(taskId)}/submit-stage-executor-patch`,
      input
    );
  }

  async prepareStageResourcePatch(
    taskId: string,
    input: PrepareStageResourcePatchInput
  ): Promise<PreparedStageResourcePatchDTO> {
    return await this.postJson<PreparedStageResourcePatchDTO>(
      `/product/tasks/${encodeURIComponent(taskId)}/prepare-stage-resource-patch`,
      input
    );
  }

  async submitStageResourcePatch(
    taskId: string,
    input: SubmitStageResourcePatchInput
  ): Promise<StageResourcePatchSubmissionDTO> {
    return await this.postJson<StageResourcePatchSubmissionDTO>(
      `/product/tasks/${encodeURIComponent(taskId)}/submit-stage-resource-patch`,
      input
    );
  }

  async uploadEvidence(input: CreateEvidenceInput): Promise<EvidenceUploadResponseDTO> {
    return await this.postJson<EvidenceUploadResponseDTO>("/product/evidence", input, this.config.uploadTimeoutMs);
  }

  async getEvidenceProof(evidenceId: string): Promise<EvidenceProofDTO> {
    const response = await this.getJson<{ readonly proof: EvidenceProofDTO }>(
      `/product/evidence/${encodeURIComponent(evidenceId)}/proof`
    );
    return response.proof;
  }

  private async getJson<TResponse>(pathname: string, timeoutMs: number = this.config.timeoutMs): Promise<TResponse> {
    return await this.requestJson<TResponse>("GET", pathname, undefined, timeoutMs);
  }

  private async postJson<TResponse>(pathname: string, body: unknown, timeoutMs: number = this.config.timeoutMs): Promise<TResponse> {
    return await this.requestJson<TResponse>("POST", pathname, body, timeoutMs);
  }

  private async requestJson<TResponse>(
    method: string,
    pathname: string,
    body: unknown,
    timeoutMs: number,
    extraHeaders: Readonly<Record<string, string>> = {}
  ): Promise<TResponse> {
    const signal = AbortSignal.timeout(timeoutMs);
    // 会话头与调用方显式传入的头合并：显式值（如 accept 邀请的新会话）优先。
    const sessionHeaders = this.walletSessionToken
      ? { "x-uvp-store-session": this.walletSessionToken }
      : {};
    let response: Response;
    try {
      response = await withTimeout(this.config.fetcher(joinUrl(this.config.baseUrl, pathname), {
        method,
        headers: {
          "content-type": "application/json",
          ...sessionHeaders,
          ...extraHeaders
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // 禁止跟随重定向（executor-kit 同款）：这些请求携带钱包会话头，
        // 3xx 会让凭据头随重定向重放到 Location 指向的任意主机。
        redirect: "manual",
        signal
      }), signal);
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "TimeoutError")) {
        // 超时=结果未知：服务端可能已处理（对 accept/reject、任务提交这类
        // 一次性动作，盲目重发正是要防的方向），文案不得诱导立即重试。
        throw new ProductApiError(0, pathname, `请求超时（${timeoutMs} 毫秒），服务端可能已处理本次请求。`);
      }
      throw error;
    }
    // manual 模式下浏览器的跨源重定向是 status 0 的 opaqueredirect：与所有
    // 3xx 一样按错误处理（executor-kit isProductApiRedirectStatus 同口径）。
    if (response.status === 0 || (response.status >= 300 && response.status < 400)) {
      throw new ProductApiError(response.status, pathname, `redirect_refused:${response.status}`);
    }
    if (!response.ok) {
      const text = await responseText(response);
      // 服务端错误体是 {error: 短码, message?}：短码进 errorCode 供界面
      // 分支（如钱包会话缺失切换登录入口）；message 提取为用户可读的
      // 错误文案，原始体留 bodyText 供展开核对——原始 JSON 直出给用户
      // 既不可读也不诚实。
      let errorCode: string | undefined;
      let serverMessage: string | undefined;
      try {
        const parsed = JSON.parse(text) as { readonly error?: unknown; readonly message?: unknown };
        if (typeof parsed.error === "string") {
          errorCode = parsed.error;
        }
        if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
          serverMessage = parsed.message;
        }
      } catch {
        // 非 JSON 错误体只有文本可用。
      }
      throw new ProductApiError(
        response.status,
        pathname,
        serverMessage ?? text,
        errorCode,
        serverMessage !== undefined ? text : undefined
      );
    }
    try {
      return await response.json() as TResponse;
    } catch (error) {
      // 2xx 但不是 JSON：归入统一错误链（与 zhixu-store 同口径），而不是
      // 把裸 SyntaxError 直接抛给界面。
      throw new ProductApiError(response.status, pathname, error instanceof Error ? error.message : "response_not_json");
    }
  }
}

/**
 * 真实 fetch 会随 signal 拒绝；注入的 fetcher 可能忽略 signal，
 * 因此以 signal 为准再兜一层超时，保证超时口径不依赖 fetcher 实现。
 */
function withTimeout(promise: Promise<Response>, signal: AbortSignal): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("signal aborted", "TimeoutError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort);
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function summarizeParticipantHome(
  orders: readonly ProductOrderDTO[],
  tasks: readonly ProductTaskDTO[]
): ProductApiSummaryDTO {
  return {
    orderCount: orders.length,
    openTaskCount: tasks.filter((task) => task.status === "open").length,
    blockedTaskCount: tasks.filter((task) => task.status === "blocked").length,
    // submitted 是等待索引的中间态，不是完成（与 taskStatus 口径一致）；
    // 指标按"已提交"如实命名，不冒充已完成。
    submittedTaskCount: tasks.filter((task) => task.status === "submitted").length
  };
}

function sortTasks(tasks: readonly ProductTaskDTO[]): readonly ProductTaskDTO[] {
  // 服务端任务词表只有 open/blocked/submitted；排序口径与 taskStatus 的
  // 展示序一致（可处理 → 受阻 → 等待索引）。
  const statusRank = (status: ProductTaskDTO["status"]): number => {
    switch (status) {
      case "open":
        return 0;
      case "blocked":
        return 1;
      case "submitted":
        return 2;
      default:
        return 3;
    }
  };
  return [...tasks].sort((left, right) =>
    statusRank(left.status) - statusRank(right.status) ||
    // deadline 排序与收件箱/任务状态同一 UTC 解析口径（deadlineSortMs）：
    // localeCompare 的字符串序在混合格式/时区符下与时间序漂移。
    deadlineSortMs(left.deadline) - deadlineSortMs(right.deadline) ||
    left.taskId.localeCompare(right.taskId)
  );
}

function sortOrders(orders: readonly ProductOrderDTO[]): readonly ProductOrderDTO[] {
  const statusRank: Readonly<Record<ProductOrderDTO["status"], number>> = {
    registered: 0
  };
  return [...orders].sort((left, right) =>
    statusRank[left.status] - statusRank[right.status] ||
    left.orderId.localeCompare(right.orderId)
  );
}

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim().replace(/\/+$/u, "");
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

// API 基地址与超时来自构建期注入的静态值（import.meta.env.VITE_X 静态成员
// 访问，Vite 构建时内联）。传入整个 env 对象会把键名查找留在运行期，
// 形成随包分发的环境开关。
function runtimeEnv(): string | undefined {
  return import.meta.env?.VITE_UVP_CHAIN_SERVICES_URL;
}

function runtimeTimeoutMs(name: "VITE_UVP_ORDER_APP_FETCH_TIMEOUT_MS" | "VITE_UVP_ORDER_APP_UPLOAD_TIMEOUT_MS"): number | undefined {
  const raw = name === "VITE_UVP_ORDER_APP_FETCH_TIMEOUT_MS"
    ? import.meta.env?.VITE_UVP_ORDER_APP_FETCH_TIMEOUT_MS
    : import.meta.env?.VITE_UVP_ORDER_APP_UPLOAD_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function responseText(response: Response): Promise<string> {
  const text = await response.text();
  return text.length > 0 ? text : `${response.status} ${response.statusText}`;
}

/**
 * 装修数据响应读取（fail-closed 只在形状层面：顶层必须是对象、versions 必须是
 * 数组）。单个版本/字段不合法即跳过该版本/字段——装修是 Store 展示投影，
 * 不参与权限或状态判定，读坏一条不能让 reader 页整体误报"没有装修数据"：
 * 空版本与请求失败由调用方分别呈现。
 */
function decorationViewFromResponse(planId: string, response: unknown): ZhixuDecorationView {
  if (!isRecord(response)) {
    throw new ProductApiError(0, `/store/decoration/${encodeURIComponent(planId)}`, "装修数据响应不是 JSON 对象");
  }
  if (!Array.isArray(response.versions)) {
    throw new ProductApiError(0, `/store/decoration/${encodeURIComponent(planId)}`, "装修数据响应缺少 versions");
  }
  const versions = response.versions
    .map(decorationVersionFrom)
    .filter((version): version is DecorationVersionView => version !== undefined)
    .sort((left, right) => left.version - right.version);
  const currentVersion = decorationVersionFrom(response.current);
  const current = currentVersion ?? versions[versions.length - 1];
  return {
    planId: typeof response.planId === "string" && response.planId.trim().length > 0 ? response.planId : planId,
    ...(current ? { current } : {}),
    versions
  };
}

function decorationVersionFrom(value: unknown): DecorationVersionView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const version = typeof value.version === "number" && Number.isSafeInteger(value.version) && value.version > 0
    ? value.version
    : undefined;
  const data = decorationDataFrom(value.data);
  if (version === undefined || !data) {
    return undefined;
  }
  return {
    version,
    data,
    ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {})
  };
}

function decorationDataFrom(value: unknown): DecorationDataView | undefined {
  if (!isRecord(value) || value.schemaVersion !== "store-zhixu-decoration.v1") {
    return undefined;
  }
  const theme = decorationThemeFrom(value.theme);
  const taskDeclarations = Array.isArray(value.taskDeclarations)
    ? value.taskDeclarations
        .map(decorationDeclarationFrom)
        .filter((declaration): declaration is DecorationTaskDeclarationView => declaration !== undefined)
    : [];
  return {
    schemaVersion: "store-zhixu-decoration.v1",
    ...(theme ? { theme } : {}),
    ...(taskDeclarations.length > 0 ? { taskDeclarations } : {})
  };
}

function decorationThemeFrom(value: unknown): DecorationThemeView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const displayName = cleanDecorationText(value.displayName);
  const description = cleanDecorationText(value.description);
  const tags = cleanDecorationTextList(value.tags);
  const highlights = cleanDecorationTextList(value.highlights);
  if (!displayName && !description && tags.length === 0 && highlights.length === 0) {
    return undefined;
  }
  return {
    ...(displayName ? { displayName } : {}),
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(highlights.length > 0 ? { highlights } : {})
  };
}

function decorationDeclarationFrom(value: unknown): DecorationTaskDeclarationView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const stageId = cleanDecorationText(value.stageId);
  const taskId = cleanDecorationText(value.taskId);
  const evidenceSpec = Array.isArray(value.evidenceSpec)
    ? value.evidenceSpec
        .map(decorationEvidenceSlotFrom)
        .filter((slot): slot is DecorationEvidenceSlotView => slot !== undefined)
    : [];
  if (!stageId && !taskId) {
    return undefined;
  }
  return {
    ...(stageId ? { stageId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(evidenceSpec.length > 0 ? { evidenceSpec } : {})
  };
}

function decorationEvidenceSlotFrom(value: unknown): DecorationEvidenceSlotView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const key = cleanDecorationText(value.key);
  const label = cleanDecorationText(value.label);
  if (!key || !label) {
    return undefined;
  }
  const inputKind = value.inputKind === "file" || value.inputKind === "text" || value.inputKind === "date"
    ? value.inputKind
    : undefined;
  const accept = cleanDecorationTextList(value.accept);
  const required = typeof value.required === "boolean" ? value.required : undefined;
  const description = cleanDecorationText(value.description);
  return {
    key,
    label,
    ...(inputKind ? { inputKind } : {}),
    ...(accept.length > 0 ? { accept } : {}),
    ...(required !== undefined ? { required } : {}),
    ...(description ? { description } : {})
  };
}

function cleanDecorationText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanDecorationTextList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(cleanDecorationText)
    .filter((item): item is string => item !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 草稿响应的统一形状门：缺 draft/draftId 的 2xx 响应是畸形响应，不是
 * "没有草稿"——按错误上抛，调用方不得拿空对象当已建草稿继续签名。
 */
function requiredDraft(response: unknown, pathname: string): ProductOrderDraftDTO {
  if (!isRecord(response) || !isRecord(response.draft) || typeof response.draft.draftId !== "string") {
    throw new ProductApiError(0, pathname, "响应缺少订单草稿");
  }
  return response.draft as unknown as ProductOrderDraftDTO;
}

