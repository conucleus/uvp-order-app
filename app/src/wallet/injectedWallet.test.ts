import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";
import {
  InjectedWalletError,
  UnsupportedWalletTargetError,
  getWalletConnector,
  signProductSubmitWithInjectedWallet,
  signTypedDataWithInjectedWallet,
  type Eip1193Provider,
  type GenericTypedData
} from "./injectedWallet.js";

const walletAddress = "0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f";
const typedData = buildProductSubmitTypedData({
  chainId: 31337,
  verifyingContract: "0x8888888888888888888888888888888888888888",
  orderId: "0x0101010101010101010101010101010101010101010101010101010101010101",
  sourceId: "0x0202020202020202020202020202020202020202020202020202020202020202",
  signalId: "0x0303030303030303030303030303030303030303030303030303030303030303",
  payloadHash: "0x0404040404040404040404040404040404040404040404040404040404040404",
  idempotencyKey: "0x0505050505050505050505050505050505050505050505050505050505050505",
  submitter: walletAddress,
  deadline: "1777777777"
});

const stagePatchTypedData: GenericTypedData = {
  domain: { name: "UVPStagePatchModule", version: "0.1", chainId: 31337, verifyingContract: "0x8888888888888888888888888888888888888888" },
  types: {
    UVPStagePatchModuleStageExecutorPatch: [
      { name: "orderId", type: "bytes32" },
      { name: "selector", type: "address" }
    ]
  },
  primaryType: "UVPStagePatchModuleStageExecutorPatch",
  message: { orderId: "0x0101", selector: walletAddress }
};

function acceptAllProvider(): Eip1193Provider {
  return {
    request: async ({ method }) => {
      // 桩 typedData 的 domain.chainId=31337（0x7a69）：签名前的当前链核对按此应答。
      if (method === "eth_chainId") {
        return "0x7a69";
      }
      return `0x${"aa".repeat(65)}`;
    }
  };
}

function wrongChainProvider(): Eip1193Provider {
  return {
    request: async ({ method }) => {
      if (method === "eth_chainId") {
        return "0x1";
      }
      return `0x${"aa".repeat(65)}`;
    }
  };
}

describe("injected wallet signing", () => {
  it("exposes an EVM connector and reserves Solana", () => {
    assert.equal(getWalletConnector().target, "evm");
    assert.throws(
      () => getWalletConnector("solana"),
      (error) => error instanceof UnsupportedWalletTargetError && error.target === "solana"
    );
  });

  it("requests a typed-data signature from the provided wallet after checking the current chain", async () => {
    const signature = `0x${"aa".repeat(65)}` as const;
    const requests: unknown[] = [];
    const provider: Eip1193Provider = {
      request: async (input) => {
        requests.push(input);
        if (input.method === "eth_chainId") {
          return "0x7a69";
        }
        return signature;
      }
    };

    const result = await signProductSubmitWithInjectedWallet({
      typedData,
      walletAddress,
      provider
    });

    assert.equal(result, signature);
    // 签名前先 eth_chainId 核对当前链，再发起 EIP-712 签名。
    assert.deepEqual(requests, [
      { method: "eth_chainId" },
      {
        method: "eth_signTypedData_v4",
        params: [walletAddress, JSON.stringify(typedData)]
      }
    ]);
  });

  it("refuses to sign when the wallet is connected to a different chain than the typed-data domain", async () => {
    await assert.rejects(
      signProductSubmitWithInjectedWallet({ typedData, walletAddress, provider: wrongChainProvider() }),
      (error) => error instanceof InjectedWalletError &&
        error.code === "typed_data_mismatch" &&
        /与签名域 chainId 31337 不一致/.test(error.message)
    );
  });

  it("refuses to sign when the domain differs from the expected state machine deployment", async () => {
    // 预期 verifyingContract 来自任务投影（stateMachineAddress）：
    // 域被攻陷 BFF 替换时必须在调钱包前拒绝。
    await assert.rejects(
      signProductSubmitWithInjectedWallet({
        typedData,
        walletAddress,
        provider: acceptAllProvider(),
        expected: { verifyingContract: "0x7777777777777777777777777777777777777777" }
      }),
      (error) => error instanceof InjectedWalletError &&
        error.code === "typed_data_mismatch" &&
        /domain\.verifyingContract .* 与预期 /.test(error.message)
    );
    // 期望一致（大小写不敏感）时放行。
    const signature = await signProductSubmitWithInjectedWallet({
      typedData,
      walletAddress,
      provider: acceptAllProvider(),
      expected: { chainId: 31337, verifyingContract: "0x8888888888888888888888888888888888888888".toUpperCase() }
    });
    assert.equal(signature, `0x${"aa".repeat(65)}`);
  });

  it("fails closed when no injected wallet exists", async () => {
    await assert.rejects(
      signProductSubmitWithInjectedWallet({ typedData, walletAddress }),
      (error) => error instanceof InjectedWalletError && error.code === "missing_wallet"
    );
  });

  it("normalizes user rejection into participant-facing copy", async () => {
    const provider: Eip1193Provider = {
      request: async () => {
        throw { code: 4001, message: "User rejected the request" };
      }
    };

    await assert.rejects(
      signProductSubmitWithInjectedWallet({ typedData, walletAddress, provider }),
      (error) => error instanceof InjectedWalletError && error.code === "wallet_rejected"
    );
  });
});

describe("typed-data envelope gate before signing", () => {
  it("signs stage patch typed data whose envelope matches the protocol", async () => {
    const signature = await signTypedDataWithInjectedWallet({
      typedData: stagePatchTypedData,
      walletAddress,
      provider: acceptAllProvider()
    });
    assert.equal(signature, `0x${"aa".repeat(65)}`);
  });

  it("refuses to sign a foreign domain name", async () => {
    const forged: GenericTypedData = {
      ...stagePatchTypedData,
      domain: { ...stagePatchTypedData.domain, name: "PhishingModule" }
    };
    await assert.rejects(
      signTypedDataWithInjectedWallet({ typedData: forged, walletAddress, provider: acceptAllProvider() }),
      (error) => error instanceof InjectedWalletError && error.code === "typed_data_mismatch" && /domain\.name/.test(error.message)
    );
  });

  it("refuses to sign an unsupported primaryType", async () => {
    const forged: GenericTypedData = {
      ...stagePatchTypedData,
      primaryType: "EvilStruct",
      types: { ...stagePatchTypedData.types, EvilStruct: [{ name: "selector", type: "address" }] }
    };
    await assert.rejects(
      signTypedDataWithInjectedWallet({ typedData: forged, walletAddress, provider: acceptAllProvider() }),
      (error) => error instanceof InjectedWalletError && error.code === "typed_data_mismatch" && /primaryType/.test(error.message)
    );
  });

  it("refuses to sign when the on-message signer is a different wallet", async () => {
    const forged: GenericTypedData = {
      ...stagePatchTypedData,
      message: { ...stagePatchTypedData.message, selector: "0x000000000000000000000000000000000000dead" }
    };
    await assert.rejects(
      signTypedDataWithInjectedWallet({ typedData: forged, walletAddress, provider: acceptAllProvider() }),
      (error) => error instanceof InjectedWalletError && error.code === "typed_data_mismatch" && /selector/.test(error.message)
    );
  });

  it("refuses to sign a product submit envelope whose verifying contract is missing", async () => {
    const { verifyingContract: _drop, ...domain } = typedData.domain;
    const forged = { ...typedData, domain } as unknown as typeof typedData;
    await assert.rejects(
      signProductSubmitWithInjectedWallet({ typedData: forged, walletAddress, provider: acceptAllProvider() }),
      (error) => error instanceof InjectedWalletError && error.code === "typed_data_mismatch" && /verifyingContract/.test(error.message)
    );
  });

  it("refuses to sign when the product submit submitter does not match the signing wallet", async () => {
    const forged = {
      ...typedData,
      message: { ...typedData.message, submitter: "0x000000000000000000000000000000000000dead" }
    } as unknown as typeof typedData;
    await assert.rejects(
      signProductSubmitWithInjectedWallet({ typedData: forged, walletAddress, provider: acceptAllProvider() }),
      (error) => error instanceof InjectedWalletError && error.code === "typed_data_mismatch" && /submitter/.test(error.message)
    );
  });
});
