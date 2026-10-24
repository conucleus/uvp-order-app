import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EscrowActionError, buildStageEscrowCall } from "./actions.js";
import { escrowRevertMessage } from "./wallet.js";

const trancheId = `0x${"22".repeat(32)}`;
const wallet = "0x1111111111111111111111111111111111111111";

describe("escrow action parameters and revert copy", () => {
  it("builds approve and double-sign settlement calls without sending", () => {
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

  it("maps custom contract errors to precise participant copy", () => {
    assert.match(
      escrowRevertMessage("InvalidTrancheState", [trancheId, 5]),
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
  });
});
