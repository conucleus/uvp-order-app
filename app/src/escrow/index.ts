// 阶段托管模块导出面：通用 EscrowPage 与其读模型/动作构造（测试直接按文件
// 导入，避免把内部钱包边界扩大成公共 API）。

export { EscrowPage, type EscrowPageProps } from "./EscrowPage";
export {
  buildStageEscrowCall,
  encodeStageEscrowCall,
  submitStageEscrowAction,
  type EscrowActionInput,
  type EscrowActionName,
  type StageEscrowCall
} from "./actions";
export {
  escrowActionFailureCopy,
  escrowRevertMessage,
  EscrowActionError
} from "./wallet";
export { readEscrowAllocations, type EscrowAllocationsView } from "./allocations";
export {
  escrowDeadlineView,
  escrowStateLabel,
  formatBaseUnits,
  formatFeeBps,
  formatRemaining,
  formatTokenAmount
} from "./format";
export { parseOrderEscrowList, parseOrderEscrowTranche } from "./read";
export { resolveEscrowConfig, readRuntimeEscrowConfig } from "./config";
export type {
  EscrowTrancheDTO,
  EscrowTrancheState,
  OrderEscrowReadResult
} from "./types";
