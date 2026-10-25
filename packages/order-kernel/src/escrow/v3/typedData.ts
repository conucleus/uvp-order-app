// V3 EIP-712：域为 {"UVPStageEscrow","3"}；主类型 DepositTerms（payer 冻款
// 授权）、UVPStageVerdict（verifier 裁决）、UVPStageAllocation（A+B 分配）、
// UVPStageDispute（A+B 进入争议），逐字段镜像合约。链 ID 与 escrow 地址由
// 调用方注入，kernel 不读环境；depositAuthorizationHash 只用于查询授权是否
// 已用，不作为签名哈希。

import { encodeAbiParameters, keccak256, type Address, type Hex, type TypedData } from "viem";
import type {
  EscrowV3AllocationTerms,
  EscrowV3DepositTerms,
  EscrowV3DisputeTerms,
  EscrowV3VerdictTerms
} from "./types";

export const ESCROW_V3_DOMAIN_NAME = "UVPStageEscrow";
export const ESCROW_V3_DOMAIN_VERSION = "3";

export const ESCROW_V3_DEPOSIT_TYPES = {
  DepositTerms: [
    { name: "orderId", type: "bytes32" },
    { name: "stageId", type: "bytes32" },
    { name: "payer", type: "address" },
    { name: "payee", type: "address" },
    { name: "verifier", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "feeBps", type: "uint16" },
    { name: "feeRecipient", type: "address" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" }
  ]
} as const satisfies TypedData;

export const ESCROW_V3_VERDICT_TYPES = {
  UVPStageVerdict: [
    { name: "orderId", type: "bytes32" },
    { name: "stageId", type: "bytes32" },
    { name: "trancheId", type: "bytes32" },
    { name: "approved", type: "bool" }
  ]
} as const satisfies TypedData;

export const ESCROW_V3_ALLOCATION_TYPES = {
  UVPStageAllocation: [
    { name: "orderId", type: "bytes32" },
    { name: "stageId", type: "bytes32" },
    { name: "trancheId", type: "bytes32" },
    { name: "payerAmount", type: "uint256" },
    { name: "payeeAmount", type: "uint256" }
  ]
} as const satisfies TypedData;

export const ESCROW_V3_DISPUTE_TYPES = {
  UVPStageDispute: [
    { name: "orderId", type: "bytes32" },
    { name: "stageId", type: "bytes32" },
    { name: "trancheId", type: "bytes32" }
  ]
} as const satisfies TypedData;

export type EscrowV3SignerRole = "payer" | "payee";

export interface EscrowV3TypedDataDomain {
  readonly chainId: number;
  readonly escrow: Address;
}

function domainOf(domain: EscrowV3TypedDataDomain) {
  return {
    name: ESCROW_V3_DOMAIN_NAME,
    version: ESCROW_V3_DOMAIN_VERSION,
    chainId: domain.chainId,
    verifyingContract: domain.escrow
  } as const;
}

export function buildDepositTypedData(terms: EscrowV3DepositTerms, domain: EscrowV3TypedDataDomain) {
  return {
    domain: domainOf(domain),
    types: ESCROW_V3_DEPOSIT_TYPES,
    primaryType: "DepositTerms",
    message: terms
  } as const;
}

export function buildVerdictTypedData(terms: EscrowV3VerdictTerms, domain: EscrowV3TypedDataDomain) {
  return {
    domain: domainOf(domain),
    types: ESCROW_V3_VERDICT_TYPES,
    primaryType: "UVPStageVerdict",
    message: terms
  } as const;
}

export function buildAllocationTypedData(
  terms: EscrowV3AllocationTerms,
  domain: EscrowV3TypedDataDomain,
  signerRole: EscrowV3SignerRole
) {
  return {
    signerRole,
    typedData: {
      domain: domainOf(domain),
      types: ESCROW_V3_ALLOCATION_TYPES,
      primaryType: "UVPStageAllocation",
      message: terms
    } as const
  } as const;
}

export function buildDisputeTypedData(
  terms: EscrowV3DisputeTerms,
  domain: EscrowV3TypedDataDomain,
  signerRole: EscrowV3SignerRole
) {
  return {
    signerRole,
    typedData: {
      domain: domainOf(domain),
      types: ESCROW_V3_DISPUTE_TYPES,
      primaryType: "UVPStageDispute",
      message: terms
    } as const
  } as const;
}

export function depositAuthorizationHash(terms: EscrowV3DepositTerms): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint16" },
        { type: "address" },
        { type: "uint64" },
        { type: "uint256" }
      ],
      [
        terms.orderId,
        terms.stageId,
        terms.payer,
        terms.payee,
        terms.verifier,
        terms.amount,
        terms.feeBps,
        terms.feeRecipient,
        terms.deadline,
        terms.nonce
      ]
    )
  );
}
