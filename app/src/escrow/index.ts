// 阶段托管模块导出面：通用 EscrowPage 与其读模型/动作构造（headless 实现已
// 在 @uvp-eth/order-kernel，本文件保留 app 的既有导出面）。

export { EscrowPage, type EscrowPageProps } from "./EscrowPage";
export {
  buildStageEscrowCall,
  encodeStageEscrowCall,
  submitStageEscrowAction,
  type EscrowActionInput,
  type EscrowActionName,
  type StageEscrowCall
} from "@uvp-eth/order-kernel/escrow";
export {
  escrowActionFailureCopy,
  escrowRevertMessage,
  EscrowActionError
} from "@uvp-eth/order-kernel/escrow";
export { readEscrowAllocations, type EscrowAllocationsView } from "@uvp-eth/order-kernel/escrow";
export {
  escrowDeadlineView,
  escrowStateLabel,
  formatBaseUnits,
  formatFeeBps,
  formatRemaining,
  formatTokenAmount
} from "@uvp-eth/order-kernel/escrow";
export { parseOrderEscrowList, parseOrderEscrowTranche } from "@uvp-eth/order-kernel/escrow";
export { resolveEscrowConfig, readRuntimeEscrowConfig } from "./config";
export type {
  EscrowTrancheDTO,
  EscrowTrancheState,
  OrderEscrowReadResult
} from "@uvp-eth/order-kernel/escrow";
