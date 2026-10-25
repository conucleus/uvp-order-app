// V3 签名端口：只做「连接地址 → 校验链 → eth_signTypedData_v4」；域/条款校验由
// kernel（verifyInviteAcceptTypedData / verifyOrderFinalizeTypedData）在签名前完成，
// 本模块不接触私钥，也不在失败时自动重试。

import { getBrowserEthereumProvider } from "@uvp-eth/order-kernel/wallet/provider";

export type V3SigningErrorCode =
  | "missing_wallet"
  | "wallet_rejected"
  | "wrong_chain"
  | "invalid_signature";

export class V3SigningError extends Error {
  override readonly name = "V3SigningError";
  readonly code: V3SigningErrorCode;

  constructor(code: V3SigningErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export async function requestV3WalletAddress(): Promise<string> {
  const provider = getBrowserEthereumProvider();
  if (!provider) {
    throw new V3SigningError("missing_wallet", "未检测到浏览器钱包，无法签名。");
  }
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const address = Array.isArray(accounts)
      ? accounts.find((item): item is string => typeof item === "string" && /^0x[0-9a-fA-F]{40}$/u.test(item))
      : undefined;
    if (!address) {
      throw new V3SigningError("missing_wallet", "钱包没有返回可用地址。");
    }
    return address;
  } catch (error) {
    if (error instanceof V3SigningError) {
      throw error;
    }
    if (isUserRejection(error)) {
      throw new V3SigningError("wallet_rejected", "你取消了钱包连接。");
    }
    throw new V3SigningError("missing_wallet", errorMessage(error));
  }
}

/** 签名 EIP-712 typed data；签名前核对钱包当前链 == domain.chainId（错链不签）。 */
export async function signV3TypedData(
  typedData: { readonly domain: { readonly chainId: number } },
  address: string
): Promise<`0x${string}`> {
  const provider = getBrowserEthereumProvider();
  if (!provider) {
    throw new V3SigningError("missing_wallet", "未检测到浏览器钱包，无法签名。");
  }
  const chainIdHex = await provider.request({ method: "eth_chainId" }).catch((error: unknown) => {
    throw new V3SigningError("missing_wallet", `读取钱包当前链失败：${errorMessage(error)}`);
  });
  const actual = typeof chainIdHex === "string" && /^0x[0-9a-fA-F]+$/u.test(chainIdHex)
    ? Number.parseInt(chainIdHex, 16)
    : Number.NaN;
  if (!Number.isSafeInteger(actual) || actual <= 0) {
    throw new V3SigningError("wrong_chain", "钱包没有返回可识别的链 ID。");
  }
  if (actual !== typedData.domain.chainId) {
    throw new V3SigningError(
      "wrong_chain",
      `钱包当前链 ${actual} 与签名域 chainId ${typedData.domain.chainId} 不一致，请先切换网络。`
    );
  }
  try {
    const signature = await provider.request({
      method: "eth_signTypedData_v4",
      params: [address, JSON.stringify(typedData)]
    });
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/u.test(signature)) {
      throw new V3SigningError("invalid_signature", "钱包没有返回合法的 65 字节签名。");
    }
    return signature as `0x${string}`;
  } catch (error) {
    if (error instanceof V3SigningError) {
      throw error;
    }
    if (isUserRejection(error)) {
      throw new V3SigningError("wallet_rejected", "钱包取消了本次签名，未提交任何请求。");
    }
    throw new V3SigningError("invalid_signature", errorMessage(error));
  }
}

function isUserRejection(error: unknown): boolean {
  const record = error as { readonly code?: unknown; readonly name?: unknown } | undefined;
  return record?.code === 4001
    || record?.code === "4001"
    || (typeof record?.name === "string" && record.name.includes("UserRejected"));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
