import {
  type ChainProofRowDTO,
  type ProductExecutorPatchMode,
  type ProductOrderDTO,
  type ProductParticipantProfileDTO,
  type ProductTaskDTO
} from "@uvp-eth/product-dto";
import type { ProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";

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
  readonly completedTaskCount: number;
}

export interface ProductHomeData {
  readonly participant: ProductParticipantProfileDTO;
  readonly summary: ProductApiSummaryDTO;
  readonly orders: readonly ProductOrderDTO[];
  readonly tasks: readonly ProductTaskDTO[];
  readonly source: ProductApiSource;
}

export interface ProductApiClient {
  loadParticipantHome(input?: ParticipantQueryInput): Promise<ProductHomeData>;
  getOrder(orderId: string): Promise<ProductOrderDTO>;
  getTask(taskId: string, input?: ParticipantQueryInput): Promise<ProductTaskDTO>;
  previewInvite(inviteId: string, input?: ParticipantQueryInput): Promise<ProductInvitePreviewDTO>;
  acceptInvite(inviteId: string, input: AcceptInviteInput): Promise<ProductInviteAcceptanceDTO>;
  rejectInvite(inviteId: string, input?: RejectInviteInput): Promise<ProductInviteAcceptanceDTO>;
  prepareTaskSubmit(taskId: string, input: PrepareTaskSubmitInput): Promise<PreparedTaskSubmitDTO>;
  submitTask(taskId: string, input: SubmitTaskInput): Promise<ProductSubmissionDTO>;
  prepareStageExecutorPatch(taskId: string, input: PrepareStageExecutorPatchInput): Promise<PreparedStageExecutorPatchDTO>;
  submitStageExecutorPatch(taskId: string, input: SubmitStageExecutorPatchInput): Promise<StageExecutorPatchSubmissionDTO>;
  prepareStageResourcePatch(taskId: string, input: PrepareStageResourcePatchInput): Promise<PreparedStageResourcePatchDTO>;
  submitStageResourcePatch(taskId: string, input: SubmitStageResourcePatchInput): Promise<StageResourcePatchSubmissionDTO>;
  uploadEvidence(input: CreateEvidenceInput): Promise<EvidenceUploadResponseDTO>;
  getEvidenceProof(evidenceId: string): Promise<EvidenceProofDTO>;
}

export interface ParticipantQueryInput {
  readonly walletAddress?: string | undefined;
}

export interface ProductApiClientOptions {
  readonly baseUrl?: string | undefined;
  readonly fetcher?: Fetcher | undefined;
  /** 单个请求的超时毫秒数；默认对齐 store 工作台 6s 口径。 */
  readonly timeoutMs?: number | undefined;
  /** 证据上传等大载荷请求的超时毫秒数；默认 60s。 */
  readonly uploadTimeoutMs?: number | undefined;
}

export interface AcceptInviteInput {
  readonly displayName: string;
  readonly walletAddress: string;
  readonly contact: string;
}

export interface RejectInviteInput {
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

export type ProductSubmitIntent = "confirm_stage" | "reject_stage" | "raise_dispute" | "resolve_dispute";
export type ProductStageExecutorPatchMode = ProductExecutorPatchMode | "replace";

export interface PrepareTaskSubmitInput {
  readonly evidenceIds: readonly string[];
  readonly walletAddress: string;
  readonly intent: ProductSubmitIntent;
}

export interface SubmitTaskInput {
  readonly prepareId: string;
  readonly signature: string;
  readonly walletAddress: string;
}

export interface PrepareStageExecutorPatchInput {
  readonly selectorWallet: string;
  readonly targetStageId: string;
  readonly executorWallet: string;
  readonly executorMetadataHash: Hex | string;
  readonly metadataURI: string;
  readonly mode?: ProductStageExecutorPatchMode | undefined;
  readonly previousExecutorWallet?: string | undefined;
  readonly approval?: unknown | undefined;
  readonly executorReference?: string | undefined;
}

export interface SubmitStageExecutorPatchInput {
  readonly prepareId?: string | undefined;
  readonly selectorWallet: string;
  readonly typedData?: Eip712TypedDataDTO | undefined;
  readonly signature: string;
  readonly patch?: PreparedStageExecutorPatchDTO | undefined;
  readonly mode?: ProductStageExecutorPatchMode | undefined;
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

export type ProductSubmissionStatus =
  | "prepared"
  | "signature_received"
  | "broadcasting"
  | "submitted"
  | "indexing"
  | "confirmed"
  | "failed"
  | "expired"
  | "replaced";

export interface ProductSubmissionDTO {
  readonly submissionId: string;
  readonly prepareId: string;
  readonly taskId: string;
  readonly orderId: string;
  readonly status: ProductSubmissionStatus;
  readonly txHash?: Hex;
  readonly blockNumber?: string;
  readonly errorCode?: string;
  readonly retryable: boolean;
  readonly proofRows: readonly ChainProofRowDTO[];
}

export interface PreparedStageExecutorPatchDTO {
  readonly prepareId: string;
  readonly orderId: string;
  readonly selectorTaskId?: string;
  readonly taskId?: string;
  readonly targetStageId: string;
  readonly mode?: ProductExecutorPatchMode;
  readonly previousExecutor?: string;
  readonly approvalSourceId?: string;
  readonly approvalSignalId?: string;
  readonly patchHash: Hex;
  readonly expiresAt?: string;
  readonly typedData: Eip712TypedDataDTO;
  readonly humanSummary?: {
    readonly purpose?: string;
    readonly taskTitle?: string;
    readonly targetStage?: string;
    readonly action?: string;
    readonly validUntil?: string;
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
  readonly approvalSourceId?: string;
  readonly approvalSignalId?: string;
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

export interface EvidenceProofDTO {
  readonly evidenceId?: string;
  readonly payloadHash: Hex;
  readonly contentHash: Hex;
  readonly metadataHash: Hex;
  readonly payloadRef?: string;
  readonly boundSignalTxHash?: Hex;
  readonly blockNumber?: string;
  readonly submitter?: string;
  readonly verificationStatus: "unbound" | "matched" | "mismatch" | "missing_file";
}

export class ProductApiError extends Error {
  override readonly name = "ProductApiError";

  constructor(
    readonly status: number,
    readonly endpoint: string,
    message: string
  ) {
    super(message);
  }
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
    uploadTimeoutMs: options.uploadTimeoutMs ?? runtimeTimeoutMs("VITE_UVP_ORDER_APP_UPLOAD_TIMEOUT_MS") ?? DEFAULT_UPLOAD_TIMEOUT_MS
  });
}

/** 与 zhixu-store 工作台同一超时口径：任一请求挂起不得让页面永久 loading。 */
const DEFAULT_FETCH_TIMEOUT_MS = 6000;
// 证据上传携带 base64 载荷（上限 10MB），超时单独放宽。
const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;

class BrowserProductApiClient implements ProductApiClient {
  constructor(
    private readonly config: {
      readonly baseUrl: string;
      readonly fetcher: Fetcher;
      readonly timeoutMs: number;
      readonly uploadTimeoutMs: number;
    }
  ) {}

  async loadParticipantHome(input: ParticipantQueryInput = {}): Promise<ProductHomeData> {
    const [meResponse, ordersResponse, tasksResponse] = await Promise.all([
      this.getJson<{ readonly participant: ProductParticipantProfileDTO; readonly summary?: ProductApiSummaryDTO }>(
        participantPath("/product/me", input)
      ),
      this.getJson<{ readonly participant?: ProductParticipantProfileDTO; readonly orders: readonly ProductOrderDTO[] }>(
        participantPath("/product/me/orders", input)
      ),
      this.getJson<{ readonly participant?: ProductParticipantProfileDTO; readonly tasks: readonly ProductTaskDTO[] }>(
        participantPath("/product/me/tasks", input)
      )
    ]);

    const orders = sortOrders(ordersResponse.orders);
    const tasks = sortTasks(tasksResponse.tasks);
    return {
      participant: meResponse.participant,
      summary: meResponse.summary ?? summarizeParticipantHome(orders, tasks),
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

  async getTask(taskId: string, input: ParticipantQueryInput = {}): Promise<ProductTaskDTO> {
    const response = await this.getJson<{ readonly task: ProductTaskDTO }>(
      participantPath(`/product/me/tasks/${encodeURIComponent(taskId)}`, input)
    );
    return response.task;
  }

  async previewInvite(inviteId: string, input: ParticipantQueryInput = {}): Promise<ProductInvitePreviewDTO> {
    return await this.getJson<ProductInvitePreviewDTO>(
      participantPath(`/product/invites/${encodeURIComponent(inviteId)}`, input)
    );
  }

  async acceptInvite(inviteId: string, input: AcceptInviteInput): Promise<ProductInviteAcceptanceDTO> {
    return await this.postJson<ProductInviteAcceptanceDTO>(`/product/invites/${encodeURIComponent(inviteId)}/accept`, input);
  }

  async rejectInvite(inviteId: string, input: RejectInviteInput = {}): Promise<ProductInviteAcceptanceDTO> {
    return await this.postJson<ProductInviteAcceptanceDTO>(`/product/invites/${encodeURIComponent(inviteId)}/reject`, input);
  }

  async prepareTaskSubmit(taskId: string, input: PrepareTaskSubmitInput): Promise<PreparedTaskSubmitDTO> {
    return await this.postJson<PreparedTaskSubmitDTO>(
      `/product/tasks/${encodeURIComponent(taskId)}/prepare-submit`,
      input
    );
  }

  async submitTask(taskId: string, input: SubmitTaskInput): Promise<ProductSubmissionDTO> {
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

  private async requestJson<TResponse>(method: string, pathname: string, body: unknown, timeoutMs: number): Promise<TResponse> {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await withTimeout(this.config.fetcher(joinUrl(this.config.baseUrl, pathname), {
        method,
        headers: {
          "content-type": "application/json"
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal
      }), signal);
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "TimeoutError")) {
        throw new ProductApiError(0, pathname, `请求超时（${timeoutMs} 毫秒），请稍后重试。`);
      }
      throw error;
    }
    if (!response.ok) {
      throw new ProductApiError(response.status, pathname, await responseText(response));
    }
    return await response.json() as TResponse;
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
    // submitted 是等待索引的中间态，不计入已完成（与 taskStatus 口径一致）。
    completedTaskCount: tasks.filter((task) => task.status === "done").length
  };
}

function sortTasks(tasks: readonly ProductTaskDTO[]): readonly ProductTaskDTO[] {
  const statusRank: Readonly<Record<ProductTaskDTO["status"], number>> = {
    open: 0,
    blocked: 1,
    submitted: 2,
    done: 3
  };
  return [...tasks].sort((left, right) =>
    statusRank[left.status] - statusRank[right.status] ||
    left.deadline.localeCompare(right.deadline) ||
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

function participantPath(pathname: string, input: ParticipantQueryInput): string {
  if (!input.walletAddress) {
    return pathname;
  }
  const query = new URLSearchParams({ walletAddress: input.walletAddress });
  return `${pathname}?${query.toString()}`;
}

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim().replace(/\/+$/u, "");
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function runtimeEnv(): string | undefined {
  const env = import.meta.env as Readonly<Record<string, string | undefined>> | undefined;
  return env?.VITE_UVP_CHAIN_SERVICES_URL;
}

function runtimeTimeoutMs(name: string): number | undefined {
  const env = import.meta.env as Readonly<Record<string, string | undefined>> | undefined;
  const raw = env?.[name];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function responseText(response: Response): Promise<string> {
  const text = await response.text();
  return text.length > 0 ? text : `${response.status} ${response.statusText}`;
}
