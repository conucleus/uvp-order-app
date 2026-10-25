// StageEscrowV3 binding read model (client mirror of
// uvp-chain-services src/binding/types.ts). Amounts stay base-unit strings and
// tranche identity is payer-scoped: trancheId = keccak(orderId, stageId, payer).

export const TRANCHE_BINDING_STATES = ["bound", "settled", "mismatch", "foreign"] as const;
export type TrancheBindingState = (typeof TRANCHE_BINDING_STATES)[number];

export const BINDING_DATA_STATES = ["ok", "pending", "none"] as const;
export type BindingDataState = (typeof BINDING_DATA_STATES)[number];

export const SETTLEMENT_INSTRUCTION_STATUSES = [
  "unsigned",
  "partially_signed",
  "ready",
  "execute_ready",
  "submitted",
  "confirmed",
  "failed",
  "unknown"
] as const;
export type SettlementInstructionStatus = (typeof SETTLEMENT_INSTRUCTION_STATUSES)[number];

export const SETTLEMENT_INSTRUCTION_KINDS = [
  "start",
  "refund_before_start",
  "verdict_approve",
  "verdict_reject",
  "execute_transfer",
  "execute_refund",
  "refund_after_start",
  "dispute",
  "resolve_dispute"
] as const;
export const INSTRUCTION_SIGNER_ROLES = ["payer", "payee", "verifier"] as const;
export type InstructionSignerRole = (typeof INSTRUCTION_SIGNER_ROLES)[number];
export type SettlementInstructionKind = (typeof SETTLEMENT_INSTRUCTION_KINDS)[number];

export interface TrancheBindingDTO {
  readonly bindingId: string;
  readonly orderId: string;
  readonly stageKey: string;
  readonly stageId: string;
  readonly trancheId: string;
  readonly chainId: number;
  readonly escrowAddress: string;
  readonly state: TrancheBindingState;
  readonly origin: "intent" | "event_only";
  readonly payer?: string;
  readonly payee?: string;
  readonly amount?: string;
  readonly feeBps?: number;
  readonly feeRecipient?: string;
  readonly depositTxHash?: string;
  readonly depositBlock?: string;
  readonly payerAmount?: string;
  readonly payeeAmount?: string;
  readonly feeAmount?: string;
  readonly settledTxHash?: string;
  readonly instructionRef?: string;
  readonly updatedAt: string;
}

export interface OrderBindingsReadResult {
  readonly orderId: string;
  readonly dataState: BindingDataState;
  readonly bindings: readonly TrancheBindingDTO[];
  readonly foreignTrancheCount: number;
}

export interface StageBindingReadResult {
  readonly orderId: string;
  readonly stageKey: string;
  readonly dataState: BindingDataState;
  readonly binding: TrancheBindingDTO;
  readonly foreignTrancheCount: number;
}

export interface DepositIntentDTO {
  readonly intentId: string;
  readonly chainId: number;
  readonly escrowAddress: string;
  readonly orderId: string;
  readonly stageKey: string;
  readonly stageId: string;
  readonly trancheId: string;
  readonly payer: string;
  readonly payee: string;
  readonly verifier: string;
  readonly amount: string;
  readonly feeBps: number;
  readonly feeRecipient: string;
  readonly termsHash: string;
  readonly nonce: string;
  readonly deadline: string;
  readonly status: string;
  readonly typedData: DepositTypedData;
}

export interface DepositTypedData {
  readonly types: Readonly<Record<string, readonly { readonly name: string; readonly type: string }[]>>;
  readonly primaryType: "DepositTerms";
  readonly domain: {
    readonly name: "UVPStageEscrow";
    readonly version: "3";
    readonly chainId: number;
    readonly verifyingContract: string;
  };
  readonly message: {
    readonly orderId: string;
    readonly stageId: string;
    readonly payer: string;
    readonly payee: string;
    readonly verifier: string;
    readonly amount: string;
    readonly feeBps: number;
    readonly feeRecipient: string;
    readonly deadline: string;
    readonly nonce: string;
  };
}

export interface InstructionSignatureDTO {
  readonly role: InstructionSignerRole;
  readonly signer: string;
  readonly signature: string;
}

export interface SettlementInstructionDTO {
  readonly instructionId: string;
  readonly idempotencyKey: string;
  readonly chainId: number;
  readonly escrowAddress: string;
  readonly planId: string;
  readonly orderId: string;
  readonly stageKey: string;
  readonly stageId: string;
  readonly trancheId: string;
  readonly kind: SettlementInstructionKind;
  readonly payerAmount: string;
  readonly payeeAmount: string;
  readonly sourceFactId: string;
  readonly payer?: string;
  readonly payee?: string;
  readonly verifier?: string;
  readonly requiredSigners: readonly InstructionSignerRole[];
  readonly signatures: readonly InstructionSignatureDTO[];
  readonly instructionRef: string;
  readonly typedDataHash: string;
  readonly nonce: string;
  readonly deadline: string;
  readonly status: SettlementInstructionStatus;
  readonly executeEligibleAt?: string;
  readonly blockedByDispute?: boolean;
  readonly txHash?: string;
  readonly blockNumber?: string;
  readonly errorCode?: string;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrderSettlementInstructionsReadResult {
  readonly orderId: string;
  readonly dataState: BindingDataState;
  readonly instructions: readonly SettlementInstructionDTO[];
}

export type BindingReadErrorCode =
  | "invalid_response"
  | "order_id_mismatch"
  | "unknown_binding_state"
  | "unknown_instruction_status";

export class BindingReadError extends Error {
  override readonly name = "BindingReadError";

  constructor(readonly code: BindingReadErrorCode, message: string) {
    super(message);
  }
}
