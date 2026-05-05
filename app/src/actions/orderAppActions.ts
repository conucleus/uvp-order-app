import type { ProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";
import type {
  CreateEvidenceInput,
  Eip712TypedDataDTO,
  EvidenceProofDTO,
  EvidenceUploadResponseDTO,
  PrepareStageExecutorPatchInput,
  PrepareStageResourcePatchInput,
  PrepareTaskSubmitInput,
  PreparedStageExecutorPatchDTO,
  PreparedStageResourcePatchDTO,
  PreparedTaskSubmitDTO,
  ProductApiClient,
  ProductInviteAcceptanceDTO,
  ProductInvitePreviewDTO,
  ProductSubmissionDTO,
  RejectInviteInput,
  AcceptInviteInput,
  StageExecutorPatchSubmissionDTO,
  StageResourcePatchSubmissionDTO,
  SubmitStageExecutorPatchInput,
  SubmitStageResourcePatchInput,
  SubmitTaskInput,
  ParticipantQueryInput
} from "../api/productApi";
import { getInjectedWalletProvider, signProductSubmitWithInjectedWallet, signTypedDataWithInjectedWallet } from "../wallet/injectedWallet";

export interface OrderAppActions {
  hasInjectedWallet(): boolean;
  signProductSubmit(input: {
    readonly typedData: ProductSubmitTypedData;
    readonly walletAddress: string;
  }): Promise<string>;
  signTypedData(input: {
    readonly typedData: Eip712TypedDataDTO;
    readonly walletAddress: string;
  }): Promise<string>;
  prepareTaskSubmit(taskId: string, input: PrepareTaskSubmitInput): Promise<PreparedTaskSubmitDTO>;
  submitTask(taskId: string, input: SubmitTaskInput): Promise<ProductSubmissionDTO>;
  uploadEvidence(input: CreateEvidenceInput): Promise<EvidenceUploadResponseDTO>;
  getEvidenceProof(evidenceId: string): Promise<EvidenceProofDTO>;
  previewInvite(inviteId: string, input?: ParticipantQueryInput): Promise<ProductInvitePreviewDTO>;
  acceptInvite(inviteId: string, input: AcceptInviteInput): Promise<ProductInviteAcceptanceDTO>;
  rejectInvite(inviteId: string, input?: RejectInviteInput): Promise<ProductInviteAcceptanceDTO>;
  prepareStageExecutorPatch(taskId: string, input: PrepareStageExecutorPatchInput): Promise<PreparedStageExecutorPatchDTO>;
  submitStageExecutorPatch(taskId: string, input: SubmitStageExecutorPatchInput): Promise<StageExecutorPatchSubmissionDTO>;
  prepareStageResourcePatch(taskId: string, input: PrepareStageResourcePatchInput): Promise<PreparedStageResourcePatchDTO>;
  submitStageResourcePatch(taskId: string, input: SubmitStageResourcePatchInput): Promise<StageResourcePatchSubmissionDTO>;
}

export function createOrderAppActions(api: ProductApiClient): OrderAppActions {
  return {
    hasInjectedWallet: () => Boolean(getInjectedWalletProvider()),
    signProductSubmit: (input) => signProductSubmitWithInjectedWallet(input),
    signTypedData: (input) => signTypedDataWithInjectedWallet(input),
    prepareTaskSubmit: (taskId, input) => api.prepareTaskSubmit(taskId, input),
    submitTask: (taskId, input) => api.submitTask(taskId, input),
    uploadEvidence: (input) => api.uploadEvidence(input),
    getEvidenceProof: (evidenceId) => api.getEvidenceProof(evidenceId),
    previewInvite: (inviteId, input) => api.previewInvite(inviteId, input),
    acceptInvite: (inviteId, input) => api.acceptInvite(inviteId, input),
    rejectInvite: (inviteId, input) => api.rejectInvite(inviteId, input),
    prepareStageExecutorPatch: (taskId, input) => api.prepareStageExecutorPatch(taskId, input),
    submitStageExecutorPatch: (taskId, input) => api.submitStageExecutorPatch(taskId, input),
    prepareStageResourcePatch: (taskId, input) => api.prepareStageResourcePatch(taskId, input),
    submitStageResourcePatch: (taskId, input) => api.submitStageResourcePatch(taskId, input)
  };
}
