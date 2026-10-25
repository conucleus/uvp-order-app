// V3 端口类型：order-app 只依赖这些结果类型；服务端缺的读面用 not_available
// + 精确 TODO 表达，不用旧 v0 语义补位、不伪造成功。

import type { FlatConfigV3, FlatStageV3 } from "@uvp-eth/order-kernel/product/v3";
import type { StageStandardRefV3 } from "@uvp-eth/product-dto";

export type { FlatConfigV3, FlatStageV3 };

export type V3FailureKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "gone"
  | "invalid"
  | "unavailable"
  | "timeout"
  | "transport"
  | "redirect_refused"
  | "invalid_response"
  | "not_available"
  | "unknown";

export interface V3Failure {
  readonly kind: V3FailureKind;
  readonly message: string;
  readonly code?: string | undefined;
  readonly httpStatus?: number | undefined;
  readonly todo?: string | undefined;
  readonly retryable?: boolean | undefined;
}

export type V3Result<T> = { readonly kind: "ready"; readonly value: T } | V3Failure;

export interface StageSelectionV3 {
  readonly stageKey: string;
  readonly amountBaseUnits: string;
  readonly acceptance?: "self" | "third_party" | "mutual" | "none" | undefined;
  readonly inviteDeadline: string;
  readonly workDeadline: string;
  readonly standardRef?: StageStandardRefV3 | undefined;
}

export interface InviteSelectionV3 {
  readonly stageKey: string;
  readonly slotKey: string;
  readonly subjectLabel: string;
  readonly contactRef?: string | undefined;
  readonly wallet?: string | undefined;
}

export interface CreateOrderV3Input {
  readonly config: FlatConfigV3;
  readonly title: string;
  readonly stages: readonly StageSelectionV3[];
  readonly invites: readonly InviteSelectionV3[];
}

export interface CreatedInviteV3 {
  readonly inviteId: string;
  readonly inviteToken: string;
  readonly stageKey: string;
  readonly slotKey: string;
  readonly expiresAt: string;
  readonly inviteUrl: string;
}

export interface CreateOrderV3Result {
  readonly draftId: string;
  readonly stageKeys: readonly string[];
  readonly invites: readonly CreatedInviteV3[];
}

export const V3_TODOS = {
  configList:
    "服务端没有 GET /product/v3/configs 目录接口：只能按 configId+version 读取（TODO：加目录读面或由运营提供清单）。",
  configPublish: "配置发布（POST /product/v3/configs）不在 order-app：由凝结核/Store 发布并登记 planId/planHash。",
  taskSubmit:
    "V3 任务投影只读；提交面（signal 提交 / deposit / settle）由 V3 executor 与托管面板承担，本页不伪造提交入口。",
  evidenceSubmit:
    "V3 证据要求来自配置 fileResources 句柄 + 显式验收信号；上传/绑定入口未就绪（TODO：按句柄 resolver 授权后接证据上传）。"
} as const;

export function isV3Failure(value: V3Result<unknown>): value is V3Failure {
  return (value as { readonly kind?: string }).kind !== "ready";
}
