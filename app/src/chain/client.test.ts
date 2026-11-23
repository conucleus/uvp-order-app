// commitPlan 的 planId 必须来自回执 PlanCommitted 事件（而不是本地重算）；
// 回执等待失败只能进入 outcome unknown，txHash 必须保留。

import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  parseAbiParameters,
  type Hex
} from "viem";
import type { StateMachineRawLog } from "@uvp-eth/uvp-client/core";
import { planCommittedIdFromLogs, receiptUnknownFailure } from "./client";

const H = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const WALLET = `0x${"ab".repeat(20)}` as const;
const PLAN = H(0x11);
const PLAN_HASH = H(0x12);
const TX_HASH = H(0xaa);

const planCommitted = parseAbiItem(
  "event PlanCommitted(bytes32 indexed planId, bytes32 indexed planHash, address indexed publisher, bytes32 hooksHash, bytes32 capabilitiesRoot, uint256 hookCount, bytes32 supplierBindingsRoot)"
);

function topicsOf(encoded: unknown): Hex[] {
  if (typeof encoded === "string") {
    return [encoded as Hex];
  }
  if (Array.isArray(encoded) && encoded.every((topic) => typeof topic === "string")) {
    return encoded as Hex[];
  }
  throw new Error("encodeEventTopics returned invalid topics");
}

function planCommittedLog(): StateMachineRawLog {
  return {
    address: `0x${"ef".repeat(20)}`,
    data: encodeAbiParameters(parseAbiParameters("bytes32,bytes32,uint256,bytes32"), [
      H(0x13),
      H(0x14),
      2n,
      H(0x15)
    ]),
    topics: topicsOf(
      encodeEventTopics({
        abi: [planCommitted],
        eventName: "PlanCommitted",
        args: { planId: PLAN, planHash: PLAN_HASH, publisher: WALLET }
      })
    ),
    blockNumber: 7n,
    transactionHash: TX_HASH,
    logIndex: 0
  };
}

test("commitPlan 的 planId 从 PlanCommitted 回执事件解码", () => {
  assert.equal(planCommittedIdFromLogs([planCommittedLog()]), PLAN);
  assert.equal(planCommittedIdFromLogs([]), undefined);
});

test("回执等待失败是 outcome unknown，保留 txHash 并指示链上核实", () => {
  const failure = receiptUnknownFailure(TX_HASH, "finalizePlan", new Error("timed out"));
  assert.equal(failure.code, "receipt_unknown");
  assert.equal(failure.outcomeUnknown, true);
  assert.equal(failure.txHash, TX_HASH);
  assert.match(failure.message, /UNKNOWN/u);
  assert.match(failure.message, /txHash/u);
  assert.match(failure.message, /不要直接重复发送/u);
});
