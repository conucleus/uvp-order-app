// V3 订单域客户端：逐条对齐 chain-services 的 /product/v3 路由（配置注册、
// 草稿、slot 邀请、EIP-712 接受、finalize、订单/阶段读），身份只经
// x-uvp-store-session 传递；响应形状不符即 invalid_response，不降级成空。

import { ProductV3Error } from "./errors";
import {
  ProductV3Transport,
  DEFAULT_PRODUCT_V3_TIMEOUT_MS,
  invalidResponse,
  requireArray,
  requireRecord,
  requireString
} from "./transport";
import type {
  AcceptStageInviteV3Input,
  AcceptStageInviteV3Result,
  ConfigVersionV3,
  FinalizeOrderDraftV3Input,
  CreateOrderDraftV3Input,
  CreateStageInviteV3Input,
  FinalizeOrderDraftV3Preparation,
  FinalizeOrderDraftV3Result,
  InviteV3,
  OrderDraftDetailV3,
  OrderViewV3,
  PublishConfigV3Input,
  ResourceListViewV3,
  StageViewResponseV3,
  TaskListViewV3,
  ProductV3ClientOptions,
  ProductV3RequestOptions,
  RejectStageInviteV3Input,
  StageInviteCreatedV3,
  StageInvitePreviewV3,
  UpdateOrderDraftV3Input
} from "./types";

const V3_ROOT = "/product/v3";

export interface GetConfigOptions {
  /** 用 /versions/:version 别名路径（服务端两条读路径等价）。 */
  readonly viaVersionsAlias?: boolean | undefined;
}

export interface ProductV3Client {
  publishConfig(input: PublishConfigV3Input, options?: ProductV3RequestOptions): Promise<ConfigVersionV3>;
  publishConfigVersion(configId: string, version: string): Promise<ConfigVersionV3>;
  deprecateConfig(configId: string, version: string): Promise<ConfigVersionV3>;
  getConfig(configId: string, version: string, options?: GetConfigOptions): Promise<ConfigVersionV3>;
  createOrderDraft(input: CreateOrderDraftV3Input, options?: ProductV3RequestOptions): Promise<OrderDraftDetailV3>;
  getOrderDraft(draftId: string): Promise<OrderDraftDetailV3>;
  updateOrderDraft(
    draftId: string,
    input: UpdateOrderDraftV3Input,
    options?: ProductV3RequestOptions
  ): Promise<OrderDraftDetailV3>;
  createInvite(draftId: string, input: CreateStageInviteV3Input): Promise<StageInviteCreatedV3>;
  previewInvite(inviteId: string, token: string): Promise<StageInvitePreviewV3>;
  acceptInvite(
    inviteId: string,
    input: AcceptStageInviteV3Input,
    options?: ProductV3RequestOptions
  ): Promise<AcceptStageInviteV3Result>;
  rejectInvite(
    inviteId: string,
    input: RejectStageInviteV3Input,
    options?: ProductV3RequestOptions
  ): Promise<AcceptStageInviteV3Result>;
  revokeInvite(inviteId: string): Promise<InviteV3>;
  /** finalize 第一步：服务端返回 UVPOrderFinalize typed data 与 funded/skipped 段。 */
  prepareFinalize(draftId: string): Promise<FinalizeOrderDraftV3Preparation>;
  /** finalize 第二步：提交 buyer 对 UVPOrderFinalize 的 EIP-712 签名。 */
  finalizeWithSignature(
    draftId: string,
    input: FinalizeOrderDraftV3Input,
    options?: ProductV3RequestOptions
  ): Promise<FinalizeOrderDraftV3Result>;
  /** 订单读面（服务端按 scope 裁剪；字段随 scope 缺失属正常）。 */
  getOrder(orderId: string): Promise<OrderViewV3>;
  /** 单阶段读面（服务端投影）。 */
  getOrderStage(orderId: string, stageKey: string): Promise<StageViewResponseV3>;
  /** 本单任务投影（服务端派生，不是状态机）。 */
  listTasks(orderId: string): Promise<TaskListViewV3>;
  listStageTasks(orderId: string, stageKey: string): Promise<TaskListViewV3>;
  /** 阶段 fileResources 句柄（无 locator/URI）。 */
  listStageResources(orderId: string, stageKey: string): Promise<ResourceListViewV3>;
  /** 客户端当前会话 token（getSessionToken 注入时返回注入值）。 */
  currentSessionToken(): string | undefined;
  /** 恢复/清除本地会话 token；返回是否真的改变了持有值。 */
  restoreSessionToken(token: string | undefined): boolean;
}

export function createProductV3Client(options: ProductV3ClientOptions = {}): ProductV3Client {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) {
    throw new Error("V3 订单服务地址未配置：未提供 Product V3 baseUrl，kernel 不回退本地样例数据。");
  }
  const transport = new ProductV3Transport({
    baseUrl,
    fetcher: options.fetcher ?? globalThis.fetch.bind(globalThis),
    timeoutMs: options.timeoutMs ?? DEFAULT_PRODUCT_V3_TIMEOUT_MS,
    ...(options.sessionToken !== undefined ? { sessionToken: options.sessionToken } : {}),
    ...(options.getSessionToken !== undefined ? { getSessionToken: options.getSessionToken } : {})
  });

  return {
    async publishConfig(input, requestOptions = {}) {
      const pathname = `${V3_ROOT}/configs`;
      const body = await transport.request<unknown>("POST", pathname, input, requestOptions);
      return configVersionFrom(body, pathname);
    },

    async publishConfigVersion(configId, version) {
      const pathname = `${V3_ROOT}/configs/${segment(configId)}/${segment(version)}/publish`;
      const body = await transport.request<unknown>("POST", pathname, undefined);
      return configVersionFrom(body, pathname);
    },

    async deprecateConfig(configId, version) {
      const pathname = `${V3_ROOT}/configs/${segment(configId)}/${segment(version)}/deprecate`;
      const body = await transport.request<unknown>("POST", pathname, undefined);
      return configVersionFrom(body, pathname);
    },

    async getConfig(configId, version, configOptions = {}) {
      const pathname = configOptions.viaVersionsAlias === true
        ? `${V3_ROOT}/configs/${segment(configId)}/versions/${segment(version)}`
        : `${V3_ROOT}/configs/${segment(configId)}/${segment(version)}`;
      const body = await transport.request<unknown>("GET", pathname, undefined);
      return configVersionFrom(body, pathname);
    },

    async createOrderDraft(input, requestOptions = {}) {
      const pathname = `${V3_ROOT}/order-drafts`;
      const body = await transport.request<unknown>("POST", pathname, input, requestOptions);
      return draftDetailFrom(body, pathname);
    },

    async getOrderDraft(draftId) {
      const pathname = `${V3_ROOT}/order-drafts/${segment(draftId)}`;
      const body = await transport.request<unknown>("GET", pathname, undefined);
      return draftDetailFrom(body, pathname);
    },

    async updateOrderDraft(draftId, input, requestOptions = {}) {
      const pathname = `${V3_ROOT}/order-drafts/${segment(draftId)}`;
      const body = await transport.request<unknown>("PATCH", pathname, input, requestOptions);
      return draftDetailFrom(body, pathname);
    },

    async createInvite(draftId, input) {
      const pathname = `${V3_ROOT}/order-drafts/${segment(draftId)}/invites`;
      const body = await transport.request<unknown>("POST", pathname, input);
      const record = requireRecord(body, pathname, "邀请创建响应不是 JSON 对象");
      requireString(record, "inviteId", pathname, "邀请创建响应缺少 inviteId");
      requireString(record, "inviteToken", pathname, "邀请创建响应缺少一次性 inviteToken");
      return record as unknown as StageInviteCreatedV3;
    },

    async previewInvite(inviteId, token) {
      const pathname = `${V3_ROOT}/invites/${segment(inviteId)}/preview`;
      const body = await transport.request<unknown>("POST", pathname, { token });
      const record = requireRecord(body, pathname, "邀请预览响应不是 JSON 对象");
      requireRecord(record.invite, pathname, "邀请预览响应缺少 invite");
      requireRecord(record.terms, pathname, "邀请预览响应缺少 stage 条款");
      requireRecord(record.typedData, pathname, "邀请预览响应缺少 typedData");
      requireString(record, "termsHash", pathname, "邀请预览响应缺少 termsHash");
      requireString(record, "signNonce", pathname, "邀请预览响应缺少 signNonce");
      requireString(record, "stateMachineAddress", pathname, "邀请预览响应缺少 stateMachineAddress");
      if (typeof record.chainId !== "number" || !Number.isSafeInteger(record.chainId) || record.chainId <= 0) {
        throw invalidResponse(pathname, "邀请预览响应缺少合法 chainId");
      }
      return record as unknown as StageInvitePreviewV3;
    },

    async acceptInvite(inviteId, input, requestOptions = {}) {
      const pathname = `${V3_ROOT}/invites/${segment(inviteId)}/accept`;
      const body = await transport.request<unknown>("POST", pathname, input, requestOptions);
      return acceptanceFrom(body, pathname);
    },

    async rejectInvite(inviteId, input, requestOptions = {}) {
      const pathname = `${V3_ROOT}/invites/${segment(inviteId)}/reject`;
      const body = await transport.request<unknown>("POST", pathname, input, requestOptions);
      return acceptanceFrom(body, pathname);
    },

    async revokeInvite(inviteId) {
      const pathname = `${V3_ROOT}/invites/${segment(inviteId)}/revoke`;
      const body = await transport.request<unknown>("POST", pathname, undefined);
      const record = requireRecord(body, pathname, "撤销邀请响应不是 JSON 对象");
      requireString(record, "inviteId", pathname, "撤销邀请响应缺少 inviteId");
      requireString(record, "status", pathname, "撤销邀请响应缺少 status");
      return record as unknown as InviteV3;
    },

    async prepareFinalize(draftId) {
      const pathname = `${V3_ROOT}/order-drafts/${segment(draftId)}/finalize/prepare`;
      const body = await transport.request<unknown>("POST", pathname, undefined);
      return finalizePreparationFrom(body, pathname);
    },

    async finalizeWithSignature(draftId, input, requestOptions = {}) {
      // finalize 不发送 body；建单授权由 buyer 的 UVPOrderFinalize 签名承载。
      const pathname = `${V3_ROOT}/order-drafts/${segment(draftId)}/finalize`;
      const body = await transport.request<unknown>("POST", pathname, { signature: input.signature }, requestOptions);
      return finalizeResultFrom(body, pathname);
    },


    async getOrder(orderId) {
      const pathname = `${V3_ROOT}/orders/${segment(orderId)}`;
      const body = await transport.request<unknown>("GET", pathname, undefined);
      return orderViewFrom(body, pathname);
    },

    async getOrderStage(orderId, stageKey) {
      const pathname = `${V3_ROOT}/orders/${segment(orderId)}/stages/${segment(stageKey)}`;
      const body = await transport.request<unknown>("GET", pathname, undefined);
      const record = requireRecord(body, pathname, "阶段响应不是 JSON 对象");
      orderViewFrom(record.order, pathname);
      const stage = requireRecord(record.stage, pathname, "阶段响应缺少 stage");
      requireString(stage, "stageKey", pathname, "阶段响应缺少 stage.stageKey");
      requireDataState(record, pathname);
      return record as unknown as StageViewResponseV3;
    },

    async listTasks(orderId) {
      const pathname = `${V3_ROOT}/tasks?orderId=${encodeURIComponent(orderId)}`;
      const body = await transport.request<unknown>("GET", pathname, undefined);
      return taskListFrom(body, pathname);
    },

    async listStageTasks(orderId, stageKey) {
      const pathname = `${V3_ROOT}/orders/${segment(orderId)}/stages/${segment(stageKey)}/tasks`;
      const body = await transport.request<unknown>("GET", pathname, undefined);
      return taskListFrom(body, pathname);
    },

    async listStageResources(orderId, stageKey) {
      const pathname = `${V3_ROOT}/orders/${segment(orderId)}/stages/${segment(stageKey)}/resources`;
      const body = await transport.request<unknown>("GET", pathname, undefined);
      const record = requireRecord(body, pathname, "阶段句柄响应不是 JSON 对象");
      requireString(record, "stageKey", pathname, "阶段句柄响应缺少 stageKey");
      requireArray(record, "items", pathname);
      requireDataState(record, pathname);
      return record as unknown as ResourceListViewV3;
    },

    currentSessionToken() {
      return transport.currentSessionToken();
    },

    restoreSessionToken(token) {
      return transport.restoreSessionToken(token);
    }
  };
}

function configVersionFrom(body: unknown, pathname: string): ConfigVersionV3 {
  const record = requireRecord(body, pathname, "配置版本响应不是 JSON 对象");
  requireString(record, "configId", pathname, "配置版本响应缺少 configId");
  requireString(record, "version", pathname, "配置版本响应缺少 version");
  requireString(record, "status", pathname, "配置版本响应缺少 status");
  requireString(record, "configHash", pathname, "配置版本响应缺少 configHash");
  requireRecord(record.bundle, pathname, "配置版本响应缺少 bundle");
  return record as unknown as ConfigVersionV3;
}

function draftDetailFrom(body: unknown, pathname: string): OrderDraftDetailV3 {
  const record = requireRecord(body, pathname, "草稿响应不是 JSON 对象");
  const draft = requireRecord(record.draft, pathname, "草稿响应缺少 draft");
  requireString(draft, "draftId", pathname, "草稿响应缺少 draftId");
  requireArray(record, "slots", pathname);
  return record as unknown as OrderDraftDetailV3;
}

function acceptanceFrom(body: unknown, pathname: string): AcceptStageInviteV3Result {
  const record = requireRecord(body, pathname, "邀请接受响应不是 JSON 对象");
  const invite = requireRecord(record.invite, pathname, "邀请接受响应缺少 invite");
  requireString(invite, "inviteId", pathname, "邀请接受响应缺少 inviteId");
  requireString(invite, "status", pathname, "邀请接受响应缺少 status");
  const slot = requireRecord(record.slot, pathname, "邀请接受响应缺少 slot");
  requireString(slot, "slotKey", pathname, "邀请接受响应缺少 slotKey");
  requireString(record, "draftStatus", pathname, "邀请接受响应缺少 draftStatus");
  requireString(record, "termsHash", pathname, "邀请接受响应缺少 termsHash");
  return record as unknown as AcceptStageInviteV3Result;
}

function finalizePreparationFrom(body: unknown, pathname: string): FinalizeOrderDraftV3Preparation {
  const record = requireRecord(body, pathname, "finalize prepare 响应不是 JSON 对象");
  for (const field of ["draftId", "planId", "planHash", "termsHash", "payloadHash", "nonce", "deadline"] as const) {
    requireString(record, field, pathname, `finalize prepare 响应缺少 ${field}`);
  }
  requireArray(record, "fundedStageKeys", pathname);
  requireArray(record, "skippedStageKeys", pathname);
  const typedData = requireRecord(record.typedData, pathname, "finalize prepare 响应缺少 typedData");
  if (typedData.primaryType !== "UVPOrderFinalize") {
    throw invalidResponse(pathname, "finalize prepare 的 typedData.primaryType 不是 UVPOrderFinalize");
  }
  return record as unknown as FinalizeOrderDraftV3Preparation;
}

const BIRTH_STATUSES: ReadonlySet<unknown> = new Set(["confirmed", "submitted", "unknown"]);

function finalizeResultFrom(body: unknown, pathname: string): FinalizeOrderDraftV3Result {
  const record = requireRecord(body, pathname, "finalize 响应不是 JSON 对象");
  for (const field of ["draftId", "orderId", "planId", "planHash", "stateMachine"] as const) {
    requireString(record, field, pathname, `finalize 响应缺少 ${field}`);
  }
  if (!BIRTH_STATUSES.has(record.status)) {
    throw invalidResponse(pathname, "finalize 响应的建单状态不是 confirmed/submitted/unknown（不得当作已建单）");
  }
  requireArray(record, "fundedStageKeys", pathname);
  requireArray(record, "skippedStageKeys", pathname);
  return record as unknown as FinalizeOrderDraftV3Result;
}

const DATA_STATES: ReadonlySet<unknown> = new Set(["ok", "none", "pending", "unknown"]);

function requireDataState(record: Readonly<Record<string, unknown>>, pathname: string): void {
  if (!DATA_STATES.has(record.dataState)) {
    throw invalidResponse(pathname, "响应缺少合法的 dataState（ok/none/pending/unknown）");
  }
}

function orderViewFrom(body: unknown, pathname: string): OrderViewV3 {
  const record = requireRecord(body, pathname, "订单响应不是 JSON 对象");
  requireString(record, "orderId", pathname, "订单响应缺少 orderId");
  requireArray(record, "stages", pathname);
  requireDataState(record, pathname);
  return record as unknown as OrderViewV3;
}

function taskListFrom(body: unknown, pathname: string): TaskListViewV3 {
  const record = requireRecord(body, pathname, "任务响应不是 JSON 对象");
  requireArray(record, "items", pathname);
  requireDataState(record, pathname);
  return record as unknown as TaskListViewV3;
}

function segment(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ProductV3Error({
      status: 0,
      endpoint: "",
      kind: "invalid_request",
      message: "路径参数不能为空"
    });
  }
  return encodeURIComponent(trimmed);
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim().replace(/\/+$/u, "");
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
