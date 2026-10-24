// 托管合约配置：StageEscrow 部署地址与链 ID 只来自构建期环境变量
// （VITE_UVP_ESCROW_ADDRESS / VITE_UVP_ESCROW_CHAIN_ID），不硬编码任何
// 主网/测试网地址；未配置或形状不合法时返回可展示的失败原因，页面据此
// 精确提示“读取可用、动作不可用”。金额小数位按 V2 固定 6（USDT）。

export interface EscrowContractConfig {
  readonly address: `0x${string}`;
  readonly chainId: number;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
}

export type EscrowConfigResolution =
  | { readonly ok: true; readonly config: EscrowContractConfig }
  | { readonly ok: false; readonly message: string };

export interface EscrowConfigSource {
  readonly VITE_UVP_ESCROW_ADDRESS?: string | undefined;
  readonly VITE_UVP_ESCROW_CHAIN_ID?: string | undefined;
  readonly VITE_UVP_ESCROW_TOKEN_SYMBOL?: string | undefined;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const DECIMAL_PATTERN = /^\d+$/u;

export function resolveEscrowConfig(source: EscrowConfigSource): EscrowConfigResolution {
  const address = source.VITE_UVP_ESCROW_ADDRESS?.trim();
  const chainIdRaw = source.VITE_UVP_ESCROW_CHAIN_ID?.trim();
  if (!address && !chainIdRaw) {
    return {
      ok: false,
      message: "托管合约未配置：缺少构建期环境变量 VITE_UVP_ESCROW_ADDRESS 与 VITE_UVP_ESCROW_CHAIN_ID。"
    };
  }
  if (!address) {
    return {
      ok: false,
      message: "托管合约未配置：缺少构建期环境变量 VITE_UVP_ESCROW_ADDRESS。"
    };
  }
  if (!ADDRESS_PATTERN.test(address)) {
    return {
      ok: false,
      message: `托管合约地址不是合法 EVM 地址（VITE_UVP_ESCROW_ADDRESS="${address}"）。`
    };
  }
  if (!chainIdRaw) {
    return {
      ok: false,
      message: "托管合约未配置：缺少构建期环境变量 VITE_UVP_ESCROW_CHAIN_ID。"
    };
  }
  if (!DECIMAL_PATTERN.test(chainIdRaw)) {
    return {
      ok: false,
      message: `托管合约链 ID 必须是十进制正整数（VITE_UVP_ESCROW_CHAIN_ID="${chainIdRaw}"）。`
    };
  }
  const chainId = Number(chainIdRaw);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return {
      ok: false,
      message: `托管合约链 ID 不是有效正整数（VITE_UVP_ESCROW_CHAIN_ID="${chainIdRaw}"）。`
    };
  }
  const symbol = source.VITE_UVP_ESCROW_TOKEN_SYMBOL?.trim() || "USDT";
  return {
    ok: true,
    config: {
      address: address as `0x${string}`,
      chainId,
      tokenSymbol: symbol,
      tokenDecimals: 6
    }
  };
}

export function readRuntimeEscrowConfig(): EscrowConfigResolution {
  return resolveEscrowConfig({
    VITE_UVP_ESCROW_ADDRESS: import.meta.env?.VITE_UVP_ESCROW_ADDRESS,
    VITE_UVP_ESCROW_CHAIN_ID: import.meta.env?.VITE_UVP_ESCROW_CHAIN_ID,
    VITE_UVP_ESCROW_TOKEN_SYMBOL: import.meta.env?.VITE_UVP_ESCROW_TOKEN_SYMBOL
  });
}
