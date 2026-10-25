// 端口类型：order-app 只依赖这些结果类型；服务端缺的读面用 not_available
// + 精确 TODO 表达，不用旧 v0 语义补位、不伪造成功。

import type { FlatConfig, FlatStage } from "@uvp-eth/order-kernel/product/kernel";
import type { StageStandardRef } from "@uvp-eth/product-dto";

export type { FlatConfig, FlatStage };

export type FailureKind =
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

export interface Failure {
  readonly kind: FailureKind;
  readonly message: string;
  readonly code?: string | undefined;
  readonly httpStatus?: number | undefined;
  readonly todo?: string | undefined;
  readonly retryable?: boolean | undefined;
}

export type Result<T> = { readonly kind: "ready"; readonly value: T } | Failure;

export interface StageSelection {
  readonly stageKey: string;
  readonly amountBaseUnits: string;
  readonly acceptance?: "self" | "third_party" | "mutual" | "none" | undefined;
  readonly inviteDeadline: string;
  readonly workDeadline: string;
  readonly standardRef?: StageStandardRef | undefined;
}

export interface InviteSelection {
  readonly stageKey: string;
  readonly slotKey: string;
  readonly subjectLabel: string;
  readonly contactRef?: string | undefined;
  readonly wallet?: string | undefined;
}

export interface CreateOrderInput {
  readonly config: FlatConfig;
  readonly title: string;
  readonly stages: readonly StageSelection[];
  readonly invites: readonly InviteSelection[];
}

export interface CreatedInvite {
  readonly inviteId: string;
  readonly inviteToken: string;
  readonly stageKey: string;
  readonly slotKey: string;
  readonly expiresAt: string;
  readonly inviteUrl: string;
}

export interface CreateOrderResult {
  readonly draftId: string;
  readonly stageKeys: readonly string[];
  readonly invites: readonly CreatedInvite[];
}

export const TODOS = {
  configList:
    "服务端没有 GET /product/v3/configs 目录接口：只能按 configId+version 读取（TODO：加目录读面或由运营提供清单）。",
  configPublish: "配置发布（POST /product/v3/configs）不在 order-app：由凝结核/Store 发布并登记 planId/planHash。",
  taskSubmit:
    "任务投影只读；提交面（signal 提交与资金动作）由 executor 与资金安排面板承担，本页不伪造提交入口。",
  evidenceSubmit:
    "证据要求来自配置 fileResources 句柄 + 显式确认信号；上传/绑定入口未就绪（TODO：按句柄 resolver 授权后接证据上传）。"
} as const;

export function isFailure(value: Result<unknown>): value is Failure {
  return (value as { readonly kind?: string }).kind !== "ready";
}
