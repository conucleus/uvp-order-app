// 装修数据的展示投影类型与 app 侧秩序快照聚合：装修是 Store 数据域的可删除
// 投影，不是链上事实；本模块只定义结构读取形状，不写回、不缓存成第二份事实。

import type { TaskEvidenceInputKind, ZhixuDetailDTO } from "@uvp-eth/product-dto";

export interface DecorationThemeView {
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly highlights?: readonly string[] | undefined;
}

export interface DecorationEvidenceSlotView {
  readonly key: string;
  readonly label: string;
  readonly inputKind?: TaskEvidenceInputKind | undefined;
  readonly accept?: readonly string[] | undefined;
  readonly required?: boolean | undefined;
  readonly description?: string | undefined;
}

export interface DecorationTaskDeclarationView {
  readonly stageId?: string | undefined;
  readonly taskId?: string | undefined;
}

export interface DecorationDataView {
  readonly schemaVersion: "store-zhixu-decoration.v1";
  readonly theme?: DecorationThemeView | undefined;
  readonly taskDeclarations?: readonly DecorationTaskDeclarationView[] | undefined;
}

export interface DecorationVersionView {
  readonly version: number;
  readonly data: DecorationDataView;
  readonly createdAt?: string | undefined;
}

export interface ZhixuDecorationView {
  readonly planId: string;
  readonly current?: DecorationVersionView | undefined;
  readonly versions: readonly DecorationVersionView[];
}

export interface ZhixuDecorationSnapshot {
  readonly zhixuId: string;
  readonly zhixu?: ZhixuDetailDTO | undefined;
  readonly decoration?: ZhixuDecorationView | undefined;
  readonly decorationError?: string | undefined;
}
