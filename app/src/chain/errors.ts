// 自定义合约错误解码：从 viem/provider 错误链上取 revert data，交给
// @uvp-eth/uvp-client/core 的 ABI 单源 decodeEngineRevert；解不出就返回
// undefined，不按文案猜错误名，也不伪造成功。

import { BaseError, type Hex } from "viem";
import { decodeEngineRevert } from "@uvp-eth/uvp-client/core";

export interface DecodedContractError {
  readonly errorName: string;
  readonly args?: readonly unknown[] | undefined;
}

export function revertDataOf(error: unknown): Hex | undefined {
  if (error instanceof BaseError) {
    const found = error.walk((current) => dataHexOf(current) !== undefined);
    const data = found === undefined ? undefined : dataHexOf(found);
    if (data !== undefined) {
      return data;
    }
  }
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth += 1) {
    const data = dataHexOf(current);
    if (data !== undefined) {
      return data;
    }
    if (current instanceof Error) {
      current = current.cause;
      continue;
    }
    break;
  }
  const message = error instanceof Error ? error.message : "";
  const match = /(?:data|revertData)["'\s:=]+(0x[0-9a-fA-F]+)/u.exec(message);
  return match?.[1] === undefined ? undefined : (match[1] as Hex);
}

export function decodeContractError(error: unknown): DecodedContractError | undefined {
  const data = revertDataOf(error);
  if (data === undefined) {
    return undefined;
  }
  const decoded = decodeEngineRevert(data);
  if (decoded === undefined) {
    return undefined;
  }
  return { errorName: decoded.errorName, args: decoded.args };
}

export function formatDecodedContractError(decoded: DecodedContractError): string {
  const args = decoded.args ?? [];
  switch (decoded.errorName) {
    case "DuplicateTriggerKey":
      return `该 submitter 与 idempotencyKey 已出生过订单 orderId=${formatArg(args[2])}（DuplicateTriggerKey）`;
    case "SignalAlreadyExists":
      return "同一 sourceId / signalId 的事实已经存在（SignalAlreadyExists）";
    case "StageSupplierNotAssigned":
      return `该阶段没有指派 supplier（StageSupplierNotAssigned，stage=${formatArg(args[1])}）`;
    case "PlanAlreadyRegistered":
      return "该 planId 已经 commitPlan（PlanAlreadyRegistered）";
    case "PlanAlreadyFinalized":
      return "该 planId 已经 finalizePlan（PlanAlreadyFinalized）";
    case "PlanNotCommitted":
      return "该 planId 还没有 commitPlan（PlanNotCommitted）";
    case "PlanNotFinalized":
      return "该 planId 还没有 finalizePlan（PlanNotFinalized）";
    default:
      return args.length === 0
        ? decoded.errorName
        : `${decoded.errorName}(${args.map(formatArg).join(", ")})`;
  }
}

function dataHexOf(value: unknown): Hex | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const data = (value as { readonly data?: unknown }).data;
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]*$/u.test(data) || data.length < 10) {
    return undefined;
  }
  return data as Hex;
}

function formatArg(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}
