// 签名端口：只做「连接地址 → 校验链 → eth_signTypedData_v4」；域/条款校验由
// kernel（verifyInviteAcceptTypedData / verifyOrderFinalizeTypedData）在签名前完成，
// 本模块不接触私钥，也不在失败时自动重试。

import { getBrowserEthereumProvider } from "@uvp-eth/uvp-client/browser";

export type SigningErrorCode =
  | "missing_wallet"
  | "wallet_rejected"
  | "wrong_chain"
  | "invalid_signature";

export class SigningError extends Error {
  override readonly name = "SigningError";
  readonly code: SigningErrorCode;

  constructor(code: SigningErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export async function requestWalletAddressKernel(): Promise<string> {
  const provider = getBrowserEthereumProvider();
  if (!provider) {
    throw new SigningError("missing_wallet", "未发现浏览器钱包，无法签名。");
  }
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const address = Array.isArray(accounts)
      ? accounts.find((item): item is string => typeof item === "string" && /^0x[0-9a-fA-F]{40}$/u.test(item))
      : undefined;
    if (!address) {
      throw new SigningError("missing_wallet", "钱包没有返回可用地址。");
    }
    return address;
  } catch (error) {
    if (error instanceof SigningError) {
      throw error;
    }
    if (isUserRejection(error)) {
      throw new SigningError("wallet_rejected", "你取消了钱包连接。");
    }
    throw new SigningError("missing_wallet", errorMessage(error));
  }
}

export async function signTypedDataKernel(
  typedData: { readonly domain: { readonly chainId: number } },
  address: string
): Promise<`0x${string}`> {
  const provider = getBrowserEthereumProvider();
  if (!provider) {
    throw new SigningError("missing_wallet", "未发现浏览器钱包，无法签名。");
  }
  const chainIdHex = await provider.request({ method: "eth_chainId" }).catch((error: unknown) => {
    throw new SigningError("missing_wallet", `读取钱包当前链失败：${errorMessage(error)}`);
  });
  const actual = typeof chainIdHex === "string" && /^0x[0-9a-fA-F]+$/u.test(chainIdHex)
    ? Number.parseInt(chainIdHex, 16)
    : Number.NaN;
  if (!Number.isSafeInteger(actual) || actual <= 0) {
    throw new SigningError("wrong_chain", "钱包没有返回可识别的链 ID。");
  }
  if (actual !== typedData.domain.chainId) {
    throw new SigningError(
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
      throw new SigningError("invalid_signature", "钱包没有返回合法的 65 字节签名。");
    }
    return signature as `0x${string}`;
  } catch (error) {
    if (error instanceof SigningError) {
      throw error;
    }
    if (isUserRejection(error)) {
      throw new SigningError("wallet_rejected", "钱包取消了本次签名，未提交任何请求。");
    }
    throw new SigningError("invalid_signature", errorMessage(error));
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
