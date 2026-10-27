// 链上直连配置：VITE_UVP_STATE_MACHINE / VITE_CHAIN_ID / VITE_RPC_URL 严格校验；
// fromBlock 可配（缺省 0），日志分块大小内部默认 50k。缺/坏配置显式返回问题码，
// 不猜测默认链或合约地址。

import { isAddress } from "viem";

export interface ChainEnv {
  readonly VITE_UVP_STATE_MACHINE?: string | undefined;
  readonly VITE_CHAIN_ID?: string | undefined;
  readonly VITE_RPC_URL?: string | undefined;
  readonly VITE_UVP_FROM_BLOCK?: string | undefined;
}

export interface ChainConfig {
  readonly stateMachine: `0x${string}`;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly fromBlock: bigint;
  readonly chunkSize: bigint;
}

export type ChainConfigProblem =
  | "missing_state_machine"
  | "invalid_state_machine"
  | "missing_chain_id"
  | "invalid_chain_id"
  | "missing_rpc_url"
  | "invalid_rpc_url"
  | "invalid_from_block";

export type ChainConfigResult =
  | { readonly ok: true; readonly config: ChainConfig }
  | { readonly ok: false; readonly problem: ChainConfigProblem };

const DEFAULT_CHUNK_SIZE = 50_000n;

export function readChainConfig(env: ChainEnv): ChainConfigResult {
  const stateMachine = (env.VITE_UVP_STATE_MACHINE ?? "").trim();
  if (stateMachine === "") {
    return { ok: false, problem: "missing_state_machine" };
  }
  if (!isAddress(stateMachine, { strict: true })) {
    return { ok: false, problem: "invalid_state_machine" };
  }

  const chainIdRaw = (env.VITE_CHAIN_ID ?? "").trim();
  if (chainIdRaw === "") {
    return { ok: false, problem: "missing_chain_id" };
  }
  if (!/^[0-9]+$/u.test(chainIdRaw)) {
    return { ok: false, problem: "invalid_chain_id" };
  }
  const chainId = Number(chainIdRaw);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return { ok: false, problem: "invalid_chain_id" };
  }

  const rpcUrl = (env.VITE_RPC_URL ?? "").trim();
  if (rpcUrl === "") {
    return { ok: false, problem: "missing_rpc_url" };
  }
  if (!/^https?:\/\//iu.test(rpcUrl)) {
    return { ok: false, problem: "invalid_rpc_url" };
  }

  const fromBlockRaw = (env.VITE_UVP_FROM_BLOCK ?? "").trim();
  if (fromBlockRaw !== "" && !/^[0-9]+$/u.test(fromBlockRaw)) {
    return { ok: false, problem: "invalid_from_block" };
  }

  return {
    ok: true,
    config: {
      stateMachine: stateMachine as `0x${string}`,
      chainId,
      rpcUrl,
      fromBlock: fromBlockRaw === "" ? 0n : BigInt(fromBlockRaw),
      chunkSize: DEFAULT_CHUNK_SIZE
    }
  };
}

export function chainConfigProblemText(problem: ChainConfigProblem): string {
  switch (problem) {
    case "missing_state_machine":
      return "缺少 VITE_UVP_STATE_MACHINE：order-app 不猜测合约地址。";
    case "invalid_state_machine":
      return "VITE_UVP_STATE_MACHINE 不是合法 EVM 地址。";
    case "missing_chain_id":
      return "缺少 VITE_CHAIN_ID。";
    case "invalid_chain_id":
      return "VITE_CHAIN_ID 必须是正整数。";
    case "missing_rpc_url":
      return "缺少 VITE_RPC_URL（只读 RPC）。";
    case "invalid_rpc_url":
      return "VITE_RPC_URL 必须是 http(s) URL。";
    case "invalid_from_block":
      return "VITE_UVP_FROM_BLOCK 必须是非负整数（缺省 0）。";
    default:
      return "链配置无效。";
  }
}
