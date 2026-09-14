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
} from "@uvp-eth/protocol-bindings";
import { connectWalletAddress } from "../shared/chain/wallet/connect";
import { ChainWalletError } from "../shared/chain/wallet/errors";
import type { WalletErrorCode } from "../shared/chain/wallet/errors";
import { getBrowserEthereumProvider, walletConnectorFor } from "../shared/chain/wallet/provider";
import { UnsupportedWalletTargetError } from "../shared/chain/wallet/provider";
import {
  assertTypedDataEnvelopeMatches,
  ensureCurrentChainMatchesDomain,
  requestTypedDataSignature
} from "../shared/chain/wallet/sign-typed-data";
import type { TypedDataMismatchTexts } from "../shared/chain/wallet/mismatch";
import { personalSignWithProvider } from "../shared/chain/wallet/personal-sign";

export type { Eip1193Provider, ProductSubmitTypedData };
export type WalletTarget = "evm" | "solana";

export {
  /**
   * 目标链轨保留但未实现：fail-closed 抛错。类身份已上收 chain 轨单源
   * （两端 instanceof 同类），此处按原路径 re-export。
   */
  UnsupportedWalletTargetError
};

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

/**
 * 本端钱包内核 = chain 轨共享面 + protocol-bindings 端口注入（治理审计
 * §1.1 P1-1 的共享仓形态）：判定单源于 protocol-bindings（原函数注入），
 * 连接/链核对/签名请求的机械段与错误分类学（code 四类）在
 * shared/chain/wallet 单源；本端保留 InjectedWalletError 公开类与各调用
 * 点的面向参与者文案。
 */
const walletPorts = {
  isUserRejectedRequestError,
  validateTypedDataEnvelope: validateTypedDataForSigning
} as const;

/** 单源拒绝 reason → 本端拒绝文案（判定语义单源、文案留宿主；detail 为被拒时的关键事实值）。 */
const orderAppMismatchTexts: TypedDataMismatchTexts = {
  missingDetail: "(缺失)",
  notTypedData: "签名对象不是 EIP-712 结构",
  messageShape: "签名对象缺少有效 message",
  domainShape: "签名对象缺少有效 domain",
  primaryType: (fact) => `primaryType ${fact} 不在协议支持的签名类型内`,
  primaryTypeFields: (expectation) => `types 中缺少 ${expectation.primaryType} 的字段定义`,
  domainName: (fact, expectation) => `domain.name ${fact} 与协议 ${expectation.domainName} 不一致`,
  domainVersion: (fact, expectation) => `domain.version ${fact} 与协议 ${expectation.domainVersion} 不一致`,
  domainChainId: (fact, expectation) =>
    expectation.chainId !== undefined
      ? `domain.chainId ${fact} 与预期 ${expectation.chainId} 不一致`
      : `domain.chainId ${fact} 不是有效链 ID`,
  domainVerifyingContract: (fact, expectation) =>
    expectation.verifyingContract !== undefined
      ? `domain.verifyingContract ${fact} 与预期 ${expectation.verifyingContract} 不一致`
      : "domain.verifyingContract 缺失或不是有效地址",
  signerField: (signerField) => `message.${signerField} 缺失或不是有效地址`,
  signerNotConnected: (signerField) => `message.${signerField} 与当前连接钱包不一致`,
  signerNotExpected: (signerField) => `message.${signerField} 与本次签名钱包不一致`,
  signerNotPrepared: (signerField, fact) => `message.${signerField} 与 prepare 记录声明的提交方 ${fact}不一致`
};

/** 每个调用点的面向参与者文案（拒绝/失败兜底措辞按操作语境区分）。 */
interface WalletSiteTexts {
  readonly missingWallet: string;
  readonly rejected: string;
  readonly failedFallback: string;
}

function mapChainWalletError(error: ChainWalletError, texts: WalletSiteTexts): InjectedWalletError {
  const code = error.code as WalletErrorCode;
  switch (code) {
    case "missing_wallet":
      return new InjectedWalletError("missing_wallet", texts.missingWallet);
    case "wallet_rejected":
      return new InjectedWalletError("wallet_rejected", texts.rejected);
    case "typed_data_mismatch":
      return mismatch(error.message);
    default:
      return new InjectedWalletError("wallet_signature_failed", error.message || texts.failedFallback);
  }
}

function mismatch(reason: string): InjectedWalletError {
  return new InjectedWalletError("typed_data_mismatch", `签名内容与协议信封不符，已拒绝签名：${reason}`);
}

export function getInjectedWalletProvider(): Eip1193Provider | undefined {
  return getBrowserEthereumProvider();
}

/** 请求当前连接地址（eth_requestAccounts）：邀请 accept 的会话签名前先核对连接地址。 */
export async function requestInjectedWalletAddress(provider?: Eip1193Provider): Promise<string> {
  try {
    return await connectWalletAddress({
      provider: provider ?? getInjectedWalletProvider(),
      ports: walletPorts,
      invalidAccountCode: "wallet_signature_failed",
      invalidAccountDetail: "钱包没有返回可用地址。",
      unknownErrorMode: "wrap_signature_failed"
    });
  } catch (error) {
    if (error instanceof ChainWalletError) {
      throw mapChainWalletError(error, {
        missingWallet: "未检测到浏览器钱包。",
        rejected: "连接钱包被拒绝。",
        failedFallback: "连接钱包失败。"
      });
    }
    throw error;
  }
}

/** 会话消息签名（personal_sign）：只证明地址控制权，不产生任何链上动作。 */
export async function personalSignWithInjectedWallet(input: {
  readonly address: string;
  readonly message: string;
  readonly provider?: Eip1193Provider;
}): Promise<string> {
  try {
    return await personalSignWithProvider(
      { address: input.address, message: input.message },
      {
        provider: input.provider ?? getInjectedWalletProvider(),
        ports: walletPorts,
        unknownErrorMode: "wrap_signature_failed"
      }
    );
  } catch (error) {
    if (error instanceof ChainWalletError) {
      throw mapChainWalletError(error, {
        missingWallet: "未检测到浏览器钱包，不能完成会话签名。",
        rejected: "钱包签名被拒绝，未创建会话。",
        failedFallback: "会话签名失败。"
      });
    }
    throw error;
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
  try {
    await ensureCurrentChainMatchesDomain(provider, input.typedData, {
      ports: walletPorts,
      chainIdReadErrorMode: { kind: "wrap", readFailureFallback: "读取钱包当前链失败。" }
    });
  } catch (error) {
    if (error instanceof ChainWalletError) {
      throw mapChainWalletError(error, {
        missingWallet: "未检测到浏览器钱包，不能创建业务签名。",
        rejected: "钱包签名被拒绝，未创建提交。",
        failedFallback: "钱包签名失败。"
      });
    }
    throw error;
  }

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
  try {
    return await requestTypedDataSignature(provider, signer, input.typedData, {
      ports: walletPorts,
      texts: orderAppMismatchTexts,
      invalidSignatureDetail: "wallet returned an invalid hex signature",
      signatureErrorMode: "wrap_signature_failed"
    });
  } catch (error) {
    if (error instanceof ChainWalletError) {
      throw mapChainWalletError(error, {
        missingWallet: "未检测到浏览器钱包，不能创建业务签名。",
        rejected: "钱包签名被拒绝，未创建提交。",
        failedFallback: "钱包签名失败。"
      });
    }
    throw error;
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

  try {
    assertTypedDataEnvelopeMatches(
      typedData,
      {
        primaryType,
        domainName: expectation.domainName,
        domainVersion: expectation.domainVersion,
        ...(expected?.chainId !== undefined ? { chainId: expected.chainId } : {}),
        ...(expected?.verifyingContract !== undefined ? { verifyingContract: expected.verifyingContract } : {}),
        submitter: walletAddress,
        submitterField: expectation.signerField,
        ...(preparedSubmitters ? { preparedSubmitters } : {})
      },
      walletPorts,
      orderAppMismatchTexts
    );
  } catch (error) {
    if (error instanceof ChainWalletError && error.code === "typed_data_mismatch") {
      throw mismatch(error.message);
    }
    throw error;
  }
}

function primaryTypeOf(typedData: unknown): string {
  if (typeof typedData !== "object" || typedData === null) {
    return "";
  }
  const primaryType = (typedData as { readonly primaryType?: unknown }).primaryType;
  return typeof primaryType === "string" ? primaryType : "";
}

export const evmInjectedWalletConnector: WalletConnector = {
  target: "evm",
  signProductSubmit: signProductSubmitWithInjectedWallet,
  signTypedData: signTypedDataWithInjectedWallet
};

export function getWalletConnector(target: WalletTarget = "evm"): WalletConnector {
  return walletConnectorFor(target, evmInjectedWalletConnector);
}
