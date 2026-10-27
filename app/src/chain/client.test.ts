// 纯客户端辅助测试：日志分块区间、回执失败具名。

import assert from "node:assert/strict";
import test from "node:test";
import { logChunkRanges, receiptRevertedFailure } from "./client";

test("日志分块：闭区间、按 chunkSize 切分、from>to 为空", () => {
  assert.deepEqual(logChunkRanges(0n, 10n, 4n), [
    { from: 0n, to: 3n },
    { from: 4n, to: 7n },
    { from: 8n, to: 10n }
  ]);
  assert.deepEqual(logChunkRanges(5n, 4n, 2n), []);
});

test("回执 reverted 具名并保留 txHash", () => {
  const hash = `0x${"a".repeat(64)}` as const;
  assert.deepEqual(receiptRevertedFailure(hash), {
    code: "reverted",
    message: "交易已上链但回执状态是 reverted",
    txHash: hash
  });
});
