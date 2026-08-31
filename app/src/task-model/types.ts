import type { ChainProofRowDTO } from "@uvp-eth/product-dto";

export type EvidenceCaptureStatus = "empty" | "uploading" | "uploaded" | "failed" | "quarantined";
export type EvidenceVerificationStatus = "unbound" | "matched" | "mismatch" | "missing_file";

export type TaskSubmissionStatus =
  | "prepared"
  | "signature_received"
  | "broadcasting"
  | "submitted"
  | "indexing"
  | "confirmed"
  | "failed"
  | "expired"
  | "replaced";

export interface EvidenceRequirement {
  readonly slotId: string;
  readonly label: string;
  readonly documentType: string;
  readonly required: boolean;
}

export interface CapturedEvidence {
  readonly requirement: EvidenceRequirement;
  readonly status: EvidenceCaptureStatus;
  readonly evidenceId?: string | undefined;
  readonly fileName?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly size?: number | undefined;
  readonly businessLabel?: string | undefined;
  readonly contentHash?: `0x${string}` | undefined;
  readonly metadataHash?: `0x${string}` | undefined;
  readonly payloadHash?: `0x${string}` | undefined;
  readonly payloadRef?: string | undefined;
  readonly storageURI?: string | undefined;
  readonly createdAt?: string | undefined;
  readonly verificationStatus?: EvidenceVerificationStatus | undefined;
  readonly error?: string | undefined;
}

export interface TaskSubmissionProof {
  readonly taskId: string;
  readonly orderId: string;
  readonly orderTitle: string;
  readonly taskTitle: string;
  readonly actionLabel: string;
  readonly status: TaskSubmissionStatus;
  readonly txHash?: `0x${string}` | undefined;
  readonly blockNumber?: string | undefined;
  readonly signerWallet: string;
  readonly payloadHash?: `0x${string}` | undefined;
  readonly stateMachineAddress?: string | undefined;
  readonly evidence: readonly CapturedEvidence[];
  readonly proofRows: readonly ChainProofRowDTO[];
}
