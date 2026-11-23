// 浏览器恢复态：待 finalize 的 commitPlan 记录与带 plan 作用域的出生承诺
// 必须跨刷新/重试保留；localStorage 只存这两项事实，读取时逐字段校验，坏记录
// 直接删除而不是猜默认值。钱包/链上事实仍以链为准。

import { isAddress, type Hash } from "viem";
import { parseBytes32, type Bytes32 } from "../chain/input";

const PENDING_FINALIZE_KEY = "uvp.orderApp.pendingFinalize.v1";
const BIRTH_IDEMPOTENCY_KEY = "uvp.orderApp.birthIdempotency.v2";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PendingPlanFinalize {
  readonly planId: Bytes32;
  readonly commitTx: Hash;
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
  const commitTx = parseBytes32(
    typeof record["commitTx"] === "string" ? record["commitTx"] : "",
    "pendingFinalize.commitTx"
  );
  const publisher = typeof record["publisher"] === "string" ? record["publisher"] : "";
  if (!planId.ok || !commitTx.ok || !isAddress(publisher)) {
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
      commitTx: pending.commitTx,
      publisher: pending.publisher
    })
  );
}

export function clearPendingPlanFinalize(
  storage: KeyValueStorage | undefined = browserStorage()
): void {
  removeKey(storage, PENDING_FINALIZE_KEY);
}

export interface BirthIdempotencyRecord {
  readonly scope: string;
  readonly key: Bytes32;
}

export function birthIdempotencyScope(input: {
  readonly chainId: number;
  readonly stateMachine: string;
  readonly planId: string;
}): string {
  return `${String(input.chainId)}:${input.stateMachine.toLowerCase()}:${input.planId.toLowerCase()}`;
}

export function readBirthIdempotencyRecord(
  storage: KeyValueStorage | undefined = browserStorage()
): BirthIdempotencyRecord | undefined {
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
  const record = parsed as Record<string, unknown>;
  const key = parseBytes32(
    typeof record["key"] === "string" ? record["key"] : "",
    "birthIdempotencyKey"
  );
  const scope = typeof record["scope"] === "string" ? record["scope"].trim() : "";
  if (!key.ok || scope === "") {
    removeKey(storage, BIRTH_IDEMPOTENCY_KEY);
    return undefined;
  }
  return { scope, key: key.value };
}

export function writeBirthIdempotencyRecord(
  record: BirthIdempotencyRecord,
  storage: KeyValueStorage | undefined = browserStorage()
): void {
  writeRaw(storage, BIRTH_IDEMPOTENCY_KEY, JSON.stringify({ scope: record.scope, key: record.key }));
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
