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
import {
  isUserRejectedRequestError,
  validateTypedDataForSigning,
  type TypedDataSigningMismatchReason
} from "@uvp-eth/protocol-bindings";

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
 * 常量从 protocol-bindings 取，禁止本地漂移。判定逻辑（域四要素、
 * types 字段表、签名者与预期/prepared 记录交叉核对）同样单源于
 * protocol-bindings validateTypedDataForSigning；本文件只保留
 * "primaryType 必须在协议允许集内"的锚定与面向参与者的拒绝文案。
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
    if (isUserRejectedRequestError(error)) {
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
    if (isUserRejectedRequestError(error)) {
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
  /**
   * prepare 记录声明的提交方（prepared.submitter）：参与签名前交叉核对，
   * 防被攻陷 BFF 用别的 principal 的 prepared 信封换签名对象（三端
   * 签名闸门最强集的一员，此前 order-app 缺失）。undefined 条目跳过。
   */
  readonly preparedSubmitters?: readonly (string | undefined)[] | undefined;
}): Promise<`0x${string}`> {
  const provider = input.provider ?? getInjectedWalletProvider();
  if (!provider) {
    throw new InjectedWalletError("missing_wallet", "未检测到浏览器钱包，不能创建业务签名。");
  }
  // executor-kit 只核对 submitter 一致性；域与结构在这里补齐同一签名边界。
  assertTypedDataEnvelopeMatchesProtocol(
    input.typedData,
    input.walletAddress,
    input.expected,
    input.preparedSubmitters
  );
  await ensureCurrentChainMatchesDomain(provider, input.typedData);

  try {
    return await requestProductSubmitSignature(provider, input.typedData, input.walletAddress);
  } catch (error) {
    if (error instanceof InjectedWalletError) {
      throw error;
    }
    if (isUserRejectedRequestError(error)) {
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
  /** 同 signProductSubmit：prepare 记录声明的提交方交叉核对，可选。 */
  readonly preparedSubmitters?: readonly (string | undefined)[] | undefined;
}): Promise<`0x${string}`> {
  const provider = input.provider ?? getInjectedWalletProvider();
  if (!provider) {
    throw new InjectedWalletError("missing_wallet", "未检测到浏览器钱包，不能创建业务签名。");
  }
  const signer = input.walletAddress.trim();
  if (!signer) {
    throw new InjectedWalletError("wallet_signature_failed", "缺少签名钱包。");
  }
  assertTypedDataEnvelopeMatchesProtocol(input.typedData, signer, input.expected, input.preparedSubmitters);
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
    if (isUserRejectedRequestError(error)) {
      throw new InjectedWalletError("wallet_rejected", "钱包签名被拒绝，未创建提交。");
    }
    throw new InjectedWalletError(
      "wallet_signature_failed",
      error instanceof Error ? error.message : "钱包签名失败。"
    );
  }
}

/**
 * 签名前校验 typedData 的域与结构：primaryType 必须是协议信封之一（本地
 * 锚定的允许集），其余判定——domain 四要素（name/version 恒比对，
 * chainId/verifyingContract 提供预期时严格比对）、types 字段表非空、
 * message 签名者（submitter/selector）与本次签名钱包及 prepared 记录
 * 声明的提交方一致——单源消费 protocol-bindings validateTypedDataForSigning
 * （三端签名闸门的最强集，治理审计 §1.1 P1-1 安全面）。任何不一致都在
 * 调钱包前拒绝；判定只返回 reason，面向参与者的文案由本宿主映射。
 */
export function assertTypedDataEnvelopeMatchesProtocol(
  typedData: unknown,
  walletAddress: string,
  expected?: TypedDataDomainExpectation | undefined,
  preparedSubmitters?: readonly (string | undefined)[] | undefined
): void {
  const primaryType = primaryTypeOf(typedData);
  const expectation = envelopeExpectations[primaryType];
  if (!expectation) {
    throw mismatch(`primaryType ${primaryType || "(缺失)"} 不在协议支持的签名类型内`);
  }

  const check = validateTypedDataForSigning(typedData, {
    primaryType,
    domainName: expectation.domainName,
    domainVersion: expectation.domainVersion,
    ...(expected?.chainId !== undefined ? { chainId: expected.chainId } : {}),
    ...(expected?.verifyingContract !== undefined ? { verifyingContract: expected.verifyingContract } : {}),
    submitter: walletAddress,
    submitterField: expectation.signerField,
    ...(preparedSubmitters ? { preparedSubmitters } : {})
  });
  if (!check.ok) {
    throw mismatch(envelopeMismatchReasonText(check.reason, check.detail, expectation, expected, primaryType));
  }
}

function primaryTypeOf(typedData: unknown): string {
  if (typeof typedData !== "object" || typedData === null) {
    return "";
  }
  const primaryType = (typedData as { readonly primaryType?: unknown }).primaryType;
  return typeof primaryType === "string" ? primaryType : "";
}

/**
 * protocol-bindings 判定 reason → 本宿主拒绝文案：判定语义单源、文案留
 * 宿主（"页面/角色文案不共享"受控项）。detail 为被拒时的关键事实值。
 */
function envelopeMismatchReasonText(
  reason: TypedDataSigningMismatchReason,
  detail: string | undefined,
  expectation: TypedDataEnvelopeExpectation,
  expected: TypedDataDomainExpectation | undefined,
  primaryType: string
): string {
  switch (reason) {
    case "not-typed-data":
      return "签名对象不是 EIP-712 结构";
    case "primary-type":
      return `primaryType ${detail ?? "(缺失)"} 不在协议支持的签名类型内`;
    case "primary-type-fields":
      return `types 中缺少 ${primaryType} 的字段定义`;
    case "domain-shape":
      return "签名对象缺少有效 domain";
    case "domain-name":
      return `domain.name ${detail ?? "(缺失)"} 与协议 ${expectation.domainName} 不一致`;
    case "domain-version":
      return `domain.version ${detail ?? "(缺失)"} 与协议 ${expectation.domainVersion} 不一致`;
    case "domain-chain-id":
      return expected?.chainId !== undefined
        ? `domain.chainId ${detail ?? "(缺失)"} 与预期 ${expected.chainId} 不一致`
        : `domain.chainId ${detail ?? "(缺失)"} 不是有效链 ID`;
    case "domain-verifying-contract":
      return expected?.verifyingContract !== undefined
        ? `domain.verifyingContract ${detail ?? "(缺失)"} 与预期 ${expected.verifyingContract} 不一致`
        : "domain.verifyingContract 缺失或不是有效地址";
    case "message-shape":
      return "签名对象缺少有效 message";
    case "signer-field":
      return `message.${expectation.signerField} 缺失或不是有效地址`;
    case "signer-not-connected":
      return `message.${expectation.signerField} 与当前连接钱包不一致`;
    case "signer-not-expected":
      return `message.${expectation.signerField} 与本次签名钱包不一致`;
    case "signer-not-prepared":
      return `message.${expectation.signerField} 与 prepare 记录声明的提交方 ${detail ?? ""}不一致`;
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
    if (isUserRejectedRequestError(error)) {
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

function mismatch(reason: string): InjectedWalletError {
  return new InjectedWalletError("typed_data_mismatch", `签名内容与协议信封不符，已拒绝签名：${reason}`);
}

function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value);
}
