import type { ChainProofRowDTO, ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import type { EvidenceProofDTO, ProductApiSource, ProductSubmissionStatus } from "../api/productApi";

export type EvidenceCaptureStatus = "empty" | "uploading" | "uploaded" | "failed" | "quarantined";
export type EvidenceCaptureSource = "api" | "demo";

export interface EvidenceRequirement {
  readonly slotId: string;
  readonly label: string;
  readonly documentType: string;
  readonly required: boolean;
}

export interface CapturedEvidence {
  readonly requirement: EvidenceRequirement;
  readonly status: EvidenceCaptureStatus;
  readonly source?: EvidenceCaptureSource;
  readonly evidenceId?: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly businessLabel?: string;
  readonly contentHash?: `0x${string}`;
  readonly metadataHash?: `0x${string}`;
  readonly payloadHash?: `0x${string}`;
  readonly payloadRef?: string;
  readonly storageURI?: string;
  readonly createdAt?: string;
  readonly verificationStatus?: EvidenceProofDTO["verificationStatus"];
  readonly error?: string;
}

export interface TaskSubmissionProof {
  readonly taskId: string;
  readonly orderId: string;
  readonly orderTitle: string;
  readonly taskTitle: string;
  readonly actionLabel: string;
  readonly status: ProductSubmissionStatus | "demo_confirmed";
  readonly txHash?: `0x${string}`;
  readonly blockNumber?: string;
  readonly signerWallet: string;
  readonly payloadHash?: `0x${string}`;
  readonly stateMachineAddress?: string;
  readonly evidence: readonly CapturedEvidence[];
  readonly proofRows: readonly ChainProofRowDTO[];
}

export interface EvidencePanelContext {
  readonly task: ProductTaskDTO;
  readonly order?: ProductOrderDTO;
  readonly participantWallet?: string;
  readonly source?: ProductApiSource;
}
