// 刷新/重试恢复态：待 finalize 的 commitPlan 记录与出生幂等键必须可读取，
// 坏记录必须删除而不是回退到随机值（随机值会让重试变成新订单/新 commit）。

import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import {
  birthIdempotencyScope,
  clearPendingPlanFinalize,
  readBirthIdempotencyKey,
  readPendingPlanFinalize,
  removeBirthIdempotencyKey,
  writeBirthIdempotencyKey,
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

test("PlanAlreadyRegistered 恢复记录没有 commitTx 时仍可读取", () => {
  const storage = new MemoryStorage();
  writePendingPlanFinalize({ planId: H(0x11), publisher: WALLET }, storage);
  assert.deepEqual(readPendingPlanFinalize(storage), { planId: H(0x11), publisher: WALLET });
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

test("出生承诺按 plan 作用域分别保留，切换 artifact 不覆盖其它计划的键", () => {
  const storage = new MemoryStorage();
  const scopeA = birthIdempotencyScope({ chainId: 31_337, stateMachine: "0xABCDEF", planId: H(0x11) });
  const scopeB = birthIdempotencyScope({ chainId: 31_337, stateMachine: "0xABCDEF", planId: H(0x12) });
  writeBirthIdempotencyKey(scopeA, H(0x33), storage);
  writeBirthIdempotencyKey(scopeB, H(0x44), storage);

  assert.equal(readBirthIdempotencyKey(scopeA, storage), H(0x33));
  assert.equal(readBirthIdempotencyKey(scopeB, storage), H(0x44));

  removeBirthIdempotencyKey(scopeB, storage);
  assert.equal(readBirthIdempotencyKey(scopeA, storage), H(0x33));
  assert.equal(readBirthIdempotencyKey(scopeB, storage), undefined);
});

test("坏作用域键单独删除，不连坐其它作用域的出生承诺", () => {
  const storage = new MemoryStorage();
  const scopeA = birthIdempotencyScope({ chainId: 31_337, stateMachine: "0xABCDEF", planId: H(0x11) });
  const scopeB = birthIdempotencyScope({ chainId: 31_337, stateMachine: "0xABCDEF", planId: H(0x12) });
  writeBirthIdempotencyKey(scopeA, H(0x33), storage);
  writeBirthIdempotencyKey(scopeB, H(0x44), storage);
  const storeKey = storage.keys()[0];
  if (storeKey === undefined) assert.fail("birth store missing");
  const parsed = JSON.parse(storage.getItem(storeKey) ?? "{}") as Record<string, string>;
  parsed[scopeB] = "0x12";
  storage.setItem(storeKey, JSON.stringify(parsed));

  assert.equal(readBirthIdempotencyKey(scopeB, storage), undefined);
  assert.equal(readBirthIdempotencyKey(scopeA, storage), H(0x33));
  const after = JSON.parse(storage.getItem(storeKey) ?? "{}") as Record<string, string>;
  assert.equal(scopeB in after, false);
});

test("出生承诺作用域区分 chain / state machine / plan", () => {
  const base = { chainId: 31_337, stateMachine: "0xABCDEF", planId: H(0x11) };
  assert.equal(birthIdempotencyScope(base), birthIdempotencyScope({ ...base, stateMachine: "0xabcdef" }));
  assert.notEqual(birthIdempotencyScope(base), birthIdempotencyScope({ ...base, planId: H(0x12) }));
  assert.notEqual(birthIdempotencyScope(base), birthIdempotencyScope({ ...base, chainId: 84532 }));
});
