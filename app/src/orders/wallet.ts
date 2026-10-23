import {
  isUserRejectedRequestError,
  PRODUCT_SUBMIT_DOMAIN_NAME,
  PRODUCT_SUBMIT_DOMAIN_VERSION,
  TRIGGER_ORDER_FROM_OUTSIDE_PRIMARY_TYPE,
  validateTypedDataForSigning
} from "@uvp-eth/protocol-bindings";
import type { Eip712TypedDataDTO } from "../api/productApi";
import { ChainWalletError } from "../shared/chain/wallet/errors";
import { connectWalletAddress } from "../shared/chain/wallet/connect";
import { getBrowserEthereumProvider } from "../shared/chain/wallet/provider";
import {
  assertTypedDataEnvelopeMatches,
  ensureCurrentChainMatchesDomain,
  requestTypedDataSignature,
  type TypedDataMismatchTexts,
  type WalletPorts
} from "../shared/chain/wallet/typed-data";
import { submitSignExpectation } from "../tasks/model/taskUtils";
import { InjectedWalletError } from "../wallet/injectedWallet";


const walletPorts: WalletPorts = {
  isUserRejectedRequestError,
  validateTypedDataEnvelope: validateTypedDataForSigning
};

const mismatchTexts: TypedDataMismatchTexts = {
  missingDetail: "(缺失)",
  notTypedData: "确认对象不是可核对的确认内容",
  messageShape: "确认对象缺少有效内容",
  domainShape: "确认对象缺少有效的确认范围",
  primaryType: (fact) => `确认类型 ${fact} 不在支持的范围内`,
  primaryTypeFields: () => "确认对象缺少类型字段定义",
  domainName: (fact, expectation) => `确认范围 ${fact} 与约定 ${expectation.domainName} 不一致`,
  domainVersion: (fact, expectation) => `确认版本 ${fact} 与约定 ${expectation.domainVersion ?? ""} 不一致`,
  domainChainId: (fact, expectation) =>
    expectation.chainId !== undefined
      ? `确认环境 ${fact} 与约定 ${expectation.chainId} 不一致`
      : `确认环境 ${fact} 无效`,
  domainVerifyingContract: (fact, expectation) =>
    expectation.verifyingContract !== undefined
      ? `确认对象指向的部署 ${fact} 与约定 ${expectation.verifyingContract} 不一致`
      : "确认对象缺少有效的部署地址",
  signerField: (signerField) => `确认人字段 ${signerField} 缺失或不是有效身份`,
  signerNotConnected: (signerField) => `确认人 ${signerField} 与当前身份不一致`,
  signerNotExpected: (signerField) => `确认人 ${signerField} 与本次确认身份不一致`,
  signerNotPrepared: (signerField, fact) => `确认人 ${signerField} 与服务端记录的确认身份 ${fact} 不一致`
};

export interface OrderTriggerSignExpectation {
  readonly verifyingContract: string;
  readonly chainId?: number | undefined;
}

export function orderTriggerSignExpectation(): OrderTriggerSignExpectation {
  const { expected } = submitSignExpectation();
  return {
    verifyingContract: expected.verifyingContract,
    ...(expected.chainId !== undefined ? { chainId: expected.chainId } : {})
  };
}

export async function requestCreateOrderWalletAddress(): Promise<string> {
  try {
    return await connectWalletAddress({
      provider: getBrowserEthereumProvider(),
      ports: walletPorts,
      invalidAccountCode: "wallet_signature_failed",
      invalidAccountDetail: "没有获取到可用的确认身份。",
      unknownErrorMode: "wrap_signature_failed"
    });
  } catch (error) {
    throw toInjectedWalletError(error, "连接确认工具失败。");
  }
}

export async function signOrderTriggerWithInjectedWallet(input: {
  readonly typedData: Eip712TypedDataDTO;
  readonly walletAddress: string;
  readonly expected: OrderTriggerSignExpectation;
  readonly preparedSubmitters?: readonly (string | undefined)[] | undefined;
}): Promise<string> {
  const provider = getBrowserEthereumProvider();
  if (!provider) {
    throw new InjectedWalletError("missing_wallet", "未检测到可用的身份确认工具，无法创建订单。");
  }
  const signer = input.walletAddress.trim();
  if (!signer) {
    throw new InjectedWalletError("wallet_signature_failed", "缺少本次确认使用的身份。");
  }
  assertOrderTriggerEnvelope(input.typedData, signer, input.expected, input.preparedSubmitters);
  try {
    await ensureCurrentChainMatchesDomain(provider, input.typedData, {
      ports: walletPorts,
      chainIdReadErrorMode: { kind: "wrap", readFailureFallback: "读取当前确认环境失败。" }
    });
  } catch (error) {
    throw toInjectedWalletError(error, "确认环境核对失败。");
  }
  try {
    return await requestTypedDataSignature(provider, signer, input.typedData, {
      ports: walletPorts,
      texts: mismatchTexts,
      invalidSignatureDetail: "确认工具返回了无效的确认结果",
      signatureErrorMode: "wrap_signature_failed"
    });
  } catch (error) {
    throw toInjectedWalletError(error, "本人确认没有完成。");
  }
}

export function assertOrderTriggerEnvelope(
  typedData: Eip712TypedDataDTO,
  walletAddress: string,
  expected: OrderTriggerSignExpectation,
  preparedSubmitters?: readonly (string | undefined)[] | undefined
): void {
  try {
    assertTypedDataEnvelopeMatches(
      typedData,
      {
        primaryType: TRIGGER_ORDER_FROM_OUTSIDE_PRIMARY_TYPE,
        domainName: PRODUCT_SUBMIT_DOMAIN_NAME,
        domainVersion: PRODUCT_SUBMIT_DOMAIN_VERSION,
        ...(expected.chainId !== undefined ? { chainId: expected.chainId } : {}),
        verifyingContract: expected.verifyingContract,
        submitter: walletAddress,
        submitterField: "submitter",
        ...(preparedSubmitters ? { preparedSubmitters } : {})
      },
      walletPorts,
      mismatchTexts
    );
  } catch (error) {
    throw toInjectedWalletError(error, "确认内容核对失败。");
  }
}

function toInjectedWalletError(error: unknown, fallback: string): InjectedWalletError {
  if (error instanceof InjectedWalletError) {
    return error;
  }
  if (error instanceof ChainWalletError) {
    switch (error.code) {
      case "missing_wallet":
        return new InjectedWalletError("missing_wallet", "未检测到可用的身份确认工具，无法创建订单。");
      case "wallet_rejected":
        return new InjectedWalletError("wallet_rejected", "你取消了本次本人确认，订单未创建。");
      case "typed_data_mismatch":
        return new InjectedWalletError("typed_data_mismatch", error.message);
      default:
        return new InjectedWalletError("wallet_signature_failed", error.message || fallback);
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return new InjectedWalletError("wallet_signature_failed", error.message);
  }
  return new InjectedWalletError("wallet_signature_failed", fallback);
}
