// 托管读面解析：把 GET /product/orders/:orderId/escrow[/:stageId] 的响应
// 收敛成 OrderEscrowReadResult。形状单源是 uvp-chain-services
// service/src/escrow/types.ts；缺失/畸形字段抛 EscrowReadError（由 API 边界
// 转成 ProductApiError），不用空 tranche 冒充“没有冻款”。

import {
  ESCROW_TRANCHE_STATES,
  type EscrowTrancheDTO,
  type EscrowTrancheState,
  type OrderEscrowReadResult
} from "./types";

export class EscrowReadError extends Error {
  override readonly name = "EscrowReadError";
}

export function parseOrderEscrowList(expectedOrderId: string, body: unknown): OrderEscrowReadResult {
  const record = requireRecord(body, "托管列表响应不是 JSON 对象");
  const returnedOrderId = requireText(record, "orderId", "托管列表响应缺少 orderId");
  if (returnedOrderId.toLowerCase() !== expectedOrderId.toLowerCase()) {
    throw new EscrowReadError("托管列表响应的 orderId 与请求订单不一致");
  }
  if (!Array.isArray(record.tranches)) {
    throw new EscrowReadError("托管列表响应缺少 tranches 数组");
  }
  return {
    orderId: expectedOrderId,
    tranches: record.tranches.map((item, index) =>
      parseEscrowTranche(item, expectedOrderId, `托管列表第 ${index + 1} 条 tranche`)
    )
  };
}

export function parseOrderEscrowTranche(expectedOrderId: string, body: unknown): OrderEscrowReadResult {
  return {
    orderId: expectedOrderId,
    tranches: [parseEscrowTranche(body, expectedOrderId, "单 stage 托管响应")]
  };
}

export function parseEscrowTranche(value: unknown, expectedOrderId: string, context: string): EscrowTrancheDTO {
  const record = requireRecord(value, `${context} 不是 JSON 对象`);
  const trancheId = requireText(record, "trancheId", `${context} 缺少 trancheId`);
  if (!/^0x[0-9a-fA-F]{64}$/u.test(trancheId)) {
    throw new EscrowReadError(`${context} 的 trancheId 不是 bytes32`);
  }
  const orderId = requireText(record, "orderId", `${context} 缺少 orderId`);
  if (orderId.toLowerCase() !== expectedOrderId.toLowerCase()) {
    throw new EscrowReadError(`${context} 的 orderId 与请求订单不一致`);
  }
  const state = requireText(record, "state", `${context} 缺少 state`);
  if (!isEscrowTrancheState(state)) {
    throw new EscrowReadError(`${context} 的 state 不在托管状态词表内：${state}`);
  }
  return {
    orderId,
    stageId: requireText(record, "stageId", `${context} 缺少 stageId`),
    trancheId,
    payer: requireAddress(record, "payer", `${context} 缺少合法 payer`),
    payee: requireAddress(record, "payee", `${context} 缺少合法 payee`),
    verifier: requireAddress(record, "verifier", `${context} 缺少合法 verifier`),
    amount: requireBaseUnits(record, "amount", `${context} 缺少合法 amount`),
    observationDays: requireInteger(record, "observationDays", `${context} 缺少合法 observationDays`),
    feeBps: requireInteger(record, "feeBps", `${context} 缺少合法 feeBps`),
    feeRecipient: requireAddress(record, "feeRecipient", `${context} 缺少合法 feeRecipient`),
    state,
    approvedAt: nullableText(record, "approvedAt", `${context} 的 approvedAt 形状不合法`),
    rejectedAt: nullableText(record, "rejectedAt", `${context} 的 rejectedAt 形状不合法`),
    suspendedAt: nullableText(record, "suspendedAt", `${context} 的 suspendedAt 形状不合法`),
    releaseAt: nullableText(record, "releaseAt", `${context} 的 releaseAt 形状不合法`),
    refundAt: nullableText(record, "refundAt", `${context} 的 refundAt 形状不合法`),
    payerAmount: nullableBaseUnits(record, "payerAmount", `${context} 的 payerAmount 形状不合法`),
    payeeAmount: nullableBaseUnits(record, "payeeAmount", `${context} 的 payeeAmount 形状不合法`),
    feeAmount: nullableBaseUnits(record, "feeAmount", `${context} 的 feeAmount 形状不合法`),
    updatedAt: requireText(record, "updatedAt", `${context} 缺少 updatedAt`),
    blockNumber: requireBaseUnits(record, "blockNumber", `${context} 缺少合法 blockNumber`),
    logIndex: requireInteger(record, "logIndex", `${context} 缺少合法 logIndex`)
  };
}

export function isEscrowTrancheState(value: string): value is EscrowTrancheState {
  return (ESCROW_TRANCHE_STATES as readonly string[]).includes(value);
}

function requireRecord(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EscrowReadError(message);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireText(record: Readonly<Record<string, unknown>>, field: string, message: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new EscrowReadError(message);
  }
  return value;
}

function requireAddress(record: Readonly<Record<string, unknown>>, field: string, message: string): string {
  const value = requireText(record, field, message);
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new EscrowReadError(message);
  }
  return value;
}

function requireBaseUnits(record: Readonly<Record<string, unknown>>, field: string, message: string): string {
  const value = requireText(record, field, message);
  if (!/^\d+$/u.test(value)) {
    throw new EscrowReadError(message);
  }
  return value;
}

function nullableBaseUnits(record: Readonly<Record<string, unknown>>, field: string, message: string): string | null {
  const value = record[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new EscrowReadError(message);
  }
  return value;
}

function nullableText(record: Readonly<Record<string, unknown>>, field: string, message: string): string | null {
  const value = record[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new EscrowReadError(message);
  }
  return value;
}

function requireInteger(record: Readonly<Record<string, unknown>>, field: string, message: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new EscrowReadError(message);
  }
  return value;
}
