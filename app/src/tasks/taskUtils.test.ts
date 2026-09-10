import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanString,
  isContentAddressedReference,
  parseDeadlineUtcMs,
  parseEvidenceIds,
  sameAddress,
  stagePatchSignExpectation,
  submitSignExpectation,
  type SignDomainEnv
} from "./taskUtils.js";

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
    // 缺预期值即拒绝签名（fail-closed），不再条件性跳过比对。
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
