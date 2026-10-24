// 托管合约配置：StageEscrow 部署地址与链 ID 来自构建期环境变量
// （VITE_UVP_ESCROW_ADDRESS / VITE_UVP_ESCROW_CHAIN_ID）；纯解析在 kernel，
// 本文件只保留 app 的构建期 env 适配。

import { resolveEscrowConfig } from "@uvp-eth/order-kernel/escrow/config";

export {
  resolveEscrowConfig,
  type EscrowConfigResolution,
  type EscrowConfigSource,
  type EscrowContractConfig
} from "@uvp-eth/order-kernel/escrow/config";

export function readRuntimeEscrowConfig() {
  return resolveEscrowConfig({
    VITE_UVP_ESCROW_ADDRESS: import.meta.env?.VITE_UVP_ESCROW_ADDRESS,
    VITE_UVP_ESCROW_CHAIN_ID: import.meta.env?.VITE_UVP_ESCROW_CHAIN_ID,
    VITE_UVP_ESCROW_TOKEN_SYMBOL: import.meta.env?.VITE_UVP_ESCROW_TOKEN_SYMBOL
  });
}
