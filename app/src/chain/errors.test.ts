// 自定义合约错误必须从 revert data 解码到具名 error + args；解不出时
// 不伪造错误名，避免把链上拒绝显示成通用文案或成功。

import assert from "node:assert/strict";
import test from "node:test";
import { encodeErrorResult, parseAbi, type Hex } from "viem";
import { decodeContractError } from "./errors";
import { mapWalletError } from "./input";

const H = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const WALLET = `0x${"ab".repeat(20)}` as const;
const IDEMPOTENCY_KEY = H(0x21);
const EXISTING_ORDER = H(0x42);

const errorsAbi = parseAbi([
  "error DuplicateTriggerKey(address submitter, bytes32 idempotencyKey, bytes32 existingOrderId)"
]);

test("DuplicateTriggerKey 解码出 existingOrderId，并保留在 mapWalletError 结果里", () => {
  const data = encodeErrorResult({
    abi: errorsAbi,
    errorName: "DuplicateTriggerKey",
    args: [WALLET, IDEMPOTENCY_KEY, EXISTING_ORDER]
  });

  const decoded = decodeContractError({ data });
  assert.equal(decoded?.errorName, "DuplicateTriggerKey");
  assert.equal(decoded?.args?.[2], EXISTING_ORDER);

  const mapped = mapWalletError(new Error("execution reverted", { cause: { data } }));
  assert.equal(mapped.code, "reverted");
  assert.equal(mapped.revert?.errorName, "DuplicateTriggerKey");
  assert.equal(mapped.revert?.args?.[2], EXISTING_ORDER);
  assert.match(mapped.message, /DuplicateTriggerKey/u);
  assert.match(mapped.message, new RegExp(EXISTING_ORDER.slice(2), "u"));
});

test("无法解码的 revert data 不伪造错误名", () => {
  assert.equal(decodeContractError({ data: "0xdeadbeef" }), undefined);
  const mapped = mapWalletError({ data: "0xdeadbeef" });
  assert.equal(mapped.code, "unknown");
  assert.equal(mapped.revert, undefined);
});
