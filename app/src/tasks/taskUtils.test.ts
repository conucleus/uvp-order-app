import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanString, parseDeadlineUtcMs, parseEvidenceIds, sameAddress, stagePatchSignExpectation } from "./taskUtils.js";

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
  it("derives the domain expectation from the module address declared by the prepare envelope", () => {
    const moduleAddress = "0x8888888888888888888888888888888888888888";
    assert.deepEqual(
      stagePatchSignExpectation({ humanSummary: { verifyingContract: `  ${moduleAddress} ` } }),
      { expected: { verifyingContract: moduleAddress } }
    );
  });

  it("refuses to sign when the prepare envelope does not declare the patch verifying contract", () => {
    assert.throws(() => stagePatchSignExpectation({}), /humanSummary\.verifyingContract/);
    assert.throws(() => stagePatchSignExpectation({ humanSummary: {} }), /humanSummary\.verifyingContract/);
    assert.throws(() => stagePatchSignExpectation({ humanSummary: { verifyingContract: "   " } }), /humanSummary\.verifyingContract/);
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
