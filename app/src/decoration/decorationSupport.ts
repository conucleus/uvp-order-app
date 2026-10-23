import {
  validateTaskEvidenceSpec,
  type ProductSelectableTargetDTO,
  type ProductTaskDTO,
  type TaskEvidenceSpecDTO,
  type ZhixuDetailDTO,
  type ZhixuStageDTO
} from "@uvp-eth/product-dto";
import type {
  DecorationEvidenceSlotView,
  DecorationTaskDeclarationView,
  DecorationThemeView,
  ZhixuDecorationView
} from "./types";

/**
 * 装修数据 → 订单工作台展示/证据要求的纯映射。
 *
 * 边界：
 * - 装修数据是 Store 数据域的可删除投影，不是链上事实；本模块只做结构读取，
 *   不做业务判断、不写回、不内置任何行业字段。
 * - 任务自己的 evidenceSpec（发布者随秩序 schema 携带）优先；装修
 *   taskDeclarations 只在任务没有 evidenceSpec 时补位，来源显式标记。
 * - 非法 / 空声明一律不合成槽位（validateTaskEvidenceSpec 同源结构校验）。
 */

export type TaskEvidenceSource = "task" | "decoration" | "none";

export interface DecoratedTaskEvidence {
  readonly task: ProductTaskDTO;
  readonly source: TaskEvidenceSource;
}

/** 当前版本 theme（无装修数据或旧版本缺字段时返回 undefined，由调用方决定展示）。 */
export function decorationTheme(decoration: ZhixuDecorationView | undefined): DecorationThemeView | undefined {
  const theme = decoration?.current?.data.theme;
  if (!theme) {
    return undefined;
  }
  const displayName = theme.displayName?.trim();
  const description = theme.description?.trim();
  const tags = (theme.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  const highlights = (theme.highlights ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  if (!displayName && !description && tags.length === 0 && highlights.length === 0) {
    return undefined;
  }
  return {
    ...(displayName ? { displayName } : {}),
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(highlights.length > 0 ? { highlights } : {})
  };
}

/** 阶段证据槽位（reader 页展示用）：同一阶段可有多条声明，按 key 去重合并。 */
export function decorationSlotsForStage(
  decoration: ZhixuDecorationView | undefined,
  stageId: string
): readonly DecorationEvidenceSlotView[] {
  const declarations = declarationsForStage(decoration, stageId);
  const byKey = new Map<string, DecorationEvidenceSlotView>();
  for (const declaration of declarations) {
    for (const slot of declaration.evidenceSpec ?? []) {
      const key = slot.key?.trim();
      const label = slot.label?.trim();
      if (!key || !label || byKey.has(key)) {
        continue;
      }
      byKey.set(key, { ...slot, key, label });
    }
  }
  return [...byKey.values()];
}

/**
 * 任务证据要求补位：任务自带 evidenceSpec（含非法 spec）时一律不覆盖——
 * 服务端下发的发布者声明优先；只有缺失时才按 taskId（精确）→ stageId 匹配
 * 装修声明，并通过与发布端同源的 validateTaskEvidenceSpec 校验。
 */
export function decorationEvidenceSpecForTask(
  decoration: ZhixuDecorationView | undefined,
  task: Pick<ProductTaskDTO, "taskId" | "stageId">
): readonly TaskEvidenceSpecDTO[] | undefined {
  const taskId = task.taskId?.trim();
  const declarations = (decoration?.current?.data.taskDeclarations ?? []).filter(
    (declaration) => (declaration.evidenceSpec?.length ?? 0) > 0
  );
  const exact = taskId
    ? declarations.find((declaration) => declaration.taskId?.trim() === taskId)
    : undefined;
  const candidates = exact ? [exact] : declarationsForStage(decoration, task.stageId);
  for (const declaration of candidates) {
    const spec = evidenceSpecFromDeclaration(declaration);
    if (spec) {
      return spec;
    }
  }
  return undefined;
}

/** 给任务挂上装修补位的 evidenceSpec；来源用于界面如实标注。 */
export function decorateTaskEvidenceSpec(
  task: ProductTaskDTO,
  decoration: ZhixuDecorationView | undefined
): DecoratedTaskEvidence {
  if (task.evidenceSpec !== undefined) {
    return { task, source: "task" };
  }
  const spec = decorationEvidenceSpecForTask(decoration, task);
  if (!spec) {
    return { task, source: "none" };
  }
  return { task: { ...task, evidenceSpec: spec }, source: "decoration" };
}

/** 任务所属秩序计划的装修键（ZhixuDetailDTO.planPublication.planId）。 */
export function planIdForZhixu(zhixu: Pick<ZhixuDetailDTO, "planPublication">): string | undefined {
  const planId = zhixu.planPublication.planId?.trim();
  return planId ? planId : undefined;
}

/**
 * DSL selectedStages 派生的可选项：当秩序 schema 在某个阶段声明了
 * selectedStageTargets（订单内选择执行者的目标阶段），该阶段的任务即可选。
 * 订单/任务投影已有 selectableTargets 时不使用本兜底（调用方优先投影）。
 */
export function selectableTargetsFromZhixuStage(
  zhixu: ZhixuDetailDTO | undefined,
  task: Pick<ProductTaskDTO, "taskId" | "stageId">
): readonly ProductSelectableTargetDTO[] {
  const stage = stageForTask(zhixu, task.stageId);
  const targetIds = stage?.selectedStageTargets?.filter((id) => id.trim().length > 0) ?? [];
  if (!stage || targetIds.length === 0) {
    return [];
  }
  return targetIds.map((targetStageId) => {
    const target = zhixu?.stages.find((item) => sameStageId(item.stageId, targetStageId));
    return {
      targetStageId,
      targetStageName: target?.name ?? targetStageId,
      allowed: true,
      selectorStageId: stage.stageId
    };
  });
}

/**
 * reader 页的阶段执行者说明：只陈述"该阶段执行者在订单内选定"这一事实，
 * 不引入静态/动态执行者等产品概念。噪声来源两处：阶段声明 selectedStages
 * 的目标，或阶段自身标记 executorAssignment=selected。
 */
export function stageExecutorSelectionNote(
  zhixu: ZhixuDetailDTO,
  stage: Pick<ZhixuStageDTO, "stageId">
): string | undefined {
  const selector = zhixu.stages.find(
    (candidate) =>
      candidate.stageId !== stage.stageId &&
      (candidate.selectedStageTargets ?? []).some((target) => sameStageId(target, stage.stageId))
  );
  if (selector) {
    return `执行者：由〈${selector.name}〉阶段在订单内选定`;
  }
  const target = zhixu.stages.find((candidate) => sameStageId(candidate.stageId, stage.stageId));
  if (target?.executorAssignment === "selected") {
    return "执行者：按约定在订单内选定";
  }
  return undefined;
}

function declarationsForStage(
  decoration: ZhixuDecorationView | undefined,
  stageId: string
): readonly DecorationTaskDeclarationView[] {
  const normalized = stageId?.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  return (decoration?.current?.data.taskDeclarations ?? []).filter(
    (declaration) => declaration.stageId?.trim().toLowerCase() === normalized
  );
}

function evidenceSpecFromDeclaration(
  declaration: DecorationTaskDeclarationView
): readonly TaskEvidenceSpecDTO[] | undefined {
  const spec = (declaration.evidenceSpec ?? [])
    .filter((slot) => typeof slot?.key === "string" && slot.key.trim().length > 0)
    .filter((slot) => typeof slot?.label === "string" && slot.label.trim().length > 0)
    .map((slot): TaskEvidenceSpecDTO => ({
      key: slot.key.trim(),
      label: slot.label.trim(),
      ...(slot.inputKind !== undefined ? { inputKind: slot.inputKind } : {}),
      ...(slot.accept !== undefined ? { accept: slot.accept } : {}),
      ...(slot.required !== undefined ? { required: slot.required } : {}),
      ...(slot.description !== undefined ? { description: slot.description } : {})
    }));
  if (spec.length === 0) {
    return undefined;
  }
  // 与服务端 validateTaskEvidenceSpec 同一结构校验：非法声明整体丢弃，
  // 不渲染半份槽位（重复 key / accept 用在文本槽位等都会在这里被拒）。
  return validateTaskEvidenceSpec(spec).length === 0 ? spec : undefined;
}

function stageForTask(
  zhixu: ZhixuDetailDTO | undefined,
  stageId: string
): ZhixuStageDTO | undefined {
  return zhixu?.stages.find((stage) => sameStageId(stage.stageId, stageId));
}

function sameStageId(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
