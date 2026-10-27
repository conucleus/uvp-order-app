// 发信号入口的行为不变量：attribution JSON 只接受 stageId/proof[]（坏输入具名，
// 不静默退化成零元组）；钱包拒绝/revert 具名，不伪装成功。calldata 编码本身由
// uvp-client core 拥有，不在这里重测。

import assert from "node:assert/strict";
import test from "node:test";
import { mapWalletError, parseAttributionJson } from "./input";

const STAGE = `0x${"1".repeat(64)}`;
const PROOF = `0x${"2".repeat(64)}`;

test("attribution JSON：空=不传；合法 stageId/proof 解析；未知字段具名拒绝", () => {
  assert.deepEqual(parseAttributionJson(" "), { ok: true, value: undefined });
  assert.deepEqual(parseAttributionJson(JSON.stringify({ stageId: STAGE, proof: [PROOF] })), {
    ok: true,
    value: { stageId: STAGE, proof: [PROOF] }
  });

  const unknown = parseAttributionJson(JSON.stringify({ stageId: STAGE, extra: true }));
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.field, "attribution");
    assert.match(unknown.message, /stageId\/proof/u);
  }
});

test("钱包拒绝与 revert 具名，不吞成 unknown/成功", () => {
  assert.deepEqual(mapWalletError({ code: 4001 }), {
    code: "user_rejected",
    message: "钱包拒绝了签名/交易"
  });
  assert.equal(
    mapWalletError(new Error("execution reverted: UnauthorizedSignalSubmitter")).code,
    "reverted"
  );
});
