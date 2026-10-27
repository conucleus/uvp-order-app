// 链配置严格校验：缺失/非法 env 显式返回问题码，不猜默认链/地址。

import assert from "node:assert/strict";
import test from "node:test";
import { readChainConfig } from "./config";

const VALID = {
  VITE_UVP_STATE_MACHINE: "0x1111111111111111111111111111111111111111",
  VITE_CHAIN_ID: "31337",
  VITE_RPC_URL: "http://127.0.0.1:8545",
  VITE_UVP_FROM_BLOCK: "0"
};

test("合法配置解析；fromBlock 缺省 0", () => {
  const result = readChainConfig(VALID);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.chainId, 31337);
    assert.equal(result.config.fromBlock, 0n);
    assert.equal(result.config.chunkSize, 50_000n);
  }
});

test("缺失/非法字段具名，且不猜默认值", () => {
  assert.deepEqual(readChainConfig({}), { ok: false, problem: "missing_state_machine" });
  assert.deepEqual(readChainConfig({ ...VALID, VITE_UVP_STATE_MACHINE: "0x12" }), {
    ok: false,
    problem: "invalid_state_machine"
  });
  assert.deepEqual(readChainConfig({ ...VALID, VITE_CHAIN_ID: "0" }), {
    ok: false,
    problem: "invalid_chain_id"
  });
  assert.deepEqual(readChainConfig({ ...VALID, VITE_RPC_URL: "ws://x" }), {
    ok: false,
    problem: "invalid_rpc_url"
  });
  assert.deepEqual(readChainConfig({ ...VALID, VITE_UVP_FROM_BLOCK: "-1" }), {
    ok: false,
    problem: "invalid_from_block"
  });
});
