import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProductApiError } from "../api/productApi";
import { InjectedWalletError } from "../wallet/injectedWallet";
import { orderFailureMessage, unconfirmedRequiredParticipantLabels } from "./messages";
import type { DraftParticipantDTO } from "../api/productApi";

describe("create-order failure copy", () => {
  it("maps server error codes to actionable participant language", () => {
    assert.match(
      orderFailureMessage(new ProductApiError(409, "/prepare-trigger", "required participants missing", "required_participant_missing"), "失败"),
      /必填参与方没有完成确认/u
    );
    assert.match(
      orderFailureMessage(new ProductApiError(409, "/trigger", "draft not ready", "draft_not_ready"), "失败"),
      /还没有就绪/u
    );
    assert.match(
      orderFailureMessage(new ProductApiError(409, "/trigger", "already exists", "trigger_already_exists"), "失败"),
      /已经发起过创建/u
    );
  });

  it("never calls a timeout or wallet rejection a retryable failure", () => {
    const timeout = orderFailureMessage(new ProductApiError(0, "/trigger", "请求超时"), "失败");
    assert.match(timeout, /结果未知/u);
    const rejected = orderFailureMessage(new InjectedWalletError("wallet_rejected", "user rejected"), "失败");
    assert.match(rejected, /取消了本次本人确认/u);
    assert.match(
      orderFailureMessage(new ProductApiError(401, "/product/order-drafts", "x", "wallet_identity_required"), "失败"),
      /登录状态已失效/u
    );
  });

  it("keeps server messages when no code mapping exists", () => {
    assert.equal(
      orderFailureMessage(new ProductApiError(500, "/product/order-drafts", "订单服务暂时不可用"), "兜底"),
      "订单服务暂时不可用"
    );
  });

  it("lists only required participants that have not confirmed", () => {
    const participant = (overrides: Partial<DraftParticipantDTO>): DraftParticipantDTO => ({
      participantId: "p1",
      draftId: "d1",
      roleSlotId: "buyer",
      roleLabel: "买方",
      displayName: "买方",
      contact: "",
      status: "missing",
      required: true,
      ...overrides
    });
    const missing = unconfirmedRequiredParticipantLabels([
      participant({ participantId: "p1", displayName: "买方", status: "missing" }),
      participant({ participantId: "p2", displayName: "检测方", status: "accepted", walletAddress: "0x1111111111111111111111111111111111111111" }),
      participant({ participantId: "p3", displayName: "物流方", roleSlotId: "logistics", required: false, status: "missing" })
    ]);
    assert.deepEqual(missing, ["买方"]);
  });
});
