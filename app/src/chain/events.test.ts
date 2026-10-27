// 事件解码/过滤测试：四类事实事件按 ABI 解码；planId/orderId 过滤；解不出来报错。
// 不跑 RPC。

import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import { signalSubmittedEvent, stageMaterializedEvent } from "./abi";
import { decodeChainLogs, filterChainEvents } from "./events";

const PLAN = `0x${"a".repeat(64)}` as const;
const ORDER = `0x${"b".repeat(64)}` as const;
const SOURCE = `0x${"c".repeat(64)}` as const;
const SIGNAL = `0x${"d".repeat(64)}` as const;
const PAYLOAD = `0x${"e".repeat(64)}` as const;
const IDEM = `0x${"f".repeat(64)}` as const;
const STAGE = `0x${"1".repeat(64)}` as const;
const SUBMITTER = "0x1111111111111111111111111111111111111111" as const;

function log(partial: { readonly topics: readonly string[]; readonly data: string; readonly logIndex: number }): Log {
  return {
    address: "0x2222222222222222222222222222222222222222",
    blockNumber: 7n,
    blockHash: `0x${"9".repeat(64)}`,
    transactionHash: `0x${"8".repeat(64)}`,
    transactionIndex: 0,
    logIndex: partial.logIndex,
    removed: false,
    topics: partial.topics,
    data: partial.data
  } as unknown as Log;
}

test("SignalSubmitted 解码：字段原样透传，plan/order 过滤保留匹配项", () => {
  const topics = encodeEventTopics({
    abi: [signalSubmittedEvent],
    eventName: "SignalSubmitted",
    args: { planId: PLAN, orderId: ORDER, sourceId: SOURCE }
  });
  const data = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }],
    [SIGNAL, PAYLOAD, IDEM, SUBMITTER, STAGE]
  );
  const decoded = decodeChainLogs([log({ topics: topics as readonly string[], data, logIndex: 1 })]);
  assert.equal(decoded.ok, true);
  if (decoded.ok) {
    assert.equal(decoded.events.length, 1);
    const event = decoded.events[0];
    assert.equal(event?.kind, "signal_submitted");
    if (event?.kind === "signal_submitted") {
      assert.equal(event.planId, PLAN);
      assert.equal(event.signalId, SIGNAL);
      assert.equal(event.submitter, SUBMITTER);
    }
    assert.equal(filterChainEvents(decoded.events, PLAN, ORDER).length, 1);
    assert.equal(filterChainEvents(decoded.events, PLAN, `0x${"c".repeat(64)}`).length, 0);
  }
});

test("StageMaterialized 解码；坏 data 解码失败具名", () => {
  const topics = encodeEventTopics({
    abi: [stageMaterializedEvent],
    eventName: "StageMaterialized",
    args: { planId: PLAN, orderId: ORDER, stageId: STAGE }
  });
  const data = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [`0x${"2".repeat(64)}`, SOURCE, SIGNAL]
  );
  const decoded = decodeChainLogs([log({ topics: topics as readonly string[], data, logIndex: 2 })]);
  assert.equal(decoded.ok, true);
  if (decoded.ok) {
    assert.equal(decoded.events[0]?.kind, "stage_materialized");
  }

  const bad = decodeChainLogs([log({ topics: topics as readonly string[], data: "0x", logIndex: 3 })]);
  assert.equal(bad.ok, false);
});
