import type {
  CreateOrderDraftInput,
  UpdateOrderDraftInput,
  ZhixuSummaryDTO
} from "../api/productApi";
import type { CreateOrderFormValues, PublishedZhixuSummary } from "./types";

export function missingRequiredOrderFields(values: CreateOrderFormValues): readonly string[] {
  const missing: string[] = [];
  if (!values.title.trim()) {
    missing.push("订单名称");
  }
  if (!values.businessType.trim()) {
    missing.push("业务类型");
  }
  if (goodsFromSummary(values.goodsText).length === 0) {
    missing.push("车辆与单证摘要");
  }
  if (!values.totalAmount.trim()) {
    missing.push("成交总额");
  }
  if (!values.currency.trim()) {
    missing.push("币种");
  }
  return missing;
}

export function orderFormValidationError(values: CreateOrderFormValues): string | undefined {
  const missing = missingRequiredOrderFields(values);
  if (missing.length > 0) {
    return `请先填写：${missing.join("、")}。`;
  }
  const amount = values.totalAmount.trim();
  if (!/^\d+(?:\.\d+)?$/u.test(amount) || Number(amount) <= 0) {
    return "成交总额需要是大于 0 的数字。";
  }
  return undefined;
}

export function goodsFromSummary(goodsText: string): readonly string[] {
  return goodsText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function createDraftInputFromValues(
  zhixuId: string,
  values: CreateOrderFormValues
): CreateOrderDraftInput {
  const goods = goodsFromSummary(values.goodsText);
  const notes = values.notes.trim();
  return {
    zhixuId,
    title: values.title.trim(),
    businessType: values.businessType.trim(),
    ...(goods.length > 0 ? { goods } : {}),
    totalAmount: values.totalAmount.trim(),
    currency: values.currency.trim(),
    ...(notes ? { notes } : {})
  };
}

export function updateDraftInputFromValues(values: CreateOrderFormValues): UpdateOrderDraftInput {
  const goods = goodsFromSummary(values.goodsText);
  const notes = values.notes.trim();
  return {
    title: values.title.trim(),
    businessType: values.businessType.trim(),
    goods,
    totalAmount: values.totalAmount.trim(),
    currency: values.currency.trim(),
    notes
  };
}

export function publishedZhixuSummaries(
  items: readonly ZhixuSummaryDTO[]
): readonly PublishedZhixuSummary[] {
  return items
    .filter((item) => item.planPublication?.status === "published")
    .map((item) => ({
      zhixuId: item.zhixuId,
      title: item.title,
      subtitle: item.subtitle,
      reviewLabel: item.reviewLabel,
      publicationLabel: item.planPublication.label,
      stageCount: item.stageCount,
      roleSlotCount: item.roleSlotCount,
      applicableBusiness: item.applicableBusiness,
      supportedPaymentMethods: item.supportedPaymentMethods,
      updatedAt: item.updatedAt
    }));
}



export function buildInviteLink(baseHref: string, inviteId: string, inviteToken: string): string {
  const url = new URL(baseHref);
  url.search = "";
  url.hash = "";
  url.searchParams.set("invite", inviteId);
  url.searchParams.set("inviteToken", inviteToken);
  return url.toString();
}
