// 链上直连：公共 RPC 只读（order facts + 事实事件，fromBlock 可配、分块查询、
// 失败具名）；写走 uvp-client core 构造的 submitSignal call + browser
// sendProviderTransaction（不 relay、不代付、无 backend）。失败保留 code/message，
// 不伪造空/成功。

import {
  createPublicClient,
  http,
  isAddress,
  type Address,
  type Hex,
  type Log
} from "viem";
import {
  getBrowserEthereumProvider,
  sendProviderTransaction,
  type Eip1193Provider
} from "@uvp-eth/uvp-client/browser";
import {
  HOOK_READY_TOPIC,
  decodeHookReadyLog,
  type StateMachineRawLog,
  type SubmitStateMachineSignalCall
} from "@uvp-eth/uvp-client/core";
import { chainEvents, stateMachineReadAbi } from "./abi";
import type { ChainConfig } from "./config";
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
}

export type ChainResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ChainFailure };

export interface OrderFacts {
  readonly planExists: boolean;
  readonly orderExists: boolean;
  readonly creator?: Address | undefined;
  readonly relayer?: Address | undefined;
}

export interface ChainReader {
  readOrder(planId: Bytes32, orderId: Bytes32): Promise<ChainResult<OrderFacts>>;
  readEvents(planId: Bytes32, orderId: Bytes32): Promise<ChainResult<readonly ChainEvent[]>>;
}

export interface WalletConnection {
  readonly address: Address;
  readonly provider: Eip1193Provider;
  readonly chainId: number;
}

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
        const [creator, relayer] = await Promise.all([
          client.readContract({
            address: config.stateMachine,
            abi: stateMachineReadAbi,
            functionName: "orderCreator",
            args: [planId, orderId]
          }),
          client.readContract({
            address: config.stateMachine,
            abi: stateMachineReadAbi,
            functionName: "orderRelayer",
            args: [planId, orderId]
          })
        ]);
        return { ok: true, value: { planExists, orderExists, creator, relayer } };
      } catch (error) {
        return { ok: false, failure: mapReadError(error, "读取订单事实失败") };
      }
    },

    async readEvents(planId, orderId) {
      try {
        const latest = await client.getBlockNumber();
        const logs: Log[] = [];
        const hookLogs: { readonly raw: StateMachineRawLog; readonly blockHash: Hex }[] = [];
        for (const range of logChunkRanges(config.fromBlock, latest, config.chunkSize)) {
          for (const event of chainEvents) {
            const chunk = await client.getLogs({
              address: config.stateMachine,
              event,
              args: { planId, orderId },
              fromBlock: range.from,
              toBlock: range.to
            });
            logs.push(...chunk);
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
            } catch {
              // 时间戳读不到不影响事实本身：页面显示“时间未知”。
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

export async function submitSignal(
  config: ChainConfig,
  connection: WalletConnection,
  call: SubmitStateMachineSignalCall
): Promise<ChainResult<{ readonly txHash: Hex }>> {
  if (call.chainId !== config.chainId) {
    return {
      ok: false,
      failure: { code: "chain_mismatch", message: `构造 call 的链 ID ${call.chainId} 与配置 ${config.chainId} 不一致` }
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
    return { ok: false, failure: { code: mapped.code, message: mapped.message } };
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
    return { ok: false, failure: { code: mapped.code, message: mapped.message } };
  }

  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { ok: false, failure: receiptRevertedFailure(hash) };
    }
    return { ok: true, value: { txHash: hash } };
  } catch (error) {
    const mapped = mapWalletError(error);
    return { ok: false, failure: { code: mapped.code, message: mapped.message, txHash: hash } };
  }
}

export function receiptRevertedFailure(txHash: Hex): ChainFailure {
  return { code: "reverted", message: "交易已上链但回执状态是 reverted", txHash };
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
    message: `${prefix}：${mapped.message}`
  };
}
