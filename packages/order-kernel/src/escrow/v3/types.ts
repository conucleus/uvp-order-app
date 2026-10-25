// V3 哑托管读面模型：tranche 含 A/B/C、固定分配与状态机；没有时间字段/
// keeper（+T 与裁决事实在 UVP）。金额保持 base units bigint，状态词表单源在
// 本文件，读链上 uint8 时显式映射，词表外状态报错而不是降级。

import type { Address, Hex } from "viem";

export const ESCROW_V3_TRANCHE_STATES = [
  "open",
  "started",
  "preTransfer",
  "preRefund",
  "disputed",
  "settled"
] as const;

export type EscrowV3TrancheState = (typeof ESCROW_V3_TRANCHE_STATES)[number];

export interface EscrowV3DepositTerms {
  readonly orderId: Hex;
  readonly stageId: Hex;
  readonly payer: Address;
  readonly payee: Address;
  readonly verifier: Address;
  readonly amount: bigint;
  readonly feeBps: number;
  readonly feeRecipient: Address;
  readonly deadline: bigint;
  readonly nonce: bigint;
}

export interface EscrowV3Tranche {
  readonly orderId: Hex;
  readonly stageId: Hex;
  readonly payer: Address;
  readonly payee: Address;
  readonly verifier: Address;
  readonly amount: bigint;
  readonly feeBps: number;
  readonly feeRecipient: Address;
  readonly state: EscrowV3TrancheState;
  readonly payerAmount: bigint;
  readonly payeeAmount: bigint;
  readonly instructionRef: Hex;
}

export interface EscrowV3VerdictTerms {
  readonly orderId: Hex;
  readonly stageId: Hex;
  readonly trancheId: Hex;
  readonly approved: boolean;
}

export interface EscrowV3AllocationTerms {
  readonly orderId: Hex;
  readonly stageId: Hex;
  readonly trancheId: Hex;
  readonly payerAmount: bigint;
  readonly payeeAmount: bigint;
}

export interface EscrowV3DisputeTerms {
  readonly orderId: Hex;
  readonly stageId: Hex;
  readonly trancheId: Hex;
}
