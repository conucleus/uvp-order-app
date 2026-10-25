// V3 托管/binding 交叉校验：instructionRef 钉值、DepositTerms 字段与合约一致、
// binding 的 deposit typed data 必须携带 verifier 且与 intent 一致。

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, toHex } from "viem";
import {
  ESCROW_V3_DEPOSIT_TYPES,
  depositAuthorizationHash
} from "../src/escrow/v3/index";
import {
  BindingReadError,
  INSTRUCTION_REF_DOMAIN,
  expectedInstructionRef,
  parseDepositIntent
} from "../src/escrow/binding/index";

const PLAN_ID = `0x${"11".repeat(32)}` as `0x${string}`;
const ORDER_ID = `0x${"22".repeat(32)}` as `0x${string}`;
const STAGE_ID = `0x${"33".repeat(32)}` as `0x${string}`;
const PAYER = "0x1111111111111111111111111111111111111111";
const PAYEE = "0x2222222222222222222222222222222222222222";
const VERIFIER = "0x3333333333333333333333333333333333333333";
const FEE_RECIPIENT = "0x4444444444444444444444444444444444444444";
const ESCROW = "0x5555555555555555555555555555555555555555";

const EXPECTED_FIELDS = [
  "orderId", "stageId", "payer", "payee", "verifier",
  "amount", "feeBps", "feeRecipient", "deadline", "nonce"
] as const;

describe("expectedInstructionRef", () => {
  it("matches the A-adapter formula with a pinned vector", () => {
    assert.equal(INSTRUCTION_REF_DOMAIN, "uvp.factsource.instruction.v1");
    assert.equal(
      expectedInstructionRef({ planId: PLAN_ID, orderId: ORDER_ID, stageId: STAGE_ID }),
      "0xb13be2a225cfd232b76f26107d7cf2646050fd21cfb4a64241f582bba326ccbe"
    );
  });
});

describe("DepositTerms typed data", () => {
  it("carries verifier in the contract field order", () => {
    assert.deepEqual(ESCROW_V3_DEPOSIT_TYPES.DepositTerms.map((field) => field.name), [...EXPECTED_FIELDS]);
    assert.deepEqual(
      ESCROW_V3_DEPOSIT_TYPES.DepositTerms.map((field) => field.type),
      ["bytes32", "bytes32", "address", "address", "address", "uint256", "uint16", "address", "uint64", "uint256"]
    );
    const encodeType = `DepositTerms(${ESCROW_V3_DEPOSIT_TYPES.DepositTerms.map((field) => `${field.type} ${field.name}`).join(",")})`;
    assert.equal(
      keccak256(toHex(encodeType)),
      "0x278ae76675e526e9d554daf801096beaf807a2e927fec9a3a798bd51e89ea8eb"
    );
  });

  it("includes verifier in the deposit authorization hash", () => {
    const base = {
      orderId: ORDER_ID,
      stageId: STAGE_ID,
      payer: PAYER,
      payee: PAYEE,
      amount: 1000n,
      feeBps: 100,
      feeRecipient: FEE_RECIPIENT as `0x${string}`,
      deadline: 1893456000n,
      nonce: 7n
    } as const;
    const withVerifier = depositAuthorizationHash({ ...base, verifier: VERIFIER });
    const otherVerifier = depositAuthorizationHash({ ...base, verifier: FEE_RECIPIENT });
    assert.notEqual(withVerifier, otherVerifier);
  });
});

describe("binding deposit intent", () => {
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const intent = {
      intentId: "dint_1",
      chainId: 31337,
      escrowAddress: ESCROW,
      orderId: ORDER_ID,
      stageKey: "sourcing",
      stageId: STAGE_ID,
      trancheId: `0x${"66".repeat(32)}`,
      payer: PAYER,
      payee: PAYEE,
      verifier: VERIFIER,
      amount: "1000",
      feeBps: 100,
      feeRecipient: FEE_RECIPIENT,
      termsHash: `0x${"77".repeat(32)}`,
      nonce: "7",
      deadline: "1893456000",
      status: "pending",
      ...overrides
    };
    return {
      intent,
      typedData: {
        types: { DepositTerms: ESCROW_V3_DEPOSIT_TYPES.DepositTerms },
        primaryType: "DepositTerms",
        domain: { name: "UVPStageEscrow", version: "3", chainId: 31337, verifyingContract: ESCROW },
        message: {
          orderId: ORDER_ID,
          stageId: STAGE_ID,
          payer: PAYER,
          payee: PAYEE,
          verifier: VERIFIER,
          amount: "1000",
          feeBps: 100,
          feeRecipient: FEE_RECIPIENT,
          deadline: "1893456000",
          nonce: "7"
        }
      }
    };
  }

  it("requires verifier and returns it in the typed data", () => {
    const parsed = parseDepositIntent(ORDER_ID, "sourcing", body());
    assert.equal(parsed.typedData.message.verifier, VERIFIER);
    assert.deepEqual(Object.keys(parsed.typedData.message).sort(), [...EXPECTED_FIELDS].sort());
    assert.equal(parsed.intent.verifier, VERIFIER);
  });

  it("rejects an intent without verifier", () => {
    const missing = body();
    delete (missing.intent as Record<string, unknown>).verifier;
    assert.throws(
      () => parseDepositIntent(ORDER_ID, "sourcing", missing),
      (error: unknown) => error instanceof BindingReadError
    );
  });

  it("rejects typed data whose verifier differs from the intent", () => {
    const mismatched = body();
    (mismatched.typedData as { message: Record<string, unknown> }).message.verifier = FEE_RECIPIENT;
    assert.throws(
      () => parseDepositIntent(ORDER_ID, "sourcing", mismatched),
      (error: unknown) => error instanceof BindingReadError
    );
  });
});
