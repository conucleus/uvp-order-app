import type { FulfillmentPluginKind, FulfillmentRequiredInputDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
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

  switch (taskCapabilityPluginKind(task)) {
    case "validation_confirm":
    case "dispute_material":
    case "payment_placeholder":
    case "delivery_update":
    case "evidence_submission":
      return "submit_signal";
  }
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

export function taskCapabilityPluginKind(task: ProductTaskDTO): FulfillmentPluginKind {
  return task.capabilityPlugin?.pluginKind ?? task.fulfillmentKind ?? "evidence_submission";
}

export function taskPrimaryActionLabel(task: ProductTaskDTO, fallback?: string): string {
  const manifestPrimaryActionLabel = addOnManifestForTask(task)?.actions.find((action) => action.primary)?.label;
  return manifestPrimaryActionLabel ??
    task.capabilityPlugin?.primaryActionLabel ??
    task.primaryActionLabel ??
    fallback ??
    taskAddOnLabel(taskAddOnKind(task));
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

export function taskRequiredEvidenceLabels(task: ProductTaskDTO): readonly string[] {
  return task.capabilityPlugin?.requiredEvidence && task.capabilityPlugin.requiredEvidence.length > 0
    ? task.capabilityPlugin.requiredEvidence
    : task.requiredEvidence;
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
