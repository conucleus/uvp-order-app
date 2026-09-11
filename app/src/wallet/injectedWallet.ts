import {
  PRODUCT_SUBMIT_DOMAIN_NAME,
  PRODUCT_SUBMIT_DOMAIN_VERSION,
  PRODUCT_SUBMIT_PRIMARY_TYPE,
  STAGE_EXECUTOR_PATCH_DOMAIN_NAME,
  STAGE_EXECUTOR_PATCH_DOMAIN_VERSION,
  STAGE_EXECUTOR_PATCH_PRIMARY_TYPE,
  STAGE_RESOURCE_PATCH_DOMAIN_NAME,
  STAGE_RESOURCE_PATCH_DOMAIN_VERSION,
  STAGE_RESOURCE_PATCH_PRIMARY_TYPE,
  requestProductSubmitSignature,
  type Eip1193Provider,
  type ProductSubmitTypedData
} from "@uvp-eth/executor-kit/participant";

export type { Eip1193Provider, ProductSubmitTypedData };
export type WalletTarget = "evm" | "solana";

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

/**
 * 每个协议 primaryType 对应的信封预期：domain、签名者字段名。
 * 常量从 protocol-bindings 取，禁止本地漂移。
 */
interface TypedDataEnvelopeExpectation {
  readonly domainName: string;
  readonly domainVersion: string;
  readonly signerField: string;
}

const envelopeExpectations: Readonly<Record<string, TypedDataEnvelopeExpectation>> = {
  [PRODUCT_SUBMIT_PRIMARY_TYPE]: {
    domainName: PRODUCT_SUBMIT_DOMAIN_NAME,
    domainVersion: PRODUCT_SUBMIT_DOMAIN_VERSION,
    signerField: "submitter"
  },
  [STAGE_EXECUTOR_PATCH_PRIMARY_TYPE]: {
    domainName: STAGE_EXECUTOR_PATCH_DOMAIN_NAME,
    domainVersion: STAGE_EXECUTOR_PATCH_DOMAIN_VERSION,
    signerField: "selector"
  },
  [STAGE_RESOURCE_PATCH_PRIMARY_TYPE]: {
    domainName: STAGE_RESOURCE_PATCH_DOMAIN_NAME,
    domainVersion: STAGE_RESOURCE_PATCH_DOMAIN_VERSION,
    signerField: "selector"
  }
};

export class InjectedWalletError extends Error {
  override readonly name = "InjectedWalletError";

  constructor(
    readonly code:
      | "missing_wallet"
      | "wallet_rejected"
      | "wallet_signature_failed"
      | "typed_data_mismatch",
    message: string
  ) {
    super(message);
  }
}

export class UnsupportedWalletTargetError extends Error {
  override readonly name = "UnsupportedWalletTargetError";

  constructor(readonly target: WalletTarget) {
    super(`${target} wallet connector is reserved but not implemented`);
  }
}

export interface WalletConnector {
  readonly target: WalletTarget;
  signProductSubmit(input: {
    readonly typedData: ProductSubmitTypedData;
    readonly walletAddress: string;
    readonly provider?: Eip1193Provider;
    readonly expected?: TypedDataDomainExpectation | undefined;
  }): Promise<`0x${string}`>;
  signTypedData(input: {
    readonly typedData: GenericTypedData;
    readonly walletAddress: string;
    readonly provider?: Eip1193Provider;
    readonly expected?: TypedDataDomainExpectation | undefined;
  }): Promise<`0x${string}`>;
}

/**
 * 域校验预期：chainId/verifyingContract 是部署参数（随 prepare 的 typedData
 * 下发），调用方有独立来源（如任务投影的 stateMachineAddress）时提供，
 * 签名前严格比对，防止被攻陷 BFF 让参与者对无效域签名。
 */
export interface TypedDataDomainExpectation {
  readonly chainId?: number | undefined;
  readonly verifyingContract?: string | undefined;
}

export function getInjectedWalletProvider(): Eip1193Provider | undefined {
  return typeof window === "undefined" ? undefined : window.ethereum;
}

/** 请求当前连接地址（eth_requestAccounts）：邀请 accept 的会话签名前先核对连接地址。 */
export async function requestInjectedWalletAddress(provider?: Eip1193Provider): Promise<string> {
  const resolved = provider ?? getInjectedWalletProvider();
  if (!resolved) {
    throw new InjectedWalletError("missing_wallet", "未检测到浏览器钱包。");
  }
  try {
    const accounts = await resolved.request({ method: "eth_requestAccounts" }) as unknown;
    const first = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof first !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(first)) {
      throw new InjectedWalletError("wallet_signature_failed", "钱包没有返回可用地址。");
    }
    return first;
  } catch (error) {
    if (error instanceof InjectedWalletError) {
      throw error;
    }
    if (isUserRejectedRequest(error)) {
      throw new InjectedWalletError("wallet_rejected", "连接钱包被拒绝。");
    }
    throw new InjectedWalletError(
      "wallet_signature_failed",
      error instanceof Error ? error.message : "连接钱包失败。"
    );
  }
}

/** 会话消息签名（personal_sign）：只证明地址控制权，不产生任何链上动作。 */
export async function personalSignWithInjectedWallet(input: {
  readonly address: string;
  readonly message: string;
  readonly provider?: Eip1193Provider;
}): Promise<string> {
  const provider = input.provider ?? getInjectedWalletProvider();
  if (!provider) {
    throw new InjectedWalletError("missing_wallet", "未检测到浏览器钱包，不能完成会话签名。");
  }
  try {
    const signature = await provider.request({
      method: "personal_sign",
      params: [input.message, input.address]
    });
    if (typeof signature !== "string" || !signature.startsWith("0x")) {
      throw new Error("wallet returned an invalid hex signature");
    }
    return signature;
  } catch (error) {
    if (error instanceof InjectedWalletError) {
      throw error;
    }
    if (isUserRejectedRequest(error)) {
      throw new InjectedWalletError("wallet_rejected", "钱包签名被拒绝，未创建会话。");
    }
    throw new InjectedWalletError(
      "wallet_signature_failed",
      error instanceof Error ? error.message : "会话签名失败。"
    );
  }
}

export async function signProductSubmitWithInjectedWallet(input: {
  readonly typedData: ProductSubmitTypedData;
  readonly walletAddress: string;
  readonly provider?: Eip1193Provider;
  readonly expected?: TypedDataDomainExpectation | undefined;
}): Promise<`0x${string}`> {
  const provider = input.provider ?? getInjectedWalletProvider();
  if (!provider) {
    throw new InjectedWalletError("missing_wallet", "未检测到浏览器钱包，不能创建业务签名。");
  }
  // executor-kit 只核对 submitter 一致性；域与结构在这里补齐同一签名边界。
  assertTypedDataEnvelopeMatchesProtocol(input.typedData, input.walletAddress, input.expected);
  await ensureCurrentChainMatchesDomain(provider, input.typedData);

  try {
    return await requestProductSubmitSignature(provider, input.typedData, input.walletAddress);
  } catch (error) {
    if (error instanceof InjectedWalletError) {
      throw error;
    }
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
  readonly expected?: TypedDataDomainExpectation | undefined;
}): Promise<`0x${string}`> {
  const provider = input.provider ?? getInjectedWalletProvider();
  if (!provider) {
    throw new InjectedWalletError("missing_wallet", "未检测到浏览器钱包，不能创建业务签名。");
  }
  const signer = input.walletAddress.trim();
  if (!signer) {
    throw new InjectedWalletError("wallet_signature_failed", "缺少签名钱包。");
  }
  assertTypedDataEnvelopeMatchesProtocol(input.typedData, signer, input.expected);
  await ensureCurrentChainMatchesDomain(provider, input.typedData);

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
    if (error instanceof InjectedWalletError) {
      throw error;
    }
    if (isUserRejectedRequest(error)) {
      throw new InjectedWalletError("wallet_rejected", "钱包签名被拒绝，未创建提交。");
    }
    throw new InjectedWalletError(
      "wallet_signature_failed",
      error instanceof Error ? error.message : "钱包签名失败。"
    );
  }
}

/**
 * 签名前校验 typedData 的域与结构：primaryType 必须是协议信封之一，
 * domain.name/version 与 protocol-bindings 常量一致，
 * domain.chainId/verifyingContract 提供预期时严格比对（部署参数，
 * 调用方从任务投影等独立来源取得），且 message 中的签名者字段
 * （submitter/selector）就是本次请求的签名钱包。
 * 与 executor-kit / zhixu-store 的签名闸门同一口径，任何不一致都在调钱包前拒绝。
 */
export function assertTypedDataEnvelopeMatchesProtocol(
  typedData: unknown,
  walletAddress: string,
  expected?: TypedDataDomainExpectation | undefined
): void {
  const record = requireRecord(typedData, "签名对象不是 EIP-712 结构");
  const primaryType = typeof record.primaryType === "string" ? record.primaryType : "";
  const expectation = envelopeExpectations[primaryType];
  if (!expectation) {
    throw mismatch(`primaryType ${primaryType || "(缺失)"} 不在协议支持的签名类型内`);
  }

  const domain = requireRecord(record.domain, "签名对象缺少有效 domain");
  if (domain.name !== expectation.domainName) {
    throw mismatch(`domain.name ${String(domain.name)} 与协议 ${expectation.domainName} 不一致`);
  }
  if (domain.version !== expectation.domainVersion) {
    throw mismatch(`domain.version ${String(domain.version)} 与协议 ${expectation.domainVersion} 不一致`);
  }
  const chainIdNumber = parseDomainChainId(domain.chainId);
  if (chainIdNumber === undefined) {
    throw mismatch(`domain.chainId ${String(domain.chainId)} 不是有效链 ID`);
  }
  if (expected?.chainId !== undefined && chainIdNumber !== expected.chainId) {
    throw mismatch(`domain.chainId ${chainIdNumber} 与预期 ${expected.chainId} 不一致`);
  }
  const verifyingContract = domain.verifyingContract;
  if (!isEvmAddress(verifyingContract)) {
    throw mismatch("domain.verifyingContract 缺失或不是有效地址");
  }
  if (expected?.verifyingContract !== undefined &&
    verifyingContract.toLowerCase() !== expected.verifyingContract.trim().toLowerCase()) {
    throw mismatch(`domain.verifyingContract ${verifyingContract} 与预期 ${expected.verifyingContract} 不一致`);
  }

  const types = requireRecord(record.types, "签名对象缺少有效 types");
  const primaryFields = types[primaryType];
  if (!Array.isArray(primaryFields) || primaryFields.length === 0) {
    throw mismatch(`types 中缺少 ${primaryType} 的字段定义`);
  }

  const message = requireRecord(record.message, "签名对象缺少有效 message");
  const signer = message[expectation.signerField];
  if (!isEvmAddress(signer)) {
    throw mismatch(`message.${expectation.signerField} 缺失或不是有效地址`);
  }
  if (signer.toLowerCase() !== walletAddress.trim().toLowerCase()) {
    throw mismatch(`message.${expectation.signerField} 与本次签名钱包不一致`);
  }
}

/**
 * 签名前至少核对钱包当前连接链与 domain.chainId 一致：否则被攻陷的
 * BFF 可以让参与者把签名签到另一条链的无效域上。
 */
async function ensureCurrentChainMatchesDomain(
  provider: Eip1193Provider,
  typedData: GenericTypedData | ProductSubmitTypedData
): Promise<void> {
  const domainChainId = parseDomainChainId((typedData as GenericTypedData).domain.chainId);
  if (domainChainId === undefined) {
    throw mismatch("domain.chainId 缺失，无法核对当前链");
  }
  let walletChainIdHex: unknown;
  try {
    walletChainIdHex = await provider.request({ method: "eth_chainId" });
  } catch (error) {
    if (isUserRejectedRequest(error)) {
      throw new InjectedWalletError("wallet_rejected", "钱包签名被拒绝，未创建提交。");
    }
    throw new InjectedWalletError(
      "wallet_signature_failed",
      error instanceof Error ? error.message : "读取钱包当前链失败。"
    );
  }
  const walletChainId = typeof walletChainIdHex === "string"
    ? Number.parseInt(walletChainIdHex, 16)
    : Number.NaN;
  if (walletChainId !== domainChainId) {
    throw mismatch(
      `钱包当前连接链 ${Number.isNaN(walletChainId) ? String(walletChainIdHex) : walletChainId} 与签名域 chainId ${domainChainId} 不一致，请切换到部署链后再签名`
    );
  }
}

function parseDomainChainId(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/u.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export const evmInjectedWalletConnector: WalletConnector = {
  target: "evm",
  signProductSubmit: signProductSubmitWithInjectedWallet,
  signTypedData: signTypedDataWithInjectedWallet
};

export function getWalletConnector(target: WalletTarget = "evm"): WalletConnector {
  switch (target) {
    case "evm":
      return evmInjectedWalletConnector;
    case "solana":
      throw new UnsupportedWalletTargetError("solana");
  }
}

function requireRecord(value: unknown, reason: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw mismatch(reason);
  }
  return value as Record<string, unknown>;
}

function mismatch(reason: string): InjectedWalletError {
  return new InjectedWalletError("typed_data_mismatch", `签名内容与协议信封不符，已拒绝签名：${reason}`);
}

function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value);
}

function isUserRejectedRequest(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { readonly code?: unknown; readonly message?: unknown };
  return candidate.code === 4001 || /reject|denied|cancel/i.test(String(candidate.message ?? ""));
}
