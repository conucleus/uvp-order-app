import type { TaskEvidenceInputKind, ZhixuDetailDTO } from "@uvp-eth/product-dto";

/**
 * 装修数据读取面（Store 数据域的展示投影，不是链上事实）。
 *
 * 结构镜像 uvp-chain-services 的 `store-zhixu-decoration.v1`：theme 纯展示、
 * taskDeclarations 按 stage/task 声明 evidenceSpec。本端只做结构读取与校验，
 * 不写回、不缓存成第二份事实；取不到就是取不到（由调用方显式呈现）。
 */
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
  readonly evidenceSpec?: readonly DecorationEvidenceSlotView[] | undefined;
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

/** 一条 zhixu 的装修快照：秩序详情来自 Product API，装修数据来自 Store API。 */
export interface ZhixuDecorationSnapshot {
  readonly zhixuId: string;
  readonly zhixu?: ZhixuDetailDTO | undefined;
  readonly decoration?: ZhixuDecorationView | undefined;
  /** 装修数据请求失败原因；缺省表示"已取到（可能为空版本）"。 */
  readonly decorationError?: string | undefined;
}
