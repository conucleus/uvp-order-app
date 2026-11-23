// 刷新/重试恢复态：待 finalize 的 commitPlan 记录与出生幂等键必须可读取，
// 坏记录必须删除而不是回退到随机值（随机值会让重试变成新订单/新 commit）。

import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import {
  birthIdempotencyScope,
  clearPendingPlanFinalize,
  readBirthIdempotencyRecord,
  readPendingPlanFinalize,
  writeBirthIdempotencyRecord,
  writePendingPlanFinalize,
  type KeyValueStorage
} from "./localRecovery";

const H = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const WALLET = `0x${"ab".repeat(20)}` as const;

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

test("待 finalize 记录可跨刷新读取与清除", () => {
  const storage = new MemoryStorage();
  const pending = { planId: H(0x11), commitTx: H(0x22), publisher: WALLET };
  writePendingPlanFinalize(pending, storage);
  assert.deepEqual(readPendingPlanFinalize(storage), pending);
  clearPendingPlanFinalize(storage);
  assert.equal(readPendingPlanFinalize(storage), undefined);
});

test("坏 finalize 记录被删除，不回退到默认 planId", () => {
  const storage = new MemoryStorage();
  writePendingPlanFinalize({ planId: H(0x11), commitTx: H(0x22), publisher: WALLET }, storage);
  const key = storage.keys()[0];
  if (key === undefined) assert.fail("pending key missing");
  storage.setItem(key, "{");
  assert.equal(readPendingPlanFinalize(storage), undefined);
  assert.equal(storage.getItem(key), null);
});

test("出生承诺记录带 plan 作用域跨刷新保留；坏记录删除后由调用方显式生成新值", () => {
  const storage = new MemoryStorage();
  const scope = birthIdempotencyScope({
    chainId: 31_337,
    stateMachine: "0xABCDEF",
    planId: H(0x11)
  });
  writeBirthIdempotencyRecord({ scope, key: H(0x33) }, storage);
  assert.deepEqual(readBirthIdempotencyRecord(storage), { scope, key: H(0x33) });

  const key = storage.keys()[0];
  if (key === undefined) assert.fail("birth key missing");
  storage.setItem(key, "0x12");
  assert.equal(readBirthIdempotencyRecord(storage), undefined);
  assert.equal(storage.getItem(key), null);
});

test("出生承诺作用域区分 chain / state machine / plan", () => {
  const base = { chainId: 31_337, stateMachine: "0xABCDEF", planId: H(0x11) };
  assert.equal(birthIdempotencyScope(base), birthIdempotencyScope({ ...base, stateMachine: "0xabcdef" }));
  assert.notEqual(birthIdempotencyScope(base), birthIdempotencyScope({ ...base, planId: H(0x12) }));
  assert.notEqual(birthIdempotencyScope(base), birthIdempotencyScope({ ...base, chainId: 84532 }));
});
