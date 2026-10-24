// StageEscrow V2 托管读面模型：tranche DTO 形状镜像 uvp-chain-services
// service/src/escrow/types.ts 的 EscrowTrancheDTO（只读链上投影；其中
// releaseAt/refundAt 是实际放款/退款时刻），金额保持 base units 字符串；
// 状态词表与角色判定都在本模块，避免各面板自造第二套词表。

export const ESCROW_TRANCHE_STATES = [
  "frozen",
  "approved",
  "rejected",
  "suspended",
  "paid",
  "refunded",
  "settled"
] as const;

export type EscrowTrancheState = (typeof ESCROW_TRANCHE_STATES)[number];

export const ESCROW_TERMINAL_STATES: ReadonlySet<EscrowTrancheState> = new Set([
  "paid",
  "refunded",
  "settled"
]);

export interface EscrowTrancheDTO {
  readonly orderId: string;
  readonly stageId: string;
  readonly trancheId: string;
  readonly payer: string;
  readonly payee: string;
  readonly verifier: string;
  readonly amount: string;
  readonly observationDays: number;
  readonly feeBps: number;
  readonly feeRecipient: string;
  readonly state: EscrowTrancheState;
  readonly approvedAt: string | null;
  readonly rejectedAt: string | null;
  readonly suspendedAt: string | null;
  readonly releaseAt: string | null;
  readonly refundAt: string | null;
  readonly payerAmount: string | null;
  readonly payeeAmount: string | null;
  readonly feeAmount: string | null;
  readonly updatedAt: string;
  readonly blockNumber: string;
  readonly logIndex: number;
}

export interface OrderEscrowReadResult {
  readonly orderId: string;
  readonly tranches: readonly EscrowTrancheDTO[];
}

export type EscrowActorRole = "payer" | "payee" | "verifier";

export function escrowActorRoles(tranche: EscrowTrancheDTO, walletAddress: string | undefined): ReadonlySet<EscrowActorRole> {
  const wallet = walletAddress?.trim().toLowerCase();
  const roles = new Set<EscrowActorRole>();
  if (!wallet) {
    return roles;
  }
  if (tranche.payer.toLowerCase() === wallet) {
    roles.add("payer");
  }
  if (tranche.payee.toLowerCase() === wallet) {
    roles.add("payee");
  }
  if (tranche.verifier.toLowerCase() === wallet) {
    roles.add("verifier");
  }
  return roles;
}
