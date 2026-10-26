// 钱包签名的公有类型面：EIP-712 信封、连接器目标与域预期。浏览器注入钱包
// 的具体实现留在宿主适配层；本模块只定义可被任意宿主实现的接口与失败类。

import type { ProductSubmitTypedData } from "@uvp-eth/protocol-bindings";
import type { Eip1193Provider } from "./provider";

export type WalletTarget = "evm" | "solana";

export class UnsupportedWalletTargetError extends Error {
  constructor(readonly target: WalletTarget) {
    super(`${target} wallet connector is reserved but not implemented`);
    this.name = "UnsupportedWalletTargetError";
  }
}

export type GenericTypedData = Readonly<{
  readonly domain: Readonly<Record<string, unknown>>;
  readonly types: Readonly<Record<string, readonly { readonly name: string; readonly type: string }[]>>;
  readonly primaryType: string;
  readonly message: Readonly<Record<string, unknown>>;
}>;

/**
 * 域校验预期：chainId/verifyingContract 是部署参数（随 prepare 的 typedData
 * 下发），调用方有独立来源时提供，签名前严格比对。
 */
export interface TypedDataDomainExpectation {
  readonly chainId?: number | undefined;
  readonly verifyingContract?: string | undefined;
}

export interface WalletConnector {
  readonly target: WalletTarget;
  signProductSubmit(input: {
    readonly typedData: ProductSubmitTypedData;
    readonly walletAddress: string;
    readonly provider?: Eip1193Provider;
    readonly expected?: TypedDataDomainExpectation | undefined;
    readonly preparedSubmitters?: readonly (string | undefined)[] | undefined;
  }): Promise<`0x${string}`>;
  signTypedData(input: {
    readonly typedData: GenericTypedData;
    readonly walletAddress: string;
    readonly provider?: Eip1193Provider;
    readonly expected?: TypedDataDomainExpectation | undefined;
    readonly preparedSubmitters?: readonly (string | undefined)[] | undefined;
  }): Promise<`0x${string}`>;
}

export function walletConnectorFor<C>(target: WalletTarget, evmConnector: C): C {
  switch (target) {
    case "evm":
      return evmConnector;
    case "solana":
      throw new UnsupportedWalletTargetError("solana");
  }
}
