// 链上事件解码/过滤：SignalSubmitted / StageMaterialized / StageExecutorActivated 用
// viem + 最小事件 ABI（STATE_MACHINE_ABI 尚未从 uvp-client core 导出，单源缺口）；
// HookReady 由 uvp-client decodeHookReadyLog 解码后合入。字段原样透传，解码失败显式报错。

import { decodeEventLog, type Hex, type Log } from "viem";
import { chainEvents } from "./abi";
import type { Bytes32 } from "./input";

interface EventBase {
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionHash: Hex;
  readonly logIndex: number;
  readonly timestamp?: bigint | undefined;
}

export interface SignalSubmittedFact extends EventBase {
  readonly kind: "signal_submitted";
  readonly planId: Bytes32;
  readonly orderId: Bytes32;
  readonly sourceId: Bytes32;
  readonly signalId: Bytes32;
  readonly payloadHash: Bytes32;
  readonly idempotencyKey: Bytes32;
  readonly submitter: `0x${string}`;
  readonly factStageId: Bytes32;
}

export interface HookReadyFact extends EventBase {
  readonly kind: "hook_ready";
  readonly planId: Bytes32;
  readonly orderId: Bytes32;
  readonly hookId: Bytes32;
  readonly stageId: Bytes32;
  readonly hookName: Bytes32;
}

export interface StageMaterializedFact extends EventBase {
  readonly kind: "stage_materialized";
  readonly planId: Bytes32;
  readonly orderId: Bytes32;
  readonly stageId: Bytes32;
  readonly triggerHookId: Bytes32;
  readonly sourceId: Bytes32;
  readonly signalId: Bytes32;
}

export interface StageExecutorActivatedFact extends EventBase {
  readonly kind: "stage_executor_activated";
  readonly planId: Bytes32;
  readonly orderId: Bytes32;
  readonly targetStageId: Bytes32;
  readonly executor: `0x${string}`;
  readonly role: Bytes32;
  readonly metadataHash: Bytes32;
  readonly patchNonce: bigint;
  readonly metadataURI: string;
}

export type ChainEvent =
  | SignalSubmittedFact
  | HookReadyFact
  | StageMaterializedFact
  | StageExecutorActivatedFact;

export type ViemDecodedFact = Exclude<ChainEvent, HookReadyFact>;

export type DecodeResult =
  | { readonly ok: true; readonly events: readonly ViemDecodedFact[] }
  | { readonly ok: false; readonly message: string };

export function decodeChainLogs(logs: readonly Log[]): DecodeResult {
  const events: ViemDecodedFact[] = [];
  for (const log of logs) {
    let decoded: ReturnType<typeof decodeEventLog>;
    try {
      decoded = decodeEventLog({
        abi: chainEvents,
        data: log.data,
        topics: log.topics
      });
    } catch (error) {
      return {
        ok: false,
        message: `事件解码失败（block ${String(log.blockNumber)} log ${String(log.logIndex)}）：${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }
    const base = {
      blockNumber: log.blockNumber ?? 0n,
      blockHash: log.blockHash ?? "0x",
      transactionHash: log.transactionHash ?? "0x",
      logIndex: log.logIndex ?? 0
    } as const;

    switch (decoded.eventName) {
      case "SignalSubmitted": {
        const args = decoded.args as unknown as {
          planId: Bytes32;
          orderId: Bytes32;
          sourceId: Bytes32;
          signalId: Bytes32;
          payloadHash: Bytes32;
          idempotencyKey: Bytes32;
          submitter: `0x${string}`;
          factStageId: Bytes32;
        };
        events.push({ ...base, kind: "signal_submitted", ...args });
        break;
      }
      case "StageMaterialized": {
        const args = decoded.args as unknown as {
          planId: Bytes32;
          orderId: Bytes32;
          stageId: Bytes32;
          triggerHookId: Bytes32;
          sourceId: Bytes32;
          signalId: Bytes32;
        };
        events.push({ ...base, kind: "stage_materialized", ...args });
        break;
      }
      case "StageExecutorActivated": {
        const args = decoded.args as unknown as {
          planId: Bytes32;
          orderId: Bytes32;
          targetStageId: Bytes32;
          executor: `0x${string}`;
          role: Bytes32;
          metadataHash: Bytes32;
          patchNonce: bigint;
          metadataURI: string;
        };
        events.push({ ...base, kind: "stage_executor_activated", ...args });
        break;
      }
      default:
        return { ok: false, message: "事件解码得到未知事件名（ABI 与日志不匹配）" };
    }
  }
  return { ok: true, events };
}

export function filterChainEvents(
  events: readonly ChainEvent[],
  planId: string,
  orderId: string
): readonly ChainEvent[] {
  const plan = planId.toLowerCase();
  const order = orderId.toLowerCase();
  return events.filter(
    (event) => event.planId.toLowerCase() === plan && event.orderId.toLowerCase() === order
  );
}

export function withTimestamps(
  events: readonly ChainEvent[],
  timestamps: ReadonlyMap<bigint, bigint>
): readonly ChainEvent[] {
  return events.map((event) => {
    const timestamp = timestamps.get(event.blockNumber);
    return timestamp === undefined ? event : { ...event, timestamp };
  });
}

