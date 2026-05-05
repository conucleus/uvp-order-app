import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";
import {
  InjectedWalletError,
  UnsupportedWalletTargetError,
  getWalletConnector,
  signProductSubmitWithInjectedWallet,
  type Eip1193Provider
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
