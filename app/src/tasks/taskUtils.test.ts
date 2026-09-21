import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";
import {
  InjectedWalletError,
  signProductSubmitWithInjectedWallet,
  type Eip1193Provider
} from "../wallet/injectedWallet.js";
import {
  cleanString,
  isContentAddressedReference,
  parseDeadlineUtcMs,
  parseEvidenceIds,
  sameAddress,
  stagePatchSignExpectation,
  submitSignExpectation,
  taskSubmitSignInput,
  type SignDomainEnv
} from "./model/taskUtils.js";

describe("task utility helpers", () => {
  it("normalizes shared task strings and wallet comparisons", () => {
    assert.equal(cleanString("  customs  "), "customs");
    assert.equal(cleanString("   "), undefined);
    assert.deepEqual(parseEvidenceIds("ev-1, ev-2；ev-3\n ev-4"), ["ev-1", "ev-2", "ev-3", "ev-4"]);
    assert.equal(
      sameAddress("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefabcd", "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"),
      true
    );
  });
});

describe("stage patch signing domain expectation", () => {
  const moduleAddress = "0x8888888888888888888888888888888888888888";

  it("derives the domain expectation from deployment config, not the prepare envelope", () => {
    // 预期值来自部署配置注入（独立来源）：prepare 信封里的
    // humanSummary.verifyingContract 与 typedData 同源，不作为核对基准。
    assert.deepEqual(
      stagePatchSignExpectation({ VITE_UVP_STAGE_PATCH_MODULE_ADDRESS: `  ${moduleAddress} ` }),
      { expected: { verifyingContract: moduleAddress } }
    );
  });

  it("refuses to sign when the deployment config does not declare the patch module address", () => {
    // 缺预期值即拒绝签名（fail-closed）。
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
    // 投影类型允许 prepare 记录未声明提交方：undefined 条目由闸门跳过。
    assert.deepEqual(taskSubmitSignInput({ typedData }, walletAddress, env).preparedSubmitters, [undefined]);
  });

  it("refuses to sign when the deployment chain differs from the prepared envelope domain", async () => {
    // 部署配置锚定的 chainId 与被核对的 typedData.domain 不一致：钱包闸门
    // 在调钱包前拒绝（换链攻击与换合约地址同罪）。
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
    // 组装结果直接进真实钱包闸门（桩 provider）：被攻陷 BFF 把别的
    // principal 的 prepared 信封换给本钱包时，在调钱包前拒绝。
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
    // prepared 声明一致（大小写不敏感）时放行。
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
    // urn:uuid / urn:isbn 等都是任意 URN；urn: 前缀放行会让非内容寻址引用
    // 通过 URI 预检，与服务端生产口径（ipfs/ar）相反。
    assert.equal(isContentAddressedReference("urn:uuid:6ec0bd7f-11c0-43da-975e-2a8ad9eacsd0"), false);
    assert.equal(isContentAddressedReference("https://cos.example.com/manifest.json"), false);
    assert.equal(isContentAddressedReference("urn:cid:bafyabc"), false);
  });
});
