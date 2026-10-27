// 最小链上 ABI：只包含 order-app 读取/fact 展示与 submitSignal 需要的方法/事件；
// 不包含配置、资金、文件、任务接口。

import { parseAbi, parseAbiItem } from "viem";

export const uvpStateMachineAbi = parseAbi([
  "function planExists(bytes32 planId) view returns (bool)",
  "function orderExists(bytes32 planId, bytes32 orderId) view returns (bool)",
  "function orderCreator(bytes32 planId, bytes32 orderId) view returns (address)",
  "function orderRelayer(bytes32 planId, bytes32 orderId) view returns (address)",
  "function submitSignal(bytes32 planId, bytes32 orderId, bytes32 sourceId, bytes32 signalId, bytes32 payloadHash, bytes32 idempotencyKey, (bytes32 sourceId, bytes32 signalId, bytes32 stageId, bytes32[] capabilityProof) attribution)"
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
export const hookReadyEvent = parseAbiItem(
  "event HookReady(bytes32 indexed planId, bytes32 indexed orderId, bytes32 indexed hookId, bytes32 stageId, bytes32 hookName)"
);

export const chainEvents = [
  signalSubmittedEvent,
  stageMaterializedEvent,
  stageExecutorActivatedEvent,
  hookReadyEvent
] as const;
