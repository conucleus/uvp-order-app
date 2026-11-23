// 链上直连：公共 RPC 只读（order facts/plan 存在性/事实事件/块时间，fromBlock
// 可配、分块查询、失败具名）；写走 uvp-client core 构造的 call + 钱包签名或空签名
// 直发 + browser sendProviderTransaction（不 relay、不代付、无 backend）。失败
// 保留 code/message，不伪造空/成功。

import {
  createPublicClient,
  http,
  isAddress,
  type Address,
  type Hex,
  type Log,
  type TypedDataDefinition
} from "viem";
import {
  getBrowserEthereumProvider,
  sendProviderTransaction,
  signTypedDataWithProvider,
  type Eip1193Provider
} from "@uvp-eth/uvp-client/browser";
import {
  HOOK_READY_TOPIC,
  decodeHookReadyLog,
  decodeStateMachineEvents,
  triggeredOrderIdFromLogs,
  type StateMachineRawLog,
  type SubmitStateMachineSignalCall
} from "@uvp-eth/uvp-client/core";
import { stateMachineEvents, stagePatchEvents, stateMachineReadAbi } from "./abi";
import type { ChainConfig } from "./config";
import type { DecodedContractError } from "./errors";
import {
  decodeChainLogs,
  filterChainEvents,
  withTimestamps,
  type ChainEvent,
  type HookReadyFact
} from "./events";
import { mapWalletError, type Bytes32 } from "./input";

export interface ChainFailure {
  readonly code: string;
  readonly message: string;
  readonly txHash?: Hex | undefined;
  readonly outcomeUnknown?: boolean | undefined;
  readonly revert?: DecodedContractError | undefined;
}

export type ChainResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ChainFailure };

export interface OrderFacts {
  readonly planExists: boolean;
  readonly orderExists: boolean;
  readonly relayer?: Address | undefined;
}

export interface ChainReader {
  readOrder(planId: Bytes32, orderId: Bytes32): Promise<ChainResult<OrderFacts>>;
  readPlanExists(planId: Bytes32): Promise<ChainResult<boolean>>;
  readEvents(planId: Bytes32, orderId: Bytes32): Promise<ChainResult<readonly ChainEvent[]>>;
  latestTimestamp(): Promise<ChainResult<bigint>>;
}

export interface WalletCall {
  readonly address: Address;
  readonly data: Hex;
  readonly chainId?: number | undefined;
}

export interface WalletConnection {
  readonly address: Address;
  readonly provider: Eip1193Provider;
  readonly chainId: number;
}

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const RECEIPT_TIMEOUT_MS = 120_000;

export function createChainReader(config: ChainConfig): ChainReader {
  const client = createPublicClient({ transport: http(config.rpcUrl) });

  return {
    async readOrder(planId, orderId) {
      try {
        const planExists = await client.readContract({
          address: config.stateMachine,
          abi: stateMachineReadAbi,
          functionName: "planExists",
          args: [planId]
        });
        const orderExists = await client.readContract({
          address: config.stateMachine,
          abi: stateMachineReadAbi,
          functionName: "orderExists",
          args: [planId, orderId]
        });
        if (!orderExists) {
          return { ok: true, value: { planExists, orderExists } };
        }
        const relayer = await client.readContract({
          address: config.stateMachine,
          abi: stateMachineReadAbi,
          functionName: "orderRelayer",
          args: [planId, orderId]
        });
        return { ok: true, value: { planExists, orderExists, relayer } };
      } catch (error) {
        return { ok: false, failure: mapReadError(error, "读取订单事实失败") };
      }
    },

    async readPlanExists(planId) {
      try {
        const planExists = await client.readContract({
          address: config.stateMachine,
          abi: stateMachineReadAbi,
          functionName: "planExists",
          args: [planId]
        });
        return { ok: true, value: planExists };
      } catch (error) {
        return { ok: false, failure: mapReadError(error, "读取计划存在性失败") };
      }
    },

    async latestTimestamp() {
      try {
        const block = await client.getBlock();
        return { ok: true, value: block.timestamp };
      } catch (error) {
        return { ok: false, failure: mapReadError(error, "读取链上时间失败") };
      }
    },

    async readEvents(planId, orderId) {
      try {
        const latest = await client.getBlockNumber();
        const stagePatchModule = await client.readContract({
          address: config.stateMachine,
          abi: stateMachineReadAbi,
          functionName: "stagePatchModule"
        });
        const logs: Log[] = [];
        const hookLogs: { readonly raw: StateMachineRawLog; readonly blockHash: Hex }[] = [];
        for (const range of logChunkRanges(config.fromBlock, latest, config.chunkSize)) {
          for (const event of stateMachineEvents) {
            const chunk = await client.getLogs({
              address: config.stateMachine,
              event,
              args: { planId, orderId },
              fromBlock: range.from,
              toBlock: range.to
            });
            logs.push(...chunk);
          }
          if (stagePatchModule !== ZERO_ADDRESS) {
            for (const event of stagePatchEvents) {
              const chunk = await client.getLogs({
                address: stagePatchModule,
                event,
                args: { planId, orderId },
                fromBlock: range.from,
                toBlock: range.to
              });
              logs.push(...chunk);
            }
          }
          const hookChunk = await readHookReadyLogs(
            client,
            config,
            planId,
            orderId,
            range.from,
            range.to
          );
          hookLogs.push(...hookChunk);
        }

        const decoded = decodeChainLogs(logs);
        if (!decoded.ok) {
          return { ok: false, failure: { code: "decode_failed", message: decoded.message } };
        }
        const decodedEvents = filterChainEvents(decoded.events, planId, orderId);
        const hookEvents: HookReadyFact[] = [];
        for (const log of hookLogs) {
          const decodedHook = decodeHookReadyLog(log.raw);
          if (decodedHook === undefined) {
            return {
              ok: false,
              failure: {
                code: "decode_failed",
                message: `HookReady 日志 topic 不匹配（block ${String(log.raw.blockNumber)}）`
              }
            };
          }
          hookEvents.push({
            kind: "hook_ready",
            planId: decodedHook.planId,
            orderId: decodedHook.orderId,
            hookId: decodedHook.hookId,
            stageId: decodedHook.stageId,
            hookName: decodedHook.hookNameId,
            blockNumber: decodedHook.blockNumber ?? log.raw.blockNumber ?? 0n,
            blockHash: log.blockHash,
            transactionHash: decodedHook.transactionHash ?? log.raw.transactionHash ?? "0x",
            logIndex: Number(decodedHook.logIndex ?? log.raw.logIndex ?? 0)
          });
        }

        const merged = [...decodedEvents, ...hookEvents].sort((left, right) => {
          if (left.blockNumber === right.blockNumber) {
            return left.logIndex - right.logIndex;
          }
          return left.blockNumber < right.blockNumber ? -1 : 1;
        });

        const timestamps = new Map<bigint, bigint>();
        const uniqueBlocks = [...new Set(merged.map((event) => event.blockNumber))];
        await Promise.all(
          uniqueBlocks.map(async (blockNumber) => {
            try {
              const block = await client.getBlock({ blockNumber });
              timestamps.set(blockNumber, block.timestamp);
            } catch (error) {
              void error;
            }
          })
        );
        return { ok: true, value: withTimestamps(merged, timestamps) };
      } catch (error) {
        return { ok: false, failure: mapReadError(error, "读取链上事件失败") };
      }
    }
  };
}


async function readHookReadyLogs(
  client: ReturnType<typeof createPublicClient>,
  config: ChainConfig,
  planId: Bytes32,
  orderId: Bytes32,
  fromBlock: bigint,
  toBlock: bigint
): Promise<readonly { readonly raw: StateMachineRawLog; readonly blockHash: Hex }[]> {
  const response = await client.request({
    method: "eth_getLogs",
    params: [
      {
        address: config.stateMachine,
        topics: [HOOK_READY_TOPIC, planId, orderId],
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`
      }
    ]
  });
  if (!Array.isArray(response)) {
    throw new Error("eth_getLogs 没有返回数组");
  }
  return response.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("eth_getLogs 返回了非对象日志");
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record["data"] !== "string" ||
      !Array.isArray(record["topics"]) ||
      !record["topics"].every((topic) => typeof topic === "string")
    ) {
      throw new Error("eth_getLogs 日志缺少 data/topics");
    }
    const blockNumber =
      typeof record["blockNumber"] === "string" ? BigInt(record["blockNumber"]) : undefined;
    const logIndex =
      typeof record["logIndex"] === "string" ? Number(BigInt(record["logIndex"])) : undefined;
    const blockHash =
      typeof record["blockHash"] === "string" ? (record["blockHash"] as Hex) : ("0x" as Hex);
    return {
      blockHash,
      raw: {
        data: record["data"] as Hex,
        topics: record["topics"] as Hex[],
        ...(typeof record["address"] === "string" ? { address: record["address"] } : {}),
        ...(blockNumber === undefined ? {} : { blockNumber }),
        ...(typeof record["transactionHash"] === "string"
          ? { transactionHash: record["transactionHash"] as Hex }
          : {}),
        ...(logIndex === undefined ? {} : { logIndex })
      }
    };
  });
}

export async function connectWallet(config: ChainConfig): Promise<ChainResult<WalletConnection>> {
  const provider = getBrowserEthereumProvider();
  if (provider === undefined) {
    return { ok: false, failure: { code: "no_wallet", message: "浏览器没有注入钱包（window.ethereum 不存在）" } };
  }
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) {
      return { ok: false, failure: { code: "no_account", message: "钱包没有返回合法账户" } };
    }
    const chainIdRaw = await provider.request({ method: "eth_chainId" });
    if (typeof chainIdRaw !== "string" || !/^0x[0-9a-f]+$/iu.test(chainIdRaw)) {
      return { ok: false, failure: { code: "chain_unknown", message: "钱包没有返回合法链 ID" } };
    }
    const chainId = Number(BigInt(chainIdRaw));
    if (chainId !== config.chainId) {
      return {
        ok: false,
        failure: {
          code: "wrong_chain",
          message: `钱包链 ID ${chainId} 与配置 ${config.chainId} 不一致；请先在钱包切换网络`
        }
      };
    }
    return { ok: true, value: { address: accounts[0] as Address, provider, chainId } };
  } catch (error) {
    const mapped = mapWalletError(error);
    return { ok: false, failure: { code: mapped.code, message: mapped.message } };
  }
}

export async function signTypedDataWithWallet(
  connection: WalletConnection,
  typedData: TypedDataDefinition
): Promise<ChainResult<Hex>> {
  try {
    const signature = await signTypedDataWithProvider(connection.provider, typedData, connection.address);
    return { ok: true, value: signature };
  } catch (error) {
    const mapped = mapWalletError(error);
    return { ok: false, failure: { code: mapped.code, message: mapped.message } };
  }
}

interface SentTransaction {
  readonly txHash: Hex;
  readonly logs: readonly StateMachineRawLog[];
}

async function sendWalletTransaction(
  config: ChainConfig,
  connection: WalletConnection,
  call: WalletCall,
  label: string
): Promise<ChainResult<SentTransaction>> {
  if (call.chainId !== undefined && call.chainId !== config.chainId) {
    return {
      ok: false,
      failure: {
        code: "chain_mismatch",
        message: `${label} 的链 ID ${call.chainId} 与配置 ${config.chainId} 不一致`
      }
    };
  }
  const publicClient = createPublicClient({ transport: http(config.rpcUrl) });

  try {
    await publicClient.call({
      account: connection.address,
      to: call.address,
      data: call.data
    });
  } catch (error) {
    const mapped = mapWalletError(error);
    return {
      ok: false,
      failure: {
        code: mapped.code,
        message: `${label} 预检失败：${mapped.message}`,
        ...(mapped.revert === undefined ? {} : { revert: mapped.revert })
      }
    };
  }

  let hash: Hex;
  try {
    hash = await sendProviderTransaction(connection.provider, {
      from: connection.address,
      to: call.address,
      data: call.data
    });
  } catch (error) {
    const mapped = mapWalletError(error);
    return {
      ok: false,
      failure: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.revert === undefined ? {} : { revert: mapped.revert })
      }
    };
  }

  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== "success") {
      return {
        ok: false,
        failure: { code: "reverted", message: `${label} 已上链但回执状态是 reverted`, txHash: hash }
      };
    }
    return { ok: true, value: { txHash: hash, logs: rawLogsOf(receipt.logs) } };
  } catch (error) {
    return { ok: false, failure: receiptUnknownFailure(hash, label, error) };
  }
}

export function receiptUnknownFailure(txHash: Hex, label: string, error: unknown): ChainFailure {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    code: "receipt_unknown",
    message:
      `${label} 已广播（txHash ${txHash}），但回执等待失败，结果未知（UNKNOWN）：${detail}。` +
      "请在链上按 txHash 核实，不要直接重复发送。",
    txHash,
    outcomeUnknown: true
  };
}

export async function sendWalletCall(
  config: ChainConfig,
  connection: WalletConnection,
  call: WalletCall,
  label: string
): Promise<ChainResult<{ readonly txHash: Hex }>> {
  const sent = await sendWalletTransaction(config, connection, call, label);
  return sent.ok ? { ok: true, value: { txHash: sent.value.txHash } } : sent;
}

export async function submitCommitPlan(
  config: ChainConfig,
  connection: WalletConnection,
  call: WalletCall
): Promise<ChainResult<{ readonly txHash: Hex; readonly planId: Bytes32 }>> {
  const sent = await sendWalletTransaction(config, connection, call, "commitPlan");
  if (!sent.ok) {
    return sent;
  }
  let planId: Bytes32 | undefined;
  try {
    planId = planCommittedIdFromLogs(sent.value.logs);
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: "plan_id_decode_failed",
        message: `commitPlan 回执的 PlanCommitted 解码失败：${
          error instanceof Error ? error.message : String(error)
        }`,
        txHash: sent.value.txHash
      }
    };
  }
  if (planId === undefined) {
    return {
      ok: false,
      failure: {
        code: "plan_id_missing",
        message: "commitPlan 交易回执里没有 PlanCommitted 事件，链上生成的 planId 未知",
        txHash: sent.value.txHash
      }
    };
  }
  return { ok: true, value: { txHash: sent.value.txHash, planId } };
}

export function planCommittedIdFromLogs(logs: readonly StateMachineRawLog[]): Bytes32 | undefined {
  for (const event of decodeStateMachineEvents(logs)) {
    if (event.eventName === "PlanCommitted") {
      return event.args.planId as Bytes32;
    }
  }
  return undefined;
}

export async function submitSignal(
  config: ChainConfig,
  connection: WalletConnection,
  call: SubmitStateMachineSignalCall
): Promise<ChainResult<{ readonly txHash: Hex }>> {
  return sendWalletCall(
    config,
    connection,
    { address: call.address, data: call.data, chainId: call.chainId },
    "submitSignal"
  );
}

export async function submitOrderTrigger(
  config: ChainConfig,
  connection: WalletConnection,
  call: SubmitStateMachineSignalCall
): Promise<ChainResult<{ readonly txHash: Hex; readonly orderId: Bytes32 }>> {
  const sent = await sendWalletTransaction(
    config,
    connection,
    { address: call.address, data: call.data, chainId: call.chainId },
    "submitSignal"
  );
  if (!sent.ok) {
    return sent;
  }
  let orderId: Hex | undefined;
  try {
    orderId = triggeredOrderIdFromLogs(sent.value.logs);
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: "order_id_decode_failed",
        message: `出生回执的 SignalSubmitted 解码失败：${error instanceof Error ? error.message : String(error)}`,
        txHash: sent.value.txHash
      }
    };
  }
  if (orderId === undefined) {
    return {
      ok: false,
      failure: {
        code: "order_id_missing",
        message: "出生交易回执里没有 SignalSubmitted 事件，链上生成的 orderId 未知",
        txHash: sent.value.txHash
      }
    };
  }
  return { ok: true, value: { txHash: sent.value.txHash, orderId: orderId as Bytes32 } };
}

function rawLogsOf(logs: readonly Log[]): readonly StateMachineRawLog[] {
  return logs.map((log) => ({
    data: log.data,
    topics: log.topics,
    address: log.address,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex
  }));
}

export function logChunkRanges(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint
): readonly { readonly from: bigint; readonly to: bigint }[] {
  if (chunkSize <= 0n) {
    throw new Error("chunkSize must be positive");
  }
  if (toBlock < fromBlock) {
    return [];
  }
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let from = fromBlock; from <= toBlock; from += chunkSize) {
    const candidate = from + chunkSize - 1n;
    ranges.push({ from, to: candidate < toBlock ? candidate : toBlock });
  }
  return ranges;
}

export function mapReadError(error: unknown, prefix: string): ChainFailure {
  const mapped = mapWalletError(error);
  return {
    code: mapped.code === "unknown" ? "read_failed" : mapped.code,
    message: `${prefix}：${mapped.message}`,
    ...(mapped.revert === undefined ? {} : { revert: mapped.revert })
  };
}
