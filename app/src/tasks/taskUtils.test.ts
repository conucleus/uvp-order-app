import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProductSubmitTypedData } from "@uvp-eth/protocol-bindings";
import {
  InjectedWalletError,
  signProductSubmitWithInjectedWallet,
  type Eip1193Provider
} from "../wallet/injectedWallet.js";
import {
  isContentAddressedReference,
  parseDeadlineUtcMs,
  stagePatchSignExpectation,
  submitSignExpectation,
  taskSubmitSignInput,
  type SignDomainEnv
} from "./model/taskUtils.js";

describe("stage patch signing domain expectation", () => {
  const moduleAddress = "0x8888888888888888888888888888888888888888";

  it("derives the domain expectation from deployment config, not the prepare envelope", () => {
    assert.deepEqual(
      stagePatchSignExpectation({ VITE_UVP_STAGE_PATCH_MODULE_ADDRESS: `  ${moduleAddress} ` }),
      { expected: { verifyingContract: moduleAddress } }
    );
  });

  it("refuses to sign when the deployment config does not declare the patch module address", () => {
    assert.throws(() => stagePatchSignExpectation({}), /VITE_UVP_STAGE_PATCH_MODULE_ADDRESS/u);
    assert.throws(() => stagePatchSignExpectation({ VITE_UVP_STAGE_PATCH_MODULE_ADDRESS: "not-an-address" }), /VITE_UVP_STAGE_PATCH_MODULE_ADDRESS/u);
  });
});

describe("task submit signing domain expectation", () => {
  const stateMachineAddress = "0x7777777777777777777777777777777777777777";

  it("derives the submit expectation from deployment config, independent of the BFF response", () => {
    assert.deepEqual(
      submitSignExpectation({ VITE_UVP_STATE_MACHINE_ADDRESS: stateMachineAddress }),
      { expected: { verifyingContract: stateMachineAddress } }
    );
  });

  it("refuses to sign when the deployment config does not declare the state machine address", () => {
    assert.throws(() => submitSignExpectation({}), /VITE_UVP_STATE_MACHINE_ADDRESS/u);
    assert.throws(() => submitSignExpectation({ VITE_UVP_STATE_MACHINE_ADDRESS: "0x1234" }), /VITE_UVP_STATE_MACHINE_ADDRESS/u);
  });

  it("anchors domain.chainId from the same deployment config as the contract address", () => {
    assert.deepEqual(
      submitSignExpectation({ VITE_UVP_STATE_MACHINE_ADDRESS: stateMachineAddress, VITE_UVP_CHAIN_ID: " 31337 " }),
      { expected: { verifyingContract: stateMachineAddress, chainId: 31337 } }
    );
    assert.deepEqual(
      stagePatchSignExpectation({ VITE_UVP_STAGE_PATCH_MODULE_ADDRESS: "0x8888888888888888888888888888888888888888", VITE_UVP_CHAIN_ID: "31337" }),
      { expected: { verifyingContract: "0x8888888888888888888888888888888888888888", chainId: 31337 } }
    );
  });

  it("keeps chainId unanchored when the config omits it, but refuses malformed values", () => {
    assert.deepEqual(
      submitSignExpectation({ VITE_UVP_STATE_MACHINE_ADDRESS: stateMachineAddress }),
      { expected: { verifyingContract: stateMachineAddress } }
    );
    assert.throws(
      () => submitSignExpectation({ VITE_UVP_STATE_MACHINE_ADDRESS: stateMachineAddress, VITE_UVP_CHAIN_ID: "0x7a69" }),
      /VITE_UVP_CHAIN_ID/u
    );
    assert.throws(
      () => submitSignExpectation({ VITE_UVP_STATE_MACHINE_ADDRESS: stateMachineAddress, VITE_UVP_CHAIN_ID: "-1" }),
      /VITE_UVP_CHAIN_ID/u
    );
  });
});

describe("task submit boundary sign input assembly", () => {
  const stateMachineAddress = "0x7777777777777777777777777777777777777777";
  const env: SignDomainEnv = { VITE_UVP_STATE_MACHINE_ADDRESS: stateMachineAddress };
  const walletAddress = "0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f";
  const typedData = buildProductSubmitTypedData({
    chainId: 31337,
    verifyingContract: stateMachineAddress,
    planId: "0x1111111111111111111111111111111111111111111111111111111111111111",
    orderId: "0x0101010101010101010101010101010101010101010101010101010101010101",
    sourceId: "0x0202020202020202020202020202020202020202020202020202020202020202",
    signalId: "0x0303030303030303030303030303030303030303030303030303030303030303",
    payloadHash: "0x0404040404040404040404040404040404040404040404040404040404040404",
    idempotencyKey: "0x0505050505050505050505050505050505050505050505050505050505050505",
    submitter: walletAddress,
    deadline: "1777777777"
  });

  function acceptAllProvider(): Eip1193Provider {
    return {
      request: async ({ method }) =>
        method === "eth_chainId" ? "0x7a69" : `0x${"aa".repeat(65)}`
    };
  }

  it("carries the prepared record's submitter and the deployment expectation in one gate input", () => {
    assert.deepEqual(
      taskSubmitSignInput({ typedData, submitter: walletAddress.toUpperCase() }, walletAddress, env),
      {
        typedData,
        walletAddress,
        preparedSubmitters: [walletAddress.toUpperCase()],
        expected: { verifyingContract: stateMachineAddress }
      }
    );
    assert.deepEqual(taskSubmitSignInput({ typedData }, walletAddress, env).preparedSubmitters, [undefined]);
  });

  it("refuses to sign when the deployment chain differs from the prepared envelope domain", async () => {
    const wrongChain = taskSubmitSignInput({ typedData }, walletAddress, {
      VITE_UVP_STATE_MACHINE_ADDRESS: stateMachineAddress,
      VITE_UVP_CHAIN_ID: "31338"
    });
    await assert.rejects(
      signProductSubmitWithInjectedWallet({ ...wrongChain, provider: acceptAllProvider() }),
      (error) => error instanceof InjectedWalletError &&
        error.code === "typed_data_mismatch" &&
        /domain\.chainId 31337 与预期 31338 不一致/.test(error.message)
    );
  });

  it("refuses to sign when the prepared record names a different submitter (built-in plugin submit boundary)", async () => {
    const forged = taskSubmitSignInput(
      { typedData, submitter: "0x000000000000000000000000000000000000dead" },
      walletAddress,
      env
    );
    await assert.rejects(
      signProductSubmitWithInjectedWallet({ ...forged, provider: acceptAllProvider() }),
      (error) => error instanceof InjectedWalletError &&
        error.code === "typed_data_mismatch" &&
        /prepare 记录声明的提交方/.test(error.message)
    );
    const consistent = taskSubmitSignInput({ typedData, submitter: walletAddress.toUpperCase() }, walletAddress, env);
    const signature = await signProductSubmitWithInjectedWallet({ ...consistent, provider: acceptAllProvider() });
    assert.equal(signature, `0x${"aa".repeat(65)}`);
  });
});

describe("deadline parsing", () => {
  it("parses naive deadline strings as UTC regardless of the browser timezone", () => {
    assert.equal(parseDeadlineUtcMs("2026-05-02 18:00"), Date.parse("2026-05-02T18:00:00Z"));
    assert.equal(parseDeadlineUtcMs("2026-05-02T18:00"), Date.parse("2026-05-02T18:00:00Z"));
  });

  it("keeps explicit zone designators and rejects unparseable values", () => {
    assert.equal(parseDeadlineUtcMs("2026-05-02T18:00:00Z"), Date.parse("2026-05-02T18:00:00Z"));
    assert.equal(parseDeadlineUtcMs("2026-05-02T18:00:00+08:00"), Date.parse("2026-05-02T18:00:00+08:00"));
    assert.equal(parseDeadlineUtcMs("2026-05-02T18:00:00-0800"), Date.parse("2026-05-02T18:00:00-0800"));
    assert.equal(parseDeadlineUtcMs("以业务约定为准"), undefined);
    assert.equal(parseDeadlineUtcMs("   "), undefined);
  });
});

describe("content-addressed reference predicate", () => {
  it("accepts the canonical content-addressed prefixes", () => {
    assert.equal(isContentAddressedReference("ipfs://bafyabc"), true);
    assert.equal(isContentAddressedReference("  AR://xyz  "), true);
    assert.equal(isContentAddressedReference("cid:bafyabc"), true);
    assert.equal(isContentAddressedReference("bafybeig..."), true);
  });

  it("rejects a bare urn: prefix because URNs are not inherently content-addressed", () => {
    assert.equal(isContentAddressedReference("urn:uuid:6ec0bd7f-11c0-43da-975e-2a8ad9eacsd0"), false);
    assert.equal(isContentAddressedReference("https://cos.example.com/manifest.json"), false);
    assert.equal(isContentAddressedReference("urn:cid:bafyabc"), false);
  });
});
