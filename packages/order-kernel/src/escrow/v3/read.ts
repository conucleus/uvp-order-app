// V3 托管读面：getTranche 返回的 tranche 视图解码为 EscrowV3Tranche，
// 包括 A/B/C、状态机与固定分配。视图字段单源是 StageEscrowV3.sol；畸形/
// 词表外状态显式抛错，不用空 tranche 或默认状态冒充“没有冻款”。

import { decodeFunctionResult, type Address, type Hex, type PublicClient } from "viem";
import { STAGE_ESCROW_V3_ABI } from "./abi";
import {
  ESCROW_V3_TRANCHE_STATES,
  type EscrowV3Tranche,
  type EscrowV3TrancheState
} from "./types";

export class EscrowV3ReadError extends Error {
  override readonly name = "EscrowV3ReadError";
}

export function parseTrancheResult(value: unknown): EscrowV3Tranche {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EscrowV3ReadError("tranche 视图响应不是对象");
  }
  const record = value as Readonly<Record<string, unknown>>;
  return {
    orderId: requireBytes32(record, "orderId"),
    stageId: requireBytes32(record, "stageId"),
    payer: requireAddress(record, "payer"),
    payee: requireAddress(record, "payee"),
    verifier: requireAddress(record, "verifier"),
    amount: requireBigInt(record, "amount"),
    feeBps: requireUint16(record, "feeBps"),
    feeRecipient: requireAddress(record, "feeRecipient"),
    state: requireState(record, "state"),
    payerAmount: requireBigInt(record, "payerAmount"),
    payeeAmount: requireBigInt(record, "payeeAmount"),
    instructionRef: requireBytes32(record, "instructionRef")
  };
}

export function decodeTrancheReturn(data: Hex): EscrowV3Tranche {
  return parseTrancheResult(
    decodeFunctionResult({ abi: STAGE_ESCROW_V3_ABI, functionName: "getTranche", data })
  );
}

export async function readTranche(
  client: PublicClient,
  escrow: Address,
  trancheId: Hex
): Promise<EscrowV3Tranche> {
  const raw = await client.readContract({
    address: escrow,
    abi: STAGE_ESCROW_V3_ABI,
    functionName: "getTranche",
    args: [trancheId]
  });
  return parseTrancheResult(raw);
}

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;

function requireBytes32(record: Readonly<Record<string, unknown>>, field: string): Hex {
  const value = record[field];
  if (typeof value !== "string" || !BYTES32_PATTERN.test(value)) {
    throw new EscrowV3ReadError(`tranche 视图的 ${field} 不是 bytes32`);
  }
  return value as Hex;
}

function requireAddress(record: Readonly<Record<string, unknown>>, field: string): Address {
  const value = record[field];
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    throw new EscrowV3ReadError(`tranche 视图的 ${field} 不是地址`);
  }
  return value as Address;
}

function requireBigInt(record: Readonly<Record<string, unknown>>, field: string): bigint {
  const value = record[field];
  if (typeof value !== "bigint" || value < 0n) {
    throw new EscrowV3ReadError(`tranche 视图的 ${field} 不是非负整数`);
  }
  return value;
}

function requireUint16(record: Readonly<Record<string, unknown>>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 65535) {
    throw new EscrowV3ReadError(`tranche 视图的 ${field} 不是 uint16`);
  }
  return value;
}

function requireState(record: Readonly<Record<string, unknown>>, field: string): EscrowV3TrancheState {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new EscrowV3ReadError(`tranche 视图的 ${field} 不是状态枚举`);
  }
  const state = ESCROW_V3_TRANCHE_STATES[value - 1];
  if (!state) {
    throw new EscrowV3ReadError(`tranche 视图的 ${field} 不在 V3 状态词表内：${value}`);
  }
  return state;
}
