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
  isUserRejectedRequestError,
  validateTypedDataForSigning,
  type ProductSubmitTypedData
} from "@uvp-eth/protocol-bindings";
import { requestProductSubmitSignature } from "@uvp-eth/executor-kit/participant";
import {
  getBrowserEthereumProvider,
  InjectedWalletError,
  UnsupportedWalletTargetError,
  walletConnectorFor,
  type Eip1193Provider,
  type GenericTypedData,
  type TypedDataDomainExpectation,
  type WalletConnector,
  type WalletTarget
} from "@uvp-eth/order-kernel/wallet";
import { connectWalletAddress, personalSignWithProvider } from "../shared/chain/wallet/connect";
import { ChainWalletError } from "../shared/chain/wallet/errors";
import type { WalletErrorCode } from "../shared/chain/wallet/errors";
import {
  assertTypedDataEnvelopeMatches,
  ensureCurrentChainMatchesDomain,
  requestTypedDataSignature
} from "../shared/chain/wallet/typed-data";
import type { TypedDataMismatchTexts } from "../shared/chain/wallet/typed-data";

export type { Eip1193Provider, ProductSubmitTypedData };
export type { GenericTypedData, TypedDataDomainExpectation, WalletConnector, WalletTarget };
export { UnsupportedWalletTargetError, InjectedWalletError };

declare global {
  interface Window {
    readonly ethereum?: Eip1193Provider;
  }
}

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

const walletPorts = {
  isUserRejectedRequestError,
  validateTypedDataEnvelope: validateTypedDataForSigning
} as const;

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
        missingWallet: "未发现浏览器钱包。",
        rejected: "连接钱包被拒绝。",
        failedFallback: "连接钱包失败。"
      });
    }
    throw error;
  }
}

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
        missingWallet: "未发现浏览器钱包，不能完成会话签名。",
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
  readonly preparedSubmitters?: readonly (string | undefined)[] | undefined;
}): Promise<`0x${string}`> {
  const provider = input.provider ?? getInjectedWalletProvider();
  if (!provider) {
    throw new InjectedWalletError("missing_wallet", "未发现浏览器钱包，不能创建业务签名。");
  }
  const signer = input.walletAddress.trim();
  if (!signer) {
    throw new InjectedWalletError("wallet_signature_failed", "缺少签名钱包。");
  }
  assertTypedDataEnvelopeMatchesProtocol(
    input.typedData,
    signer,
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
        missingWallet: "未发现浏览器钱包，不能创建业务签名。",
        rejected: "钱包签名被拒绝，未创建提交。",
        failedFallback: "钱包签名失败。"
      });
    }
    throw error;
  }

  try {
    return await requestProductSubmitSignature(provider, input.typedData, signer);
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
  readonly preparedSubmitters?: readonly (string | undefined)[] | undefined;
}): Promise<`0x${string}`> {
  const provider = input.provider ?? getInjectedWalletProvider();
  if (!provider) {
    throw new InjectedWalletError("missing_wallet", "未发现浏览器钱包，不能创建业务签名。");
  }
  const signer = input.walletAddress.trim();
  if (!signer) {
    throw new InjectedWalletError("wallet_signature_failed", "缺少签名钱包。");
  }
  assertTypedDataEnvelopeMatchesProtocol(input.typedData, signer, input.expected, input.preparedSubmitters);
  try {
    await ensureCurrentChainMatchesDomain(provider, input.typedData, {
      ports: walletPorts,
      chainIdReadErrorMode: { kind: "wrap", readFailureFallback: "读取钱包当前链失败。" }
    });
    return await requestTypedDataSignature(provider, signer, input.typedData, {
      ports: walletPorts,
      texts: orderAppMismatchTexts,
      invalidSignatureDetail: "wallet returned an invalid hex signature",
      signatureErrorMode: "wrap_signature_failed"
    });
  } catch (error) {
    if (error instanceof ChainWalletError) {
      throw mapChainWalletError(error, {
        missingWallet: "未发现浏览器钱包，不能创建业务签名。",
        rejected: "钱包签名被拒绝，未创建提交。",
        failedFallback: "钱包签名失败。"
      });
    }
    throw error;
  }
}

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
