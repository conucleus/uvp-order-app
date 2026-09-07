import type { ProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";
import type {
  CreateEvidenceInput,
  Eip712TypedDataDTO,
  EvidenceProofDTO,
  EvidenceUploadResponseDTO,
  InviteRequestOptions,
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
  ParticipantQueryInput,
  WalletSessionProof
} from "../api/productApi";
import {
  getInjectedWalletProvider,
  personalSignWithInjectedWallet,
  requestInjectedWalletAddress,
  signProductSubmitWithInjectedWallet,
  signTypedDataWithInjectedWallet,
  type TypedDataDomainExpectation
} from "../wallet/injectedWallet";

export interface OrderAppActions {
  hasInjectedWallet(): boolean;
  requestWalletAddress(): Promise<string>;
  signProductSubmit(input: {
    readonly typedData: ProductSubmitTypedData;
    readonly walletAddress: string;
    readonly expected?: TypedDataDomainExpectation | undefined;
  }): Promise<string>;
  signTypedData(input: {
    readonly typedData: Eip712TypedDataDTO;
    readonly walletAddress: string;
    readonly expected?: TypedDataDomainExpectation | undefined;
  }): Promise<string>;
  prepareTaskSubmit(taskId: string, input: PrepareTaskSubmitInput): Promise<PreparedTaskSubmitDTO>;
  submitTask(taskId: string, input: SubmitTaskInput): Promise<ProductSubmissionDTO>;
  uploadEvidence(input: CreateEvidenceInput): Promise<EvidenceUploadResponseDTO>;
  getEvidenceProof(evidenceId: string): Promise<EvidenceProofDTO>;
  previewInvite(inviteId: string, input?: ParticipantQueryInput): Promise<ProductInvitePreviewDTO>;
  acceptInvite(inviteId: string, input: AcceptInviteInput, options?: InviteRequestOptions): Promise<ProductInviteAcceptanceDTO>;
  rejectInvite(inviteId: string, input: RejectInviteInput): Promise<ProductInviteAcceptanceDTO>;
  proveWalletControl(input: { readonly address: string }): Promise<WalletSessionProof>;
  prepareStageExecutorPatch(taskId: string, input: PrepareStageExecutorPatchInput): Promise<PreparedStageExecutorPatchDTO>;
  submitStageExecutorPatch(taskId: string, input: SubmitStageExecutorPatchInput): Promise<StageExecutorPatchSubmissionDTO>;
  prepareStageResourcePatch(taskId: string, input: PrepareStageResourcePatchInput): Promise<PreparedStageResourcePatchDTO>;
  submitStageResourcePatch(taskId: string, input: SubmitStageResourcePatchInput): Promise<StageResourcePatchSubmissionDTO>;
}

export function createOrderAppActions(api: ProductApiClient): OrderAppActions {
  return {
    hasInjectedWallet: () => Boolean(getInjectedWalletProvider()),
    requestWalletAddress: () => requestInjectedWalletAddress(),
    signProductSubmit: (input) => signProductSubmitWithInjectedWallet(input),
    signTypedData: (input) => signTypedDataWithInjectedWallet(input),
    prepareTaskSubmit: (taskId, input) => api.prepareTaskSubmit(taskId, input),
    submitTask: (taskId, input) => api.submitTask(taskId, input),
    uploadEvidence: (input) => api.uploadEvidence(input),
    getEvidenceProof: (evidenceId) => api.getEvidenceProof(evidenceId),
    previewInvite: (inviteId, input) => api.previewInvite(inviteId, input),
    acceptInvite: (inviteId, input, options) => api.acceptInvite(inviteId, input, options),
    rejectInvite: (inviteId, input) => api.rejectInvite(inviteId, input),
    proveWalletControl: (input) => api.proveWalletControl(input),
    prepareStageExecutorPatch: (taskId, input) => api.prepareStageExecutorPatch(taskId, input),
    submitStageExecutorPatch: (taskId, input) => api.submitStageExecutorPatch(taskId, input),
    prepareStageResourcePatch: (taskId, input) => api.prepareStageResourcePatch(taskId, input),
    submitStageResourcePatch: (taskId, input) => api.submitStageResourcePatch(taskId, input)
  };
}
