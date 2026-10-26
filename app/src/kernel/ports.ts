// 端口实现：把 uvp-client/browser 的 transport 错误收敛成宿主可分支的结果；
// 服务端缺的读面返回 not_available + TODO，不用 v0 语义补位。

import {
  buildCreateOrderDraftInput,
  flattenConfigVersion,
  isProductError,
  type ProductClient
} from "@uvp-eth/uvp-client/browser";
import type {
  FinalizeOrderDraftPreparation,
  FinalizeOrderDraftResult,
  OrderView,
  ResourceListView,
  StageInvitePreview,
  StageViewResponse,
  TaskListView
} from "@uvp-eth/uvp-client/browser";
import {
  TODOS,
  type CreateOrderInput,
  type CreateOrderResult,
  type CreatedInvite,
  type FlatConfig,
  type Failure,
  type Result
} from "./types";

export interface Ports {
  readonly getConfig: (configId: string, version: string) => Promise<Result<FlatConfig>>;
  readonly listConfigs: () => Promise<Result<readonly never[]>>;
  readonly createOrder: (input: CreateOrderInput) => Promise<Result<CreateOrderResult>>;
  readonly prepareFinalize: (draftId: string) => Promise<Result<FinalizeOrderDraftPreparation>>;
  readonly finalizeWithSignature: (
    draftId: string,
    signature: string
  ) => Promise<Result<FinalizeOrderDraftResult>>;
  readonly previewInvite: (inviteId: string, token: string) => Promise<Result<StageInvitePreview>>;
  readonly acceptInvite: (
    inviteId: string,
    input: { readonly token: string; readonly signature: string; readonly termsHash: string; readonly nonce: string }
  ) => Promise<Result<unknown>>;
  readonly rejectInvite: (inviteId: string, token: string) => Promise<Result<unknown>>;
  readonly getOrder: (orderId: string) => Promise<Result<OrderView>>;
  readonly getStage: (orderId: string, stageKey: string) => Promise<Result<StageViewResponse>>;
  readonly listTasks: (orderId: string) => Promise<Result<TaskListView>>;
  readonly listStageResources: (orderId: string, stageKey: string) => Promise<Result<ResourceListView>>;
}

export function createPorts(client: ProductClient): Ports {
  return {
    async getConfig(configId, version) {
      try {
        const config = await client.getConfig(configId, version);
        return { kind: "ready", value: flattenConfigVersion(config) };
      } catch (error) {
        return failure(error);
      }
    },

    async listConfigs() {
      return notAvailable(TODOS.configList);
    },

    async createOrder(input) {
      const mapped = buildCreateOrderDraftInput({
        config: input.config,
        title: input.title,
        stages: input.stages,
        currency: input.config.currency
      });
      if (!mapped.ok) {
        return {
          kind: "invalid",
          code: mapped.problem.code,
          message: mapped.problem.message
        };
      }
      try {
        const detail = await client.createOrderDraft(mapped.value, { idempotencyKey: cryptoRandomId() });
        const invites: CreatedInvite[] = [];
        for (const invite of input.invites) {
          const created = await client.createInvite(detail.draft.draftId, {
            stageKey: invite.stageKey,
            slotKey: invite.slotKey,
            subjectLabel: invite.subjectLabel,
            ...(invite.contactRef !== undefined ? { contactRef: invite.contactRef } : {}),
            ...(invite.wallet !== undefined ? { wallet: invite.wallet } : {})
          });
          invites.push({
            inviteId: created.inviteId,
            inviteToken: created.inviteToken,
            stageKey: created.stageKey,
            slotKey: created.slotKey,
            expiresAt: created.expiresAt,
            inviteUrl: buildInviteUrl(created.inviteId, created.inviteToken)
          });
        }
        return {
          kind: "ready",
          value: { draftId: detail.draft.draftId, stageKeys: detail.draft.stageSubset, invites }
        };
      } catch (error) {
        return failure(error);
      }
    },

    async prepareFinalize(draftId) {
      try {
        return { kind: "ready", value: await client.prepareFinalize(draftId) };
      } catch (error) {
        return failure(error);
      }
    },

    async finalizeWithSignature(draftId, signature) {
      try {
        return { kind: "ready", value: await client.finalizeWithSignature(draftId, { signature }, { idempotencyKey: cryptoRandomId() }) };
      } catch (error) {
        return failure(error);
      }
    },

    async previewInvite(inviteId, token) {
      try {
        return { kind: "ready", value: await client.previewInvite(inviteId, token) };
      } catch (error) {
        return failure(error);
      }
    },

    async acceptInvite(inviteId, input) {
      try {
        return { kind: "ready", value: await client.acceptInvite(inviteId, input, { idempotencyKey: cryptoRandomId() }) };
      } catch (error) {
        return failure(error);
      }
    },

    async rejectInvite(inviteId, token) {
      try {
        return { kind: "ready", value: await client.rejectInvite(inviteId, { token }, { idempotencyKey: cryptoRandomId() }) };
      } catch (error) {
        return failure(error);
      }
    },

    async getOrder(orderId) {
      try {
        return { kind: "ready", value: await client.getOrder(orderId) };
      } catch (error) {
        return failure(error);
      }
    },

    async getStage(orderId, stageKey) {
      try {
        return { kind: "ready", value: await client.getOrderStage(orderId, stageKey) };
      } catch (error) {
        return failure(error);
      }
    },

    async listTasks(orderId) {
      try {
        return { kind: "ready", value: await client.listTasks(orderId) };
      } catch (error) {
        return failure(error);
      }
    },

    async listStageResources(orderId, stageKey) {
      try {
        return { kind: "ready", value: await client.listStageResources(orderId, stageKey) };
      } catch (error) {
        return failure(error);
      }
    }
  };
}

export function failure(error: unknown): Failure {
  if (!isProductError(error)) {
    return {
      kind: "unknown",
      message: error instanceof Error ? error.message : String(error)
    };
  }
  return {
    kind: error.kind === "invalid_terms" || error.kind === "invalid_request"
      ? "invalid"
      : error.kind,
    message: error.message,
    ...(error.errorCode !== undefined ? { code: error.errorCode } : {}),
    ...(error.status > 0 ? { httpStatus: error.status } : {}),
    retryable: error.retryable
  };
}

export function notAvailable(todo: string): Failure {
  return {
    kind: "not_available",
    message: "该读面尚未就绪；页面不会用旧 v0 语义或样例数据补位。",
    todo
  };
}

function buildInviteUrl(inviteId: string, inviteToken: string): string {
  const base = typeof window === "undefined" ? "http://localhost/" : window.location.href;
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.searchParams.set("invite", inviteId);
  url.searchParams.set("inviteToken", inviteToken);
  return url.toString();
}

function cryptoRandomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
