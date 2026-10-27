// 最小只读 ABI + 三类事实事件：submitSignal 的 ABI/参数编码由 uvp-client core
// buildSubmitStateMachineSignalCall 单源提供，这里不复制写函数；HookReady 用
// uvp-client decodeHookReadyLog + HOOK_READY_TOPIC 解码。STATE_MACHINE_ABI 尚未从
// uvp-client core 对外导出，故这三类事件仍需最小 ABI（单源缺口，已记录）。
// 不包含配置、资金、文件、任务接口。

import { parseAbi, parseAbiItem } from "viem";

export const stateMachineReadAbi = parseAbi([
  "function planExists(bytes32 planId) view returns (bool)",
  "function orderExists(bytes32 planId, bytes32 orderId) view returns (bool)",
  "function orderCreator(bytes32 planId, bytes32 orderId) view returns (address)",
  "function orderRelayer(bytes32 planId, bytes32 orderId) view returns (address)"
]);

export const signalSubmittedEvent = parseAbiItem(
  "event SignalSubmitted(bytes32 indexed planId, bytes32 indexed orderId, bytes32 indexed sourceId, bytes32 signalId, bytes32 payloadHash, bytes32 idempotencyKey, address submitter, bytes32 factStageId)"
);
export const stageMaterializedEvent = parseAbiItem(
  "event StageMaterialized(bytes32 indexed planId, bytes32 indexed orderId, bytes32 indexed stageId, bytes32 triggerHookId, bytes32 sourceId, bytes32 signalId)"
);
export const stageExecutorActivatedEvent = parseAbiItem(
  "event StageExecutorActivated(bytes32 indexed planId, bytes32 indexed orderId, bytes32 indexed targetStageId, address executor, bytes32 role, bytes32 metadataHash, uint256 patchNonce, string metadataURI)"
);


export const chainEvents = [
  signalSubmittedEvent,
  stageMaterializedEvent,
  stageExecutorActivatedEvent
] as const;
