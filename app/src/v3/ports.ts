// V3 端口实现：把 kernel product/v3 的 transport 错误收敛成宿主可分支的结果；
// 服务端缺的读面返回 not_available + TODO，不用 v0 语义补位。

import {
  buildCreateOrderDraftInput,
  flattenConfigVersion,
  isProductV3Error,
  type ProductV3Client
} from "@uvp-eth/order-kernel/product/v3";
import type {
  FinalizeOrderDraftV3Preparation,
  FinalizeOrderDraftV3Result,
  OrderViewV3,
  ResourceListViewV3,
  StageInvitePreviewV3,
  StageViewResponseV3,
  TaskListViewV3
} from "@uvp-eth/order-kernel/product/v3";
import {
  V3_TODOS,
  type CreateOrderV3Input,
  type CreateOrderV3Result,
  type CreatedInviteV3,
  type FlatConfigV3,
  type V3Failure,
  type V3Result
} from "./types";

export interface V3Ports {
  readonly getConfig: (configId: string, version: string) => Promise<V3Result<FlatConfigV3>>;
  readonly listConfigs: () => Promise<V3Result<readonly never[]>>;
  readonly createOrder: (input: CreateOrderV3Input) => Promise<V3Result<CreateOrderV3Result>>;
  readonly prepareFinalize: (draftId: string) => Promise<V3Result<FinalizeOrderDraftV3Preparation>>;
  readonly finalizeWithSignature: (
    draftId: string,
    signature: string
  ) => Promise<V3Result<FinalizeOrderDraftV3Result>>;
  readonly previewInvite: (inviteId: string, token: string) => Promise<V3Result<StageInvitePreviewV3>>;
  readonly acceptInvite: (
    inviteId: string,
    input: { readonly token: string; readonly signature: string; readonly termsHash: string; readonly nonce: string }
  ) => Promise<V3Result<unknown>>;
  readonly rejectInvite: (inviteId: string, token: string) => Promise<V3Result<unknown>>;
  readonly getOrder: (orderId: string) => Promise<V3Result<OrderViewV3>>;
  readonly getStage: (orderId: string, stageKey: string) => Promise<V3Result<StageViewResponseV3>>;
  readonly listTasks: (orderId: string) => Promise<V3Result<TaskListViewV3>>;
  readonly listStageResources: (orderId: string, stageKey: string) => Promise<V3Result<ResourceListViewV3>>;
}

export function createV3Ports(client: ProductV3Client): V3Ports {
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
      return notAvailable(V3_TODOS.configList);
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
        const invites: CreatedInviteV3[] = [];
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

/** kernel 错误 → 宿主失败分类（kind/code/httpStatus 全部保留，不吞短码）。 */
export function failure(error: unknown): V3Failure {
  if (!isProductV3Error(error)) {
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

export function notAvailable(todo: string): V3Failure {
  return {
    kind: "not_available",
    message: "该 V3 读面尚未就绪；页面不会用旧 v0 语义或样例数据补位。",
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
