import {
  type ProductSelectableTargetDTO,
  type ProductTaskDTO,
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
 * 装修数据 → 订单工作台展示/证据要求的纯映射：装修是 Store 数据域的可删除
 * 投影，不是链上事实；本模块只做结构读取，不做业务判断、不写回。
 */

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

export function planIdForZhixu(zhixu: Pick<ZhixuDetailDTO, "planPublication">): string | undefined {
  const planId = zhixu.planPublication.planId?.trim();
  return planId ? planId : undefined;
}

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
