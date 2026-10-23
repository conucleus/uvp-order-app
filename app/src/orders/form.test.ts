import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ZhixuSummaryDTO } from "@uvp-eth/product-dto";
import {
  buildInviteLink,
  canPrepareOrderTrigger,
  createDraftInputFromValues,
  goodsFromSummary,
  isOrderDraftEditable,
  missingRequiredOrderFields,
  orderFormValidationError,
  publishedZhixuSummaries,
  updateDraftInputFromValues
} from "./form";
import { emptyOrderFormValues } from "./types";

const completeValues = {
  ...emptyOrderFormValues(),
  title: "  中亚二手车出口订单  ",
  businessType: "二手车出口",
  goodsText: "2021 款 SUV，4.2 万公里\n\n出口报关单与检测报告随车\n",
  totalAmount: "128000",
  currency: "USDC",
  notes: "  9 月发运  "
};

function zhixuSummary(overrides: Partial<ZhixuSummaryDTO> = {}): ZhixuSummaryDTO {
  return {
    zhixuId: "zhixu-used-car",
    title: "二手车出口秩序",
    subtitle: "九步逐段确认",
    reviewStatus: "approved",
    reviewLabel: "已审核",
    riskLevel: "中",
    applicableBusiness: ["二手车出口"],
    excludedBusiness: [],
    stageCount: 9,
    roleSlotCount: 4,
    supportedPaymentMethods: ["USDC"],
    maintainer: "运营方",
    updatedAt: "2026-10-23T00:00:00.000Z",
    planPublication: {
      status: "published",
      label: "已发布",
      stateMachineLabel: "UVPStateMachine",
      planId: "0xplan",
      planHash: "0xhash"
    },
    ...overrides
  };
}

describe("create-order form", () => {
  it("lists every missing required field and trims the summary", () => {
    const empty = emptyOrderFormValues();
    assert.deepEqual(missingRequiredOrderFields(empty), [
      "订单名称",
      "业务类型",
      "车辆与单证摘要",
      "成交总额",
      "币种"
    ]);
    assert.match(orderFormValidationError(empty) ?? "", /请先填写/u);
    assert.deepEqual(goodsFromSummary(" a \n\n b \n"), ["a", "b"]);
  });

  it("rejects non-positive amounts and builds the draft request without empty fields", () => {
    assert.equal(orderFormValidationError({ ...completeValues, totalAmount: "0" }), "成交总额需要是大于 0 的数字。");
    assert.equal(orderFormValidationError({ ...completeValues, totalAmount: "1,000" }), "成交总额需要是大于 0 的数字。");
    assert.equal(orderFormValidationError(completeValues), undefined);

    const input = createDraftInputFromValues("zhixu-used-car", completeValues);
    assert.equal(input.title, "中亚二手车出口订单");
    assert.deepEqual(input.goods, ["2021 款 SUV，4.2 万公里", "出口报关单与检测报告随车"]);
    assert.equal(input.notes, "9 月发运");

    const withoutOptional = createDraftInputFromValues("zhixu-used-car", {
      ...completeValues,
      goodsText: "   ",
      notes: "  "
    });
    assert.equal(withoutOptional.goods, undefined);
    assert.equal(withoutOptional.notes, undefined);
  });

  it("updates the same editable archive fields and never resends zhixuId", () => {
    const update = updateDraftInputFromValues(completeValues);
    assert.equal("zhixuId" in update, false);
    assert.equal(update.title, "中亚二手车出口订单");
    assert.deepEqual(update.goods, ["2021 款 SUV，4.2 万公里", "出口报关单与检测报告随车"]);
  });

  it("keeps only server-published catalogs", () => {
    const items = [
      zhixuSummary(),
      zhixuSummary({
        zhixuId: "zhixu-unpublished",
        planPublication: {
          status: "not_found",
          label: "未找到发布记录",
          stateMachineLabel: "UVPStateMachine",
          planId: "0xplan2",
          planHash: "0xhash2"
        }
      })
    ];
    const published = publishedZhixuSummaries(items);
    assert.deepEqual(published.map((item) => item.zhixuId), ["zhixu-used-car"]);
    assert.equal(published[0]?.publicationLabel, "已发布");
    assert.equal(published[0]?.stageCount, 9);
  });

  it("gates editing and triggering on the server draft status", () => {
    assert.equal(isOrderDraftEditable("draft"), true);
    assert.equal(isOrderDraftEditable("ready_to_trigger"), true);
    assert.equal(isOrderDraftEditable("failed"), true);
    assert.equal(isOrderDraftEditable("triggering"), false);
    assert.equal(isOrderDraftEditable("triggered"), false);
    assert.equal(canPrepareOrderTrigger("ready_to_trigger"), true);
    assert.equal(canPrepareOrderTrigger("failed"), true);
    assert.equal(canPrepareOrderTrigger("awaiting_participants"), false);
  });

  it("builds an invite link that the existing invite entry can read", () => {
    const link = buildInviteLink(
      "http://127.0.0.1:4183/?invite=old#?section=create",
      "invite-1_ab",
      "token-xyz"
    );
    const url = new URL(link);
    assert.equal(url.searchParams.get("invite"), "invite-1_ab");
    assert.equal(url.searchParams.get("inviteToken"), "token-xyz");
    assert.equal(url.hash, "");
  });
});
