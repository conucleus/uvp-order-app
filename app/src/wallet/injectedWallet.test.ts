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
    request: async () => `0x${"aa".repeat(65)}`
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

  it("requests a typed-data signature from the provided wallet", async () => {
    const signature = `0x${"aa".repeat(65)}` as const;
    const requests: unknown[] = [];
    const provider: Eip1193Provider = {
      request: async (input) => {
        requests.push(input);
        return signature;
      }
    };

    const result = await signProductSubmitWithInjectedWallet({
      typedData,
      walletAddress,
      provider
    });

    assert.equal(result, signature);
    assert.deepEqual(requests, [{
      method: "eth_signTypedData_v4",
      params: [walletAddress, JSON.stringify(typedData)]
    }]);
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
