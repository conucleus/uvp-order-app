import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTriggerOrderFromOutsideTypedData } from "@uvp-eth/protocol-bindings";
import { InjectedWalletError } from "../wallet/injectedWallet";
import { assertOrderTriggerEnvelope } from "./wallet";

const submitter = "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F";
const stateMachineAddress = "0x8888888888888888888888888888888888888888";
const otherAddress = "0x9999999999999999999999999999999999999999";

function triggerTypedData() {
  return buildTriggerOrderFromOutsideTypedData({
    chainId: 31337,
    verifyingContract: stateMachineAddress,
    planId: `0x${"ab".repeat(32)}`,
    creator: submitter,
    triggerHookId: `0x${"11".repeat(32)}`,
    triggerStageId: `0x${"22".repeat(32)}`,
    sourceId: `0x${"33".repeat(32)}`,
    signalId: `0x${"44".repeat(32)}`,
    payloadHash: `0x${"55".repeat(32)}`,
    idempotencyKey: `0x${"66".repeat(32)}`,
    submitter,
    deadline: "1777777777",
    authorizations: [
      {
        sourceId: `0x${"33".repeat(32)}`,
        signalId: `0x${"44".repeat(32)}`,
        submitter,
        role: `0x${"77".repeat(32)}`,
        metadataHash: `0x${"88".repeat(32)}`
      }
    ]
  });
}

function assertMismatch(action: () => void, pattern: RegExp): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof InjectedWalletError);
    assert.equal(error.code, "typed_data_mismatch");
    assert.match(error.message, pattern);
    return true;
  });
}

describe("create-order signing envelope", () => {
  it("accepts the prepared trigger envelope for the connected wallet", () => {
    assert.doesNotThrow(() =>
      assertOrderTriggerEnvelope(
        triggerTypedData(),
        submitter,
        { verifyingContract: stateMachineAddress, chainId: 31337 },
        [submitter]
      )
    );
  });

  it("refuses a swapped verification domain before the wallet is asked to sign", () => {
    assertMismatch(
      () => assertOrderTriggerEnvelope(
        triggerTypedData(),
        submitter,
        { verifyingContract: otherAddress, chainId: 31337 },
        [submitter]
      ),
      /部署/u
    );
  });

  it("refuses a prepared record that names a different submitter", () => {
    assertMismatch(
      () => assertOrderTriggerEnvelope(
        triggerTypedData(),
        submitter,
        { verifyingContract: stateMachineAddress, chainId: 31337 },
        [otherAddress]
      ),
      /确认身份/u
    );
  });

  it("refuses another wallet's signer field", () => {
    assertMismatch(
      () => assertOrderTriggerEnvelope(
        triggerTypedData(),
        otherAddress,
        { verifyingContract: stateMachineAddress, chainId: 31337 },
        undefined
      ),
      /确认人/u
    );
  });
});
