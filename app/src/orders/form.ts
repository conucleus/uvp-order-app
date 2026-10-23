import type {
  CreateOrderDraftInput,
  ProductOrderDraftStatus,
  UpdateOrderDraftInput,
  ZhixuSummaryDTO
} from "../api/productApi";
import type { CreateOrderFormValues, PublishedZhixuSummary } from "./types";

/**
 * 开单表单的纯校验/映射（不触碰网络与钱包）。
 *
 * 口径：只校验"档案面必填项"，不替发布方发明业务规则。车辆/单证摘要
 * 作为交易内容必填，其余格式仅在可判定的范围内拒绝（金额必须为正数）。
 */

export const REQUIRED_ORDER_FIELD_LABELS = [
  "订单名称",
  "业务类型",
  "车辆与单证摘要",
  "成交总额",
  "币种"
] as const;

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

/** 返回一条可直接展示的校验文案；通过时返回 undefined。 */
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

/** 摘要每行一条，忽略空行（与服务端 goods[] 形状一致）。 */
export function goodsFromSummary(goodsText: string): readonly string[] {
  return goodsText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 表单 → 创建草稿请求（只带服务端接受的字段）。 */
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

/** 表单 → 修改草稿请求（不重复发送不可变字段）。 */
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

/**
 * 目录过滤：只保留已发布秩序。planPublication.status 是服务端发布事实，
 * 客户端不根据 reviewLabel 文案猜发布状态。
 */
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

/** 触发流程中的草稿不可再改内容；draft/failed/ready_to_trigger 可编辑。 */
export function isOrderDraftEditable(status: ProductOrderDraftStatus): boolean {
  return status !== "triggering" && status !== "triggered" && status !== "cancelled";
}

/**
 * 触发前门：服务端只接受 ready_to_trigger（首次）与 failed（同身份重试）。
 * 与 useOrderRegistrationFlow 的 canPrepareOrderTrigger 同口径。
 */
export function canPrepareOrderTrigger(status: ProductOrderDraftStatus): boolean {
  return status === "ready_to_trigger" || status === "failed";
}

/** 参与方邀请链接：一次性 token 放 search（与邀请入口读取口径一致）。 */
export function buildInviteLink(baseHref: string, inviteId: string, inviteToken: string): string {
  const url = new URL(baseHref);
  url.search = "";
  url.hash = "";
  url.searchParams.set("invite", inviteId);
  url.searchParams.set("inviteToken", inviteToken);
  return url.toString();
}
