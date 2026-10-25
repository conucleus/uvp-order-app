// V3 托管动作构造：deposit（payer 授权 + 任意 relayer 提交）、payee start、
// payer 开工前退款、verifier 裁决、UVP 事实触发 execute、A+B 开工后分配、
// A+B 争议/解争议，全部只做本地编码；谁能成功由合约与 UVP 事实源裁决。
// execute 只由 immutable UVP fact source 授权：任意 relayer 可提交，caller
// 没有任何金额入参，不能改 verdict/双方签好的分配。

import { encodeFunctionData, type Hex } from "viem";
import { STAGE_ESCROW_V3_ABI } from "./abi";
import type {
  EscrowV3AllocationTerms,
  EscrowV3DepositTerms,
  EscrowV3DisputeTerms,
  EscrowV3VerdictTerms
} from "./types";

export type StageEscrowV3DepositCall = {
  readonly functionName: "deposit";
  readonly args: readonly [EscrowV3DepositTerms, Hex];
};

export type StageEscrowV3MarkStartedCall = {
  readonly functionName: "markStarted";
  readonly args: readonly [Hex];
};

export type StageEscrowV3RefundBeforeStartCall = {
  readonly functionName: "refundBeforeStart";
  readonly args: readonly [Hex];
};

export type StageEscrowV3VerdictCall = {
  readonly functionName: "verdict";
  readonly args: readonly [Hex, boolean, Hex];
};

export type StageEscrowV3ExecuteCall = {
  readonly functionName: "execute";
  readonly args: readonly [Hex, Hex];
};

export type StageEscrowV3RefundAfterStartCall = {
  readonly functionName: "refundAfterStart";
  readonly args: readonly [Hex, bigint, bigint, Hex, Hex];
};

export type StageEscrowV3DisputeCall = {
  readonly functionName: "dispute";
  readonly args: readonly [Hex, Hex, Hex];
};

export type StageEscrowV3ResolveDisputeCall = {
  readonly functionName: "resolveDispute";
  readonly args: readonly [Hex, bigint, bigint, Hex, Hex];
};

export type StageEscrowV3Call =
  | StageEscrowV3DepositCall
  | StageEscrowV3MarkStartedCall
  | StageEscrowV3RefundBeforeStartCall
  | StageEscrowV3VerdictCall
  | StageEscrowV3ExecuteCall
  | StageEscrowV3RefundAfterStartCall
  | StageEscrowV3DisputeCall
  | StageEscrowV3ResolveDisputeCall;

export function buildDepositCall(terms: EscrowV3DepositTerms, payerSignature: Hex): StageEscrowV3DepositCall {
  return { functionName: "deposit", args: [terms, payerSignature] };
}

export function buildMarkStartedCall(trancheId: Hex): StageEscrowV3MarkStartedCall {
  return { functionName: "markStarted", args: [trancheId] };
}

export function buildRefundBeforeStartCall(trancheId: Hex): StageEscrowV3RefundBeforeStartCall {
  return { functionName: "refundBeforeStart", args: [trancheId] };
}

export function buildVerdictCall(
  trancheId: Hex,
  approved: boolean,
  verifierSignature: Hex
): StageEscrowV3VerdictCall {
  return { functionName: "verdict", args: [trancheId, approved, verifierSignature] };
}

export function buildExecuteCall(trancheId: Hex, instructionRef: Hex): StageEscrowV3ExecuteCall {
  return { functionName: "execute", args: [trancheId, instructionRef] };
}

export function buildRefundAfterStartCall(
  trancheId: Hex,
  allocation: EscrowV3AllocationTerms,
  proposerSignature: Hex,
  counterpartSignature: Hex
): StageEscrowV3RefundAfterStartCall {
  return {
    functionName: "refundAfterStart",
    args: [
      trancheId,
      allocation.payerAmount,
      allocation.payeeAmount,
      proposerSignature,
      counterpartSignature
    ]
  };
}

export function buildDisputeCall(
  trancheId: Hex,
  payerSignature: Hex,
  payeeSignature: Hex
): StageEscrowV3DisputeCall {
  return { functionName: "dispute", args: [trancheId, payerSignature, payeeSignature] };
}

export function buildResolveDisputeCall(
  trancheId: Hex,
  allocation: EscrowV3AllocationTerms,
  proposerSignature: Hex,
  counterpartSignature: Hex
): StageEscrowV3ResolveDisputeCall {
  return {
    functionName: "resolveDispute",
    args: [
      trancheId,
      allocation.payerAmount,
      allocation.payeeAmount,
      proposerSignature,
      counterpartSignature
    ]
  };
}

export function encodeStageEscrowV3Call(call: StageEscrowV3Call): Hex {
  switch (call.functionName) {
    case "deposit":
      return encodeFunctionData({ abi: STAGE_ESCROW_V3_ABI, functionName: "deposit", args: call.args });
    case "markStarted":
      return encodeFunctionData({ abi: STAGE_ESCROW_V3_ABI, functionName: "markStarted", args: call.args });
    case "refundBeforeStart":
      return encodeFunctionData({ abi: STAGE_ESCROW_V3_ABI, functionName: "refundBeforeStart", args: call.args });
    case "verdict":
      return encodeFunctionData({ abi: STAGE_ESCROW_V3_ABI, functionName: "verdict", args: call.args });
    case "execute":
      return encodeFunctionData({ abi: STAGE_ESCROW_V3_ABI, functionName: "execute", args: call.args });
    case "refundAfterStart":
      return encodeFunctionData({ abi: STAGE_ESCROW_V3_ABI, functionName: "refundAfterStart", args: call.args });
    case "dispute":
      return encodeFunctionData({ abi: STAGE_ESCROW_V3_ABI, functionName: "dispute", args: call.args });
    case "resolveDispute":
      return encodeFunctionData({ abi: STAGE_ESCROW_V3_ABI, functionName: "resolveDispute", args: call.args });
  }
}

export function encodeDepositCall(terms: EscrowV3DepositTerms, payerSignature: Hex): Hex {
  return encodeStageEscrowV3Call(buildDepositCall(terms, payerSignature));
}

export function encodeMarkStartedCall(trancheId: Hex): Hex {
  return encodeStageEscrowV3Call(buildMarkStartedCall(trancheId));
}

export function encodeRefundBeforeStartCall(trancheId: Hex): Hex {
  return encodeStageEscrowV3Call(buildRefundBeforeStartCall(trancheId));
}

export function encodeVerdictCall(trancheId: Hex, approved: boolean, verifierSignature: Hex): Hex {
  return encodeStageEscrowV3Call(buildVerdictCall(trancheId, approved, verifierSignature));
}

export function encodeExecuteCall(trancheId: Hex, instructionRef: Hex): Hex {
  return encodeStageEscrowV3Call(buildExecuteCall(trancheId, instructionRef));
}

export function encodeRefundAfterStartCall(
  trancheId: Hex,
  allocation: EscrowV3AllocationTerms,
  proposerSignature: Hex,
  counterpartSignature: Hex
): Hex {
  return encodeStageEscrowV3Call(
    buildRefundAfterStartCall(trancheId, allocation, proposerSignature, counterpartSignature)
  );
}

export function encodeDisputeCall(trancheId: Hex, payerSignature: Hex, payeeSignature: Hex): Hex {
  return encodeStageEscrowV3Call(buildDisputeCall(trancheId, payerSignature, payeeSignature));
}

export function encodeResolveDisputeCall(
  trancheId: Hex,
  allocation: EscrowV3AllocationTerms,
  proposerSignature: Hex,
  counterpartSignature: Hex
): Hex {
  return encodeStageEscrowV3Call(
    buildResolveDisputeCall(trancheId, allocation, proposerSignature, counterpartSignature)
  );
}
