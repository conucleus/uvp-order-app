// 最小只读 ABI + 事实事件：submitSignal 的 ABI/参数编码由 uvp-client core
// buildSubmitStateMachineSignalCall 单源提供，这里不复制写函数；HookReady 用
// uvp-client decodeHookReadyLog + HOOK_READY_TOPIC 解码。STATE_MACHINE_ABI /
// STAGE_PATCH_MODULE_ABI 尚未从 uvp-client core 对外导出，故事实事件仍需最小
// ABI（单源缺口）；事件形状以 @uvp-eth/protocol-bindings 的新导出为准。
// 不包含配置、资金、文件、任务接口。

import { parseAbi, parseAbiItem } from "viem";

export const stateMachineReadAbi = parseAbi([
  "function planExists(bytes32 planId) view returns (bool)",
  "function orderExists(bytes32 planId, bytes32 orderId) view returns (bool)",
  "function orderCreator(bytes32 planId, bytes32 orderId) view returns (address)",
  "function orderRelayer(bytes32 planId, bytes32 orderId) view returns (address)",
  "function stagePatchModule() view returns (address)"
]);

export const signalSubmittedEvent = parseAbiItem(
  "event SignalSubmitted(bytes32 indexed planId, bytes32 indexed orderId, bytes32 indexed sourceId, bytes32 signalId, bytes32 payloadHash, bytes32 idempotencyKey, address submitter, address relayer, bytes32 factStageId)"
);
export const stageMaterializedEvent = parseAbiItem(
  "event StageMaterialized(bytes32 indexed planId, bytes32 indexed orderId, bytes32 indexed stageId, bytes32 triggerHookId, bytes32 sourceId, bytes32 signalId)"
);
export const stageExecutorActivatedEvent = parseAbiItem(
  "event StageExecutorActivated(bytes32 indexed planId, bytes32 indexed orderId, bytes32 indexed targetStageId, bytes32 supplierId, uint256 patchNonce)"
);
export const stageExecutorPatchAppliedEvent = parseAbiItem(
  "event StageExecutorPatchApplied(bytes32 indexed planId, bytes32 indexed orderId, bytes32 indexed selectorStageId, bytes32 targetStageId, address selector, bytes32 supplierId, bytes32 previousSupplierId, uint256 patchNonce)"
);

export const stateMachineEvents = [
  signalSubmittedEvent,
  stageMaterializedEvent,
  stageExecutorActivatedEvent
] as const;

export const stagePatchEvents = [stageExecutorPatchAppliedEvent] as const;

export const chainEvents = [...stateMachineEvents, ...stagePatchEvents] as const;
