// 发信号纯函数测试：bytes32、attribution JSON、calldata 参数、随机 key、钱包拒绝/revert
// 具名。不跑网络/钱包/DOM。

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSubmitSignalArguments,
  mapWalletError,
  parseAttributionJson,
  parseBytes32,
  randomBytes32
} from "./input";

const A = `0x${"1".repeat(64)}`;
const B = `0x${"2".repeat(64)}`;
const C = `0x${"3".repeat(64)}`;
const D = `0x${"4".repeat(64)}`;
const ZERO = `0x${"0".repeat(64)}`;

test("bytes32 校验：合法接受，短/空/非 hex 拒绝", () => {
  assert.deepEqual(parseBytes32(` ${A} `, "planId"), { ok: true, value: A });
  assert.equal(parseBytes32("", "planId").ok, false);
  assert.equal(parseBytes32("0x12", "planId").ok, false);
  assert.equal(parseBytes32(`0x${"g".repeat(64)}`, "planId").ok, false);
});

test("attribution JSON：空=不传；stageId/proof 解析；未知字段/坏 proof 具名", () => {
  assert.deepEqual(parseAttributionJson(" "), { ok: true, value: undefined });
  assert.deepEqual(parseAttributionJson(JSON.stringify({ stageId: A, proof: [B] })), {
    ok: true,
    value: { stageId: A, proof: [B] }
  });
  assert.equal(parseAttributionJson("{").ok, false);
  assert.equal(parseAttributionJson(JSON.stringify({ stageId: A, extra: true })).ok, false);
  assert.equal(parseAttributionJson(JSON.stringify({ stageId: A, proof: "x" })).ok, false);
});

test("calldata 参数：无 attribution 填零元组；有则 source/signal 取自表单", () => {
  const base = {
    planId: A,
    orderId: B,
    sourceId: C,
    signalId: D,
    payloadHash: A,
    idempotencyKey: B,
    attributionRaw: ""
  };
  const plain = buildSubmitSignalArguments(base);
  assert.equal(plain.ok, true);
  if (plain.ok) {
    assert.deepEqual(plain.value.attribution, {
      sourceId: ZERO,
      signalId: ZERO,
      stageId: ZERO,
      capabilityProof: []
    });
  }

  const withAttribution = buildSubmitSignalArguments({
    ...base,
    attributionRaw: JSON.stringify({ stageId: D, proof: [A, B] })
  });
  assert.equal(withAttribution.ok, true);
  if (withAttribution.ok) {
    assert.deepEqual(withAttribution.value.attribution, {
      sourceId: C,
      signalId: D,
      stageId: D,
      capabilityProof: [A, B]
    });
  }

  const badIdempotency = buildSubmitSignalArguments({ ...base, idempotencyKey: "0x12" });
  assert.equal(badIdempotency.ok, false);
});

test("idempotencyKey 缺省随机 32 字节，hex 格式稳定", () => {
  const fixed = randomBytes32(() => new Uint8Array(32).fill(0xab));
  assert.equal(fixed, `0x${"ab".repeat(32)}`);
});

test("钱包拒绝与 revert 具名，不吞成 unknown", () => {
  assert.equal(mapWalletError({ code: 4001 }).code, "user_rejected");
  assert.equal(mapWalletError(new Error("execution reverted: UnauthorizedSignalSubmitter")).code, "reverted");
  assert.equal(mapWalletError(new Error("Failed to fetch")).code, "network");
});
