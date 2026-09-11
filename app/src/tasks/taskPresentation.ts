import type {
  FulfillmentPluginKind,
  FulfillmentRequiredInputDTO,
  ParticipantAddOnManifestActionDTO,
  ProductTaskDTO
} from "@uvp-eth/product-dto";
import {
  addOnManifestForTask,
  executorOverlayForTask,
  isParticipantAddOnKind,
  resourceRequirementDisplays,
  taskWithAddOns,
  type ParticipantAddOnKind
} from "./addOnTypes";

export interface TaskExecutorDisplay {
  readonly performanceSlotId?: string;
  readonly performanceSlotLabel: string;
  readonly personaLabels: readonly string[];
  readonly personaLabel?: string;
  readonly assigneeRoleLabel: string;
  readonly authorizationLabel: string;
  readonly slotKey: string;
}

export function taskAddOnKind(task: ProductTaskDTO): ParticipantAddOnKind {
  const extendedTask = taskWithAddOns(task);
  if (isParticipantAddOnKind(extendedTask.addOnKind)) {
    return extendedTask.addOnKind;
  }
  if (isParticipantAddOnKind(extendedTask.capabilityPlugin?.addOnKind)) {
    return extendedTask.capabilityPlugin.addOnKind;
  }
  const manifest = addOnManifestForTask(task);
  if (isParticipantAddOnKind(manifest?.addOnKind)) {
    return manifest.addOnKind;
  }
  // 无显式加成声明（含能力插件类型缺失的投影）统一按提交执行信号渲染，
  // 收件箱/详情对缺字段数据中性降级，不 throw 白屏。
  return "submit_signal";
}

export function taskAddOnLabel(kind: ParticipantAddOnKind): string {
  switch (kind) {
    case "stage_executor_patch":
      return "调整执行者";
    case "stage_resource_patch":
      return "配置资源要求";
    case "submit_signal":
      return "提交执行信号";
  }
}

/**
 * 能力插件类型（可选读取）：投影缺失该字段时返回 undefined，调用方按
 * 中性兜底降级（zhixu-store workbenchSupport 同口径），渲染路径不因
 * 缺字段 throw 白屏。
 */
export function taskCapabilityPluginKind(task: ProductTaskDTO): FulfillmentPluginKind | undefined {
  return task.capabilityPlugin?.pluginKind;
}

export function taskPrimaryActionLabel(task: ProductTaskDTO, fallback?: string): string {
  const manifestPrimaryActionLabel = addOnManifestForTask(task)?.actions.find((action) => action.primary)?.label;
  return manifestPrimaryActionLabel ??
    task.capabilityPlugin?.primaryActionLabel ??
    task.primaryActionLabel ??
    fallback ??
    taskAddOnLabel(taskAddOnKind(task));
}

export type TaskSubmitIntent = "confirm_stage" | "reject_stage" | "raise_dispute" | "resolve_dispute";

/** 无 manifest 声明时的兜底映射：争议任务不得以 confirm_stage 提交。 */
const submitIntentByPluginKind: Readonly<Record<FulfillmentPluginKind, TaskSubmitIntent>> = {
  payment_placeholder: "confirm_stage",
  evidence_submission: "confirm_stage",
  delivery_update: "confirm_stage",
  validation_confirm: "confirm_stage",
  dispute_material: "raise_dispute"
};

/**
 * 提交意图与 zhixu-store 同源同序：manifest 显式声明的 submit_signal intent
 * 优先（发布者声明是权威），无 manifest 声明时按能力插件类型推导。
 * 两端各自单源推导会在 manifest 与插件类型不一致时得出不同 intent。
 */
export function taskSubmitIntent(task: ProductTaskDTO): TaskSubmitIntent {
  const submitActions = (addOnManifestForTask(task)?.actions ?? [])
    .filter((action) => action.actionKind === "submit_signal");
  const primary = submitActions.find((action) => action.primary) ?? submitActions[0];
  return taskSubmitIntentForAction(primary, task);
}

/**
 * manifest 驱动路径的提交意图（与 zhixu-store taskSubmitIntent 同源同序）：
 * 动作显式声明优先；未声明时按能力插件类型推导——dispute_material 的
 * 未声明动作不得兜底成 confirm_stage，否则争议任务会以确认口径提交。
 */
export function taskSubmitIntentForAction(
  action: Pick<ParticipantAddOnManifestActionDTO, "intent"> | undefined,
  task: Pick<ProductTaskDTO, "capabilityPlugin">
): TaskSubmitIntent {
  if (action?.intent) {
    return action.intent;
  }
  const pluginKind = task.capabilityPlugin?.pluginKind;
  return pluginKind ? submitIntentByPluginKind[pluginKind] ?? "confirm_stage" : "confirm_stage";
}

export function taskRequiredInputsFromCapability(
  task: ProductTaskDTO
): readonly FulfillmentRequiredInputDTO[] | undefined {
  return task.capabilityPlugin?.inputPolicy && task.capabilityPlugin.inputPolicy.length > 0
    ? task.capabilityPlugin.inputPolicy
    : task.requiredInputs;
}

export function taskResourceRequirementInputs(task: ProductTaskDTO): readonly FulfillmentRequiredInputDTO[] {
  return resourceRequirementDisplays(task).map((resource) => ({
    inputId: `resource-requirement:${resource.resourceId}`,
    label: resource.label,
    inputType: resource.documentType === "metadata" ? "text" : "evidence",
    required: resource.required,
    completed: false
  }));
}

export function taskExecutorDisplay(task: ProductTaskDTO): TaskExecutorDisplay {
  const roleLabel = cleanLabel(task.participantRoleLabel) ?? cleanLabel(task.assigneeRole) ?? "参与方";
  const slotId = cleanLabel(task.performanceSlotId) ?? cleanLabel(task.capabilityPlugin?.roleSlotId);
  const slotLabel = cleanLabel(task.performanceSlotLabel) ?? roleLabel;
  const personaLabels = uniqueLabels(task.businessPersonaLabels ?? []);
  const overlay = executorOverlayForTask(task);
  const wallet = cleanLabel(overlay?.activeExecutorWallet) ??
    cleanLabel(task.participantWallet) ??
    cleanLabel(task.assigneeWallet) ??
    "unbound";
  const slotKey = [
    task.orderId,
    slotId ?? `slot:${slotLabel}`,
    `wallet:${wallet.toLowerCase()}`
  ].join(":");

  return {
    ...(slotId ? { performanceSlotId: slotId } : {}),
    performanceSlotLabel: slotLabel,
    personaLabels,
    ...(personaLabels.length > 0 ? { personaLabel: personaLabels.join(" / ") } : {}),
    assigneeRoleLabel: roleLabel,
    authorizationLabel: overlay?.activeExecutorWallet
      ? "授权来自阶段补充"
      : slotId ? `授权按履约插槽 ${slotId}` : "授权按订单权限表",
    slotKey
  };
}

function cleanLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function uniqueLabels(labels: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels) {
    const clean = cleanLabel(label);
    if (!clean || seen.has(clean)) {
      continue;
    }
    seen.add(clean);
    result.push(clean);
  }
  return result;
}
