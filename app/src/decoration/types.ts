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

export interface ZhixuDecorationSnapshot {
  readonly zhixuId: string;
  readonly zhixu?: ZhixuDetailDTO | undefined;
  readonly decoration?: ZhixuDecorationView | undefined;
  readonly decorationError?: string | undefined;
}
