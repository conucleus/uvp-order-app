import {
  requestProductSubmitSignature,
  type Eip1193Provider,
  type ProductSubmitTypedData
} from "@uvp-eth/executor-kit/participant";

export type { Eip1193Provider, ProductSubmitTypedData };

export type GenericTypedData = Readonly<{
  readonly domain: Readonly<Record<string, unknown>>;
  readonly types: Readonly<Record<string, readonly { readonly name: string; readonly type: string }[]>>;
  readonly primaryType: string;
  readonly message: Readonly<Record<string, unknown>>;
}>;

declare global {
  interface Window {
    readonly ethereum?: Eip1193Provider;
  }
}

export class InjectedWalletError extends Error {
  override readonly name = "InjectedWalletError";

  constructor(
    readonly code: "missing_wallet" | "wallet_rejected" | "wallet_signature_failed",
    message: string
  ) {
    super(message);
  }
}

export function getInjectedWalletProvider(): Eip1193Provider | undefined {
  return typeof window === "undefined" ? undefined : window.ethereum;
}

export async function signProductSubmitWithInjectedWallet(input: {
  readonly typedData: ProductSubmitTypedData;
  readonly walletAddress: string;
  readonly provider?: Eip1193Provider;
}): Promise<`0x${string}`> {
  const provider = input.provider ?? getInjectedWalletProvider();
  if (!provider) {
    throw new InjectedWalletError("missing_wallet", "未检测到浏览器钱包，不能创建业务签名。");
  }

  try {
    return await requestProductSubmitSignature(provider, input.typedData, input.walletAddress);
  } catch (error) {
    if (isUserRejectedRequest(error)) {
      throw new InjectedWalletError("wallet_rejected", "钱包签名被拒绝，未创建提交。");
    }
    throw new InjectedWalletError(
      "wallet_signature_failed",
      error instanceof Error ? error.message : "钱包签名失败。"
    );
  }
}

export async function signTypedDataWithInjectedWallet(input: {
  readonly typedData: GenericTypedData;
  readonly walletAddress: string;
  readonly provider?: Eip1193Provider;
}): Promise<`0x${string}`> {
  const provider = input.provider ?? getInjectedWalletProvider();
  if (!provider) {
    throw new InjectedWalletError("missing_wallet", "未检测到浏览器钱包，不能创建业务签名。");
  }
  const signer = input.walletAddress.trim();
  if (!signer) {
    throw new InjectedWalletError("wallet_signature_failed", "缺少签名钱包。");
  }

  try {
    const signature = await provider.request({
      method: "eth_signTypedData_v4",
      params: [signer, JSON.stringify(input.typedData)]
    });
    if (typeof signature !== "string" || !signature.startsWith("0x")) {
      throw new Error("wallet returned an invalid hex signature");
    }
    return signature as `0x${string}`;
  } catch (error) {
    if (isUserRejectedRequest(error)) {
      throw new InjectedWalletError("wallet_rejected", "钱包签名被拒绝，未创建提交。");
    }
    throw new InjectedWalletError(
      "wallet_signature_failed",
      error instanceof Error ? error.message : "钱包签名失败。"
    );
  }
}

function isUserRejectedRequest(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { readonly code?: unknown; readonly message?: unknown };
  return candidate.code === 4001 || /reject|denied|cancel/i.test(String(candidate.message ?? ""));
}
