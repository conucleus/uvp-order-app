import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeEventLog, encodeErrorResult, keccak256, toFunctionSelector, toHex } from "viem";
import { STAGE_ESCROW_ABI } from "./abi.js";
import {
  EscrowActionError,
  buildStageEscrowCall,
  encodeStageEscrowCall
} from "./actions.js";
import { escrowRevertMessage, findDecodedRevert } from "./wallet.js";

const trancheId = `0x${"22".repeat(32)}`;
const wallet = "0x1111111111111111111111111111111111111111";

describe("escrow action parameters and revert copy", () => {
  it("builds markStarted, approve and double-sign settlement calls without sending", () => {
    assert.deepEqual(buildStageEscrowCall("markStarted", trancheId), {
      functionName: "markStarted",
      args: [trancheId]
    });
    assert.equal(
      encodeStageEscrowCall(buildStageEscrowCall("markStarted", trancheId)).slice(0, 10),
      toFunctionSelector("markStarted(bytes32)")
    );
    assert.deepEqual(buildStageEscrowCall("approve", trancheId), {
      functionName: "approve",
      args: [trancheId]
    });
    assert.deepEqual(buildStageEscrowCall("consentSettlement", trancheId, {
      payerAmount: "0.2",
      payeeAmount: "0.8"
    }), {
      functionName: "consentSettlement",
      args: [trancheId, 200000n, 800000n]
    });
    assert.throws(
      () => buildStageEscrowCall("consentSettlement", trancheId, { payerAmount: "0.2" }),
      (error: unknown) =>
        error instanceof EscrowActionError &&
        error.code === "invalid_input" &&
        /履约方获得金额/u.test(error.message)
    );
  });

  it("keeps the ABI event surface aligned with the contract's TrancheStarted", () => {
    const payee = "0x3333333333333333333333333333333333333333";
    const decoded = decodeEventLog({
      abi: STAGE_ESCROW_ABI,
      eventName: "TrancheStarted",
      data: "0x",
      topics: [
        keccak256(toHex("TrancheStarted(bytes32,address)")),
        trancheId as `0x${string}`,
        `0x${"0".repeat(24)}${payee.slice(2)}` as `0x${string}`
      ]
    });
    assert.equal(decoded.args.payee, payee);
  });

  it("maps custom contract errors to precise participant copy", () => {
    assert.match(
      escrowRevertMessage("InvalidTrancheState", [trancheId, 2]),
      /当前状态不允许该操作（链上状态：已开始履约）/u
    );
    assert.match(
      escrowRevertMessage("InvalidTrancheState", [trancheId, 6]),
      /当前状态不允许该操作（链上状态：已付款）/u
    );
    assert.match(
      escrowRevertMessage("NotPayer", [wallet, wallet]),
      /当前钱包不是本阶段付款方（合约记录的付款方 0x1111\.\.\.1111）/u
    );
    assert.match(
      escrowRevertMessage("InvalidSettlement", [200000n, 800000n, 1000000n]),
      /0\.200000 \+ 履约方 0\.800000 必须等于冻款金额 1\.000000/u
    );
    // 钱包把 revert 藏在嵌套 error.data 里（MetaMask/viem 常见形状）时仍能定位。
    const nestedRevert = encodeErrorResult({
      abi: STAGE_ESCROW_ABI,
      errorName: "InvalidTrancheState",
      args: [trancheId as `0x${string}`, 6]
    });
    assert.equal(
      findDecodedRevert({ code: -32603, data: { originalError: { data: nestedRevert } } })?.name,
      "InvalidTrancheState"
    );
  });
});
