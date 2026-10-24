// 装修数据的展示投影类型已迁入 kernel；本文件保留 app 侧的秩序快照聚合类型。

import type { ZhixuDetailDTO } from "@uvp-eth/product-dto";
import type { ZhixuDecorationView } from "@uvp-eth/order-kernel/decoration/types";

export type {
  DecorationDataView,
  DecorationEvidenceSlotView,
  DecorationTaskDeclarationView,
  DecorationThemeView,
  DecorationVersionView,
  ZhixuDecorationView
} from "@uvp-eth/order-kernel/decoration/types";

/** 一条 zhixu 的装修快照：秩序详情来自 Product API，装修数据来自 Store API。 */
export interface ZhixuDecorationSnapshot {
  readonly zhixuId: string;
  readonly zhixu?: ZhixuDetailDTO | undefined;
  readonly decoration?: ZhixuDecorationView | undefined;
  /** 装修数据请求失败原因；缺省表示"已取到（可能为空版本）"。 */
  readonly decorationError?: string | undefined;
}
