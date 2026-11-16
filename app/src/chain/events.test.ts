// 事件解码不变量：SignalSubmitted 带 relayer、StageSupplierAssigned 带
// supplierId/patchNonce、StageSupplierPatchApplied 带 supplierId/previousSupplierId/
// patchNonce 的日志必须解出这些字段；不匹配的日志具名失败，不静默丢弃。

import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  parseAbiParameters,
  type Hex,
  type Log
} from "viem";
import { decodeChainLogs } from "./events";

const H = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const ADDRESS = (byte: string): `0x${string}` => `0x${byte.repeat(20)}`;
const STATE_MACHINE = ADDRESS("ef");
const PLAN = H(0x11);
const ORDER = H(0x12);
const STAGE = H(0x13);
const SUPPLIER = H(0x14);
const PREVIOUS_SUPPLIER = H(0x15);
const SELECTOR_STAGE = H(0x16);
const WALLET = ADDRESS("ab");
const RELAYER = ADDRESS("cd");
const SELECTOR = ADDRESS("12");

const signalSubmitted = parseAbiItem(
  "event SignalSubmitted(bytes32 indexed planId, bytes32 indexed orderId, bytes32 indexed sourceId, bytes32 signalId, bytes32 payloadHash, bytes32 idempotencyKey, address submitter, address relayer, bytes32 factStageId)"
);
const stageSupplierAssigned = parseAbiItem(
  "event StageSupplierAssigned(bytes32 indexed planId, bytes32 indexed orderId, bytes32 indexed targetStageId, bytes32 supplierId, uint256 patchNonce)"
);
const stageSupplierPatchApplied = parseAbiItem(
  "event StageSupplierPatchApplied(bytes32 indexed planId, bytes32 indexed orderId, bytes32 indexed selectorStageId, bytes32 targetStageId, address selector, bytes32 supplierId, bytes32 previousSupplierId, uint256 patchNonce)"
);

function eventTopics(encoded: unknown): readonly Hex[] {
  if (typeof encoded === "string") {
    return [encoded as Hex];
  }
  if (Array.isArray(encoded) && encoded.every((topic) => typeof topic === "string")) {
    return encoded as Hex[];
  }
  throw new Error("encodeEventTopics returned invalid topics");
}

function logOf(topics: readonly Hex[], data: Hex, logIndex: number): Log {
  return {
    address: STATE_MACHINE,
    blockHash: H(0x99),
    blockNumber: 7n,
    data,
    logIndex,
    removed: false,
    topics: [...topics] as [Hex, ...Hex[]],
    transactionHash: H(0x98),
    transactionIndex: 0
  };
}

test("事件解码：SignalSubmitted relayer、StageSupplierAssigned/PatchApplied supplierId+patchNonce", () => {
  const signalLog = logOf(
    eventTopics(encodeEventTopics({
      abi: [signalSubmitted],
      eventName: "SignalSubmitted",
      args: { planId: PLAN, orderId: ORDER, sourceId: H(0x16) }
    })),
    encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32,address,address,bytes32"), [
      H(0x17),
      H(0x18),
      H(0x19),
      WALLET,
      RELAYER,
      STAGE
    ]),
    0
  );
  const assignedLog = logOf(
    eventTopics(encodeEventTopics({
      abi: [stageSupplierAssigned],
      eventName: "StageSupplierAssigned",
      args: { planId: PLAN, orderId: ORDER, targetStageId: STAGE }
    })),
    encodeAbiParameters(parseAbiParameters("bytes32,uint256"), [SUPPLIER, 3n]),
    1
  );
  const patchLog = logOf(
    eventTopics(encodeEventTopics({
      abi: [stageSupplierPatchApplied],
      eventName: "StageSupplierPatchApplied",
      args: { planId: PLAN, orderId: ORDER, selectorStageId: SELECTOR_STAGE }
    })),
    encodeAbiParameters(parseAbiParameters("bytes32,address,bytes32,bytes32,uint256"), [
      STAGE,
      SELECTOR,
      SUPPLIER,
      PREVIOUS_SUPPLIER,
      4n
    ]),
    2
  );

  const decoded = decodeChainLogs([signalLog, assignedLog, patchLog]);
  if (!decoded.ok) {
    assert.fail(`expected decode ok, got ${decoded.message}`);
  }
  assert.equal(decoded.events.length, 3);

  const signal = decoded.events[0];
  if (signal?.kind !== "signal_submitted") assert.fail("expected signal_submitted first");
  assert.equal(signal.submitter.toLowerCase(), WALLET);
  assert.equal(signal.relayer.toLowerCase(), RELAYER);
  assert.equal(signal.payloadHash, H(0x18));
  assert.equal(signal.idempotencyKey, H(0x19));
  assert.equal(signal.factStageId, STAGE);

  const assigned = decoded.events[1];
  if (assigned?.kind !== "stage_supplier_assigned") assert.fail("expected stage_supplier_assigned");
  assert.equal(assigned.targetStageId, STAGE);
  assert.equal(assigned.supplierId, SUPPLIER);
  assert.equal(assigned.patchNonce, 3n);

  const patched = decoded.events[2];
  if (patched?.kind !== "stage_supplier_patch_applied") assert.fail("expected stage_supplier_patch_applied");
  assert.equal(patched.selectorStageId, SELECTOR_STAGE);
  assert.equal(patched.targetStageId, STAGE);
  assert.equal(patched.selector.toLowerCase(), SELECTOR);
  assert.equal(patched.supplierId, SUPPLIER);
  assert.equal(patched.previousSupplierId, PREVIOUS_SUPPLIER);
  assert.equal(patched.patchNonce, 4n);
});

test("事件解码：未知日志具名失败，不静默丢弃", () => {
  const decoded = decodeChainLogs([logOf([H(0xdead)], "0x", 0)]);
  assert.equal(decoded.ok, false);
  if (!decoded.ok) {
    assert.match(decoded.message, /事件解码失败/u);
  }
});
