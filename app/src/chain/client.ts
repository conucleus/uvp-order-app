// 链上直连：公共 RPC 只读（order facts + 四类事实事件，fromBlock 可配、分块查询、
// 失败具名）；钱包写只走 submitSignal（不 relay、不代付、无 backend）。所有失败都
// 保留 code/message，不伪造空/成功。

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type Hex,
  type Log,
  type WalletClient
} from "viem";
import {
  chainEvents,
  uvpStateMachineAbi
} from "./abi";
import type { ChainConfig } from "./config";
import { decodeChainLogs, filterChainEvents, withTimestamps, type ChainEvent } from "./events";
import {
  mapWalletError,
  type Bytes32,
  type SignalArguments
} from "./input";

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
  readonly wallet: WalletClient;
  readonly chainId: number;
}

export function createChainReader(config: ChainConfig): ChainReader {
  const client = createPublicClient({ transport: http(config.rpcUrl) });

  return {
    async readOrder(planId, orderId) {
      try {
        const planExists = await client.readContract({
          address: config.stateMachine,
          abi: uvpStateMachineAbi,
          functionName: "planExists",
          args: [planId]
        });
        const orderExists = await client.readContract({
          address: config.stateMachine,
          abi: uvpStateMachineAbi,
          functionName: "orderExists",
          args: [planId, orderId]
        });
        if (!orderExists) {
          return { ok: true, value: { planExists, orderExists } };
        }
        const [creator, relayer] = await Promise.all([
          client.readContract({
            address: config.stateMachine,
            abi: uvpStateMachineAbi,
            functionName: "orderCreator",
            args: [planId, orderId]
          }),
          client.readContract({
            address: config.stateMachine,
            abi: uvpStateMachineAbi,
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
        }
        logs.sort((left, right) => {
          const leftBlock = left.blockNumber ?? 0n;
          const rightBlock = right.blockNumber ?? 0n;
          if (leftBlock === rightBlock) {
            return (left.logIndex ?? 0) - (right.logIndex ?? 0);
          }
          return leftBlock < rightBlock ? -1 : 1;
        });
        const decoded = decodeChainLogs(logs);
        if (!decoded.ok) {
          return { ok: false, failure: { code: "decode_failed", message: decoded.message } };
        }
        const filtered = filterChainEvents(decoded.events, planId, orderId);
        const timestamps = new Map<bigint, bigint>();
        const uniqueBlocks = [...new Set(filtered.map((event) => event.blockNumber))];
        await Promise.all(
          uniqueBlocks.map(async (blockNumber) => {
            try {
              const block = await client.getBlock({ blockNumber });
              timestamps.set(blockNumber, block.timestamp);
            } catch {
              // 时间戳读不到不影响事实本身：页面显式显示“时间未知”。
            }
          })
        );
        return { ok: true, value: withTimestamps(filtered, timestamps) };
      } catch (error) {
        return { ok: false, failure: mapReadError(error, "读取链上事件失败") };
      }
    }
  };
}

export async function connectWallet(config: ChainConfig): Promise<ChainResult<WalletConnection>> {
  const provider = (globalThis as { readonly ethereum?: unknown }).ethereum;
  if (provider === undefined) {
    return { ok: false, failure: { code: "no_wallet", message: "浏览器没有注入钱包（window.ethereum 不存在）" } };
  }
  try {
    const wallet = createWalletClient({
      transport: custom(provider as { request(args: { method: string; params?: unknown[] }): Promise<unknown> })
    });
    const [address] = await wallet.requestAddresses();
    if (address === undefined) {
      return { ok: false, failure: { code: "no_account", message: "钱包没有返回账户" } };
    }
    const chainId = await wallet.getChainId();
    if (chainId !== config.chainId) {
      return {
        ok: false,
        failure: {
          code: "wrong_chain",
          message: `钱包链 ID ${chainId} 与配置 ${config.chainId} 不一致；请先在钱包切换网络`
        }
      };
    }
    return { ok: true, value: { address, wallet, chainId } };
  } catch (error) {
    const mapped = mapWalletError(error);
    return { ok: false, failure: { code: mapped.code, message: mapped.message } };
  }
}

export async function submitSignal(
  config: ChainConfig,
  connection: WalletConnection,
  args: SignalArguments
): Promise<ChainResult<{ readonly txHash: Hex }>> {
  const publicClient = createPublicClient({ transport: http(config.rpcUrl) });
  const contractArgs = [
    args.planId,
    args.orderId,
    args.sourceId,
    args.signalId,
    args.payloadHash,
    args.idempotencyKey,
    {
      sourceId: args.attribution.sourceId,
      signalId: args.attribution.signalId,
      stageId: args.attribution.stageId,
      capabilityProof: [...args.attribution.capabilityProof]
    }
  ] as const;

  try {
    await publicClient.simulateContract({
      account: connection.address,
      address: config.stateMachine,
      abi: uvpStateMachineAbi,
      functionName: "submitSignal",
      args: contractArgs
    });
  } catch (error) {
    const mapped = mapWalletError(error);
    return { ok: false, failure: { code: mapped.code, message: mapped.message } };
  }

  let hash: Hex;
  try {
    hash = await connection.wallet.writeContract({
      account: connection.address,
      chain: null,
      address: config.stateMachine,
      abi: uvpStateMachineAbi,
      functionName: "submitSignal",
      args: contractArgs
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
  return { code: mapped.code === "unknown" ? "read_failed" : mapped.code, message: `${prefix}：${mapped.message}` };
}
