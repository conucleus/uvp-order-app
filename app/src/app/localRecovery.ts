// 浏览器恢复态：待 finalize 的 commitPlan 记录与按 plan 作用域保存的出生承诺
// 必须跨刷新/重试保留；localStorage 只存这两类事实，读取时逐字段校验，坏记录
// 直接删除而不是猜默认值。出生键按 chain/stateMachine/planId 作用域分别保存，
// 切换 artifact 不会覆盖其它计划的键。钱包/链上事实仍以链为准。

import { isAddress, type Hash } from "viem";
import { parseBytes32, type Bytes32 } from "../chain/input";

const PENDING_FINALIZE_KEY = "uvp.orderApp.pendingFinalize.v1";
const BIRTH_IDEMPOTENCY_KEY = "uvp.orderApp.birthIdempotency.v3";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PendingPlanFinalize {
  readonly planId: Bytes32;
  /** commitPlan tx hash when known; absent after PlanAlreadyRegistered recovery. */
  readonly commitTx?: Hash | undefined;
  readonly publisher: `0x${string}`;
}

export function browserStorage(): KeyValueStorage | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readPendingPlanFinalize(
  storage: KeyValueStorage | undefined = browserStorage()
): PendingPlanFinalize | undefined {
  const raw = readRaw(storage, PENDING_FINALIZE_KEY);
  if (raw === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeKey(storage, PENDING_FINALIZE_KEY);
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    removeKey(storage, PENDING_FINALIZE_KEY);
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const planId = parseBytes32(
    typeof record["planId"] === "string" ? record["planId"] : "",
    "pendingFinalize.planId"
  );
  const publisher = typeof record["publisher"] === "string" ? record["publisher"] : "";
  if (!planId.ok || !isAddress(publisher)) {
    removeKey(storage, PENDING_FINALIZE_KEY);
    return undefined;
  }
  if (record["commitTx"] === undefined) {
    return { planId: planId.value, publisher };
  }
  const commitTx = parseBytes32(
    typeof record["commitTx"] === "string" ? record["commitTx"] : "",
    "pendingFinalize.commitTx"
  );
  if (!commitTx.ok) {
    removeKey(storage, PENDING_FINALIZE_KEY);
    return undefined;
  }
  return { planId: planId.value, commitTx: commitTx.value, publisher };
}

export function writePendingPlanFinalize(
  pending: PendingPlanFinalize,
  storage: KeyValueStorage | undefined = browserStorage()
): void {
  writeRaw(
    storage,
    PENDING_FINALIZE_KEY,
    JSON.stringify({
      planId: pending.planId,
      ...(pending.commitTx === undefined ? {} : { commitTx: pending.commitTx }),
      publisher: pending.publisher
    })
  );
}

export function clearPendingPlanFinalize(
  storage: KeyValueStorage | undefined = browserStorage()
): void {
  removeKey(storage, PENDING_FINALIZE_KEY);
}

export function birthIdempotencyScope(input: {
  readonly chainId: number;
  readonly stateMachine: string;
  readonly planId: string;
}): string {
  return `${String(input.chainId)}:${input.stateMachine.toLowerCase()}:${input.planId.toLowerCase()}`;
}

export function readBirthIdempotencyKey(
  scope: string,
  storage: KeyValueStorage | undefined = browserStorage()
): Bytes32 | undefined {
  const records = readBirthIdempotencyStore(storage);
  if (records === undefined) {
    return undefined;
  }
  const value = records[scope];
  if (value === undefined) {
    return undefined;
  }
  const key = parseBytes32(typeof value === "string" ? value : "", `birthIdempotency[${scope}]`);
  if (!key.ok) {
    removeBirthIdempotencyKey(scope, storage);
    return undefined;
  }
  return key.value;
}

export function writeBirthIdempotencyKey(
  scope: string,
  key: Bytes32,
  storage: KeyValueStorage | undefined = browserStorage()
): void {
  const records = readBirthIdempotencyStore(storage) ?? {};
  records[scope] = key;
  writeRaw(storage, BIRTH_IDEMPOTENCY_KEY, JSON.stringify(records));
}

export function removeBirthIdempotencyKey(
  scope: string,
  storage: KeyValueStorage | undefined = browserStorage()
): void {
  const records = readBirthIdempotencyStore(storage);
  if (records === undefined || !(scope in records)) {
    return;
  }
  delete records[scope];
  writeRaw(storage, BIRTH_IDEMPOTENCY_KEY, JSON.stringify(records));
}

function readBirthIdempotencyStore(
  storage: KeyValueStorage | undefined
): Record<string, unknown> | undefined {
  const raw = readRaw(storage, BIRTH_IDEMPOTENCY_KEY);
  if (raw === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeKey(storage, BIRTH_IDEMPOTENCY_KEY);
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    removeKey(storage, BIRTH_IDEMPOTENCY_KEY);
    return undefined;
  }
  const records: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key.trim() !== "") {
      records[key] = value;
    }
  }
  return records;
}

function readRaw(storage: KeyValueStorage | undefined, key: string): string | undefined {
  if (storage === undefined) {
    return undefined;
  }
  try {
    return storage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeRaw(storage: KeyValueStorage | undefined, key: string, value: string): void {
  if (storage === undefined) {
    return;
  }
  try {
    storage.setItem(key, value);
  } catch {
    return;
  }
}

function removeKey(storage: KeyValueStorage | undefined, key: string): void {
  if (storage === undefined) {
    return;
  }
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
}
