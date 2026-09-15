import type { ChainProofRowDTO } from "@uvp-eth/product-dto";
import type { ProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";
import type { SubmissionPhase } from "../../shared/chain/submission/phase-machine";

export interface PreparedTaskSubmit {
  readonly prepareId: string;
  readonly taskId: string;
  readonly orderId: string;
  readonly payloadHash: string;
  readonly expiresAt: string;
  /**
   * prepare 记录声明的提交方：签名前与签名钱包交叉核对用。App 侧直接
   * 传 PreparedTaskSubmitDTO（服务端恒产出 submitter），投影类型保持
   * 可选以兼容窄构造点。
   */
  readonly submitter?: string | undefined;
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

/**
 * 提交相位枚举已上收 chain 轨（SubmissionPhase，两端单源）；迁移归约
 * submissionPhaseReducer 同在 shared/chain/submission/phase-machine
 * （submitted 终态闸/reset 语义）。本端组件的直接 setPhase 调用保持
 * 原样（最小行为变化），别名保留既有类型名。
 */
export type RuntimePhase = SubmissionPhase;
export type PatchPhase = SubmissionPhase;
