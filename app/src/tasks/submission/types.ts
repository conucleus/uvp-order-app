import type { ChainProofRowDTO } from "@uvp-eth/product-dto";
import type { ProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";

export interface PreparedTaskSubmit {
  readonly prepareId: string;
  readonly taskId: string;
  readonly orderId: string;
  readonly payloadHash: string;
  readonly expiresAt: string;
  readonly typedData: ProductSubmitTypedData;
  readonly humanSummary?: {
    readonly purpose: string;
    readonly action: string;
    readonly validUntil: string;
  };
}

export interface ProductSubmission {
  readonly submissionId: string;
  readonly status: string;
  readonly txHash?: string;
  readonly blockNumber?: string;
  readonly errorCode?: string;
  readonly proofRows: readonly ChainProofRowDTO[];
}

export interface SubmitPreparedInput {
  readonly prepareId: string;
  readonly signature: string;
  readonly walletAddress: string;
}

export type RuntimePhase = "idle" | "preparing" | "prepared" | "submitting" | "submitted" | "error";
export type PatchPhase = "idle" | "preparing" | "prepared" | "submitting" | "submitted" | "error";
