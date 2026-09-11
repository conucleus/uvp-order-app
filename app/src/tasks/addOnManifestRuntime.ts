import type {
  ParticipantAddOnManifestActionDTO,
  ParticipantAddOnManifestComponentDTO,
  ParticipantAddOnManifestDTO,
  ParticipantAddOnManifestSignalIntent,
  ProductTaskDTO
} from "@uvp-eth/product-dto";
import type {
  PrepareStageExecutorPatchInput,
  PrepareStageResourcePatchInput
} from "../api/productApi";
import type { ProductExecutorPatchMode } from "@uvp-eth/product-dto";
import { shortWallet } from "../auth/participant";
import {
  addOnManifestForTask,
  executorPatchWorkStarted,
  selectableTargetsForTask,
  targetStageId
} from "./addOnTypes";
import type { PrepareSubmitInput } from "./pluginRuntime";
import { taskSubmitIntentForAction } from "./taskPresentation";
import { parseEvidenceIds, isContentAddressedReference, sameAddress } from "./taskUtils";

export interface AddOnManifestRuntimeState {
  readonly task: ProductTaskDTO;
  readonly walletAddress?: string | undefined;
  readonly values: Readonly<Record<string, string>>;
  readonly confirmations: Readonly<Record<string, boolean>>;
}

export interface AddOnManifestValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly missingInputIds: readonly string[];
}

export type AddOnManifestPrepareInput =
  | {
      readonly actionKind: "submit_signal";
      readonly input: PrepareSubmitInput;
    }
  | {
      readonly actionKind: "stage_executor_patch";
      readonly input: PrepareStageExecutorPatchInput;
    }
  | {
      readonly actionKind: "stage_resource_patch";
      readonly input: PrepareStageResourcePatchInput;
    };

export function createInitialAddOnManifestState(
  task: ProductTaskDTO,
  walletAddress: string | undefined
): AddOnManifestRuntimeState {
  const manifest = addOnManifestForTask(task);
  const values: Record<string, string> = {};
  const confirmations: Record<string, boolean> = {};
  if (!manifest) {
    return { task, walletAddress, values, confirmations };
  }
  const firstTarget = selectableTargetsForTask(task)[0];
  const firstStageBinding = manifest.stageBindings[0];
  for (const component of addOnManifestInputComponents(manifest)) {
    if (!component.inputId) {
      continue;
    }
    if (component.componentKind === "confirmation") {
      confirmations[component.inputId] = component.defaultValue === "true";
      continue;
    }
    const defaultValue = component.defaultValue ??
      (component.componentKind === "wallet" ? task.participantWallet ?? task.assigneeWallet ?? walletAddress : undefined) ??
      (component.componentKind === "stage_select" ? firstTarget ? targetStageId(firstTarget) : firstStageBinding : undefined) ??
      (component.componentKind === "select" ? component.options?.[0]?.value : undefined);
    if (defaultValue) {
      values[component.inputId] = defaultValue;
    }
  }
  return { task, walletAddress, values, confirmations };
}

export function addOnManifestInputComponents(
  manifest: ParticipantAddOnManifestDTO
): readonly ParticipantAddOnManifestComponentDTO[] {
  return manifest.pages.flatMap((page) =>
    page.sections.flatMap((section) =>
      section.components.filter((component) => component.inputId)
    )
  );
}

export function validateAddOnManifestAction(
  manifest: ParticipantAddOnManifestDTO,
  action: ParticipantAddOnManifestActionDTO,
  state: AddOnManifestRuntimeState
): AddOnManifestValidation {
  const errors: string[] = [];
  const missingInputIds: string[] = [];
  if (!state.walletAddress) {
    errors.push("缺少参与者钱包，不能准备提交。请在环境变量中设置 VITE_UVP_ORDER_APP_WALLET_ADDRESS 或通过 URL 参数指定。");
  }
  if (state.task.status === "blocked") {
    errors.push(state.task.blockedReason ?? "当前待办受阻，暂不能提交。");
  }
  if (state.task.status === "submitted") {
    errors.push("已提交，正在等待链上确认。");
  }
  if (state.task.status === "done") {
    errors.push("该待办已确认完成。");
  }
  if (state.task.canSubmit === false) {
    errors.push("当前钱包暂不能提交此待办。请确认你使用的钱包与订单登记的一致。");
  }
  for (const component of addOnManifestInputComponents(manifest)) {
    if (!component.required || !component.inputId) {
      continue;
    }
    if (component.componentKind === "confirmation") {
      if (!state.confirmations[component.inputId]) {
        missingInputIds.push(component.inputId);
        errors.push(`请完成：${component.label}`);
      }
      continue;
    }
    if (!valueForInput(state, component.inputId).trim()) {
      missingInputIds.push(component.inputId);
      errors.push(`请填写：${component.label}`);
    }
  }

  for (const key of requiredBindingsForAction(action.actionKind)) {
    const inputId = action.inputBindings[key];
    if (!inputId || !valueForInput(state, inputId).trim()) {
      if (inputId) {
        missingInputIds.push(inputId);
      }
      errors.push(`动作缺少输入：${key}`);
    }
  }

  errors.push(...semanticErrorsForAction(action, state, manifest));

  return { ok: errors.length === 0, errors, missingInputIds };
}

export function buildAddOnManifestPrepareInput(
  action: ParticipantAddOnManifestActionDTO,
  state: AddOnManifestRuntimeState
): AddOnManifestPrepareInput {
  switch (action.actionKind) {
    case "submit_signal":
      return {
        actionKind: "submit_signal",
        input: {
          evidenceIds: parseEvidenceIds(boundValue(action, state, "evidenceIds")),
          walletAddress: boundValue(action, state, "walletAddress"),
          // 未声明 intent 时按能力插件类型推导（dispute_material →
          // raise_dispute），与 taskPresentation/zhixu-store 同源，不再
          // 兜底 confirm_stage 把争议动作反转成确认。
          intent: taskSubmitIntentForAction(action, state.task)
        }
      };
    case "stage_executor_patch": {
      const executorReference = boundValue(action, state, "executorReference");
      const previousExecutorWallet = boundValue(action, state, "previousExecutorWallet") ||
        boundValue(action, state, "previousExecutor");
      const approval = parseOptionalJson(boundValue(action, state, "approval"));
      return {
        actionKind: "stage_executor_patch",
        input: {
          selectorWallet: boundValue(action, state, "selectorWallet"),
          targetStageId: boundValue(action, state, "targetStageId"),
          executorWallet: boundValue(action, state, "executorWallet"),
          executorMetadataHash: boundValue(action, state, "executorMetadataHash"),
          metadataURI: boundValue(action, state, "metadataURI"),
          mode: normalizeExecutorPatchMode(boundValue(action, state, "mode")),
          ...(previousExecutorWallet ? { previousExecutorWallet } : {}),
          ...(approval !== undefined ? { approval } : {}),
          ...(executorReference ? { executorReference } : {}),
        }
      };
    }
    case "stage_resource_patch":
      return {
        actionKind: "stage_resource_patch",
        input: {
          selectorWallet: boundValue(action, state, "selectorWallet"),
          targetStageId: boundValue(action, state, "targetStageId"),
          resourceKey: boundValue(action, state, "resourceKey"),
          manifestURI: boundValue(action, state, "manifestURI"),
          manifestHash: boundValue(action, state, "manifestHash"),
          policyHash: boundValue(action, state, "policyHash")
        }
      };
  }
}

function requiredBindingsForAction(actionKind: ParticipantAddOnManifestActionDTO["actionKind"]): readonly string[] {
  switch (actionKind) {
    case "submit_signal":
      return ["walletAddress", "evidenceIds"];
    case "stage_executor_patch":
      return ["selectorWallet", "targetStageId", "executorWallet", "executorMetadataHash", "metadataURI"];
    case "stage_resource_patch":
      return ["selectorWallet", "targetStageId", "resourceKey", "manifestURI", "manifestHash", "policyHash"];
  }
}

function semanticErrorsForAction(
  action: ParticipantAddOnManifestActionDTO,
  state: AddOnManifestRuntimeState,
  manifest: ParticipantAddOnManifestDTO
): readonly string[] {
  const errors: string[] = [];
  for (const component of addOnManifestInputComponents(manifest)) {
    if (!component.inputId) {
      continue;
    }
    const value = valueForInput(state, component.inputId).trim();
    if (!value) {
      continue;
    }
    if (component.componentKind === "hash" && !looksLikeHash(value)) {
      errors.push(`请填写有效指纹：${component.label}`);
    }
    if (component.componentKind === "uri" && !isContentAddressedReference(value)) {
      errors.push(`请填写内容寻址 URI：${component.label}`);
    }
  }

  if (action.actionKind === "stage_executor_patch") {
    pushWalletMismatchError(errors, state, boundValue(action, state, "selectorWallet"));
    const executorMetadataHash = boundValue(action, state, "executorMetadataHash");
    if (executorMetadataHash && !looksLikeHash(executorMetadataHash)) {
      errors.push("executorMetadataHash 必须是 0x 开头的 32 字节指纹。");
    }
    const approval = boundValue(action, state, "approval");
    if (approval && !isValidJsonText(approval)) {
      errors.push("替换证明（approval）必须是合法的 JSON 文本，不能按原始字符串发送。");
    }
    // 与应用层 ExecutorPatchPanel 同一替换门槛：manifest 驱动路径不得绕过。
    const modeInput = boundValue(action, state, "mode");
    const mode = normalizeExecutorPatchMode(modeInput);
    if (modeInput && !mode) {
      errors.push("处理方式必须是 assign/handoff/replacement 之一（协议拼写）。");
    }
    const target = selectableTargetsForTask(state.task)
      .find((candidate) => targetStageId(candidate) === boundValue(action, state, "targetStageId"));
    if (mode === "assign" && executorPatchWorkStarted(target)) {
      errors.push("阶段已开始，不能直接选择履约者。");
    }
    if (mode === "handoff" || mode === "replacement") {
      if (!boundValue(action, state, "previousExecutorWallet") && !boundValue(action, state, "previousExecutor")) {
        errors.push("请填写原履约者钱包。");
      }
    }
    if (mode === "replacement" && !approval) {
      errors.push("需要替换证明。");
    }
  }
  if (action.actionKind === "stage_resource_patch") {
    pushWalletMismatchError(errors, state, boundValue(action, state, "selectorWallet"));
    for (const key of ["manifestHash", "policyHash"]) {
      const value = boundValue(action, state, key);
      if (value && !looksLikeHash(value)) {
        errors.push(`${key} 必须是 0x 开头的 32 字节指纹。`);
      }
    }
    if (action.inputBindings.writerWallet) {
      errors.push("资源补充必须使用 selectorWallet，不能使用 writerWallet。");
    }
    if (action.inputBindings.visibility) {
      errors.push("资源可见性属于链下资源清单，不能发送到 prepare 请求。");
    }
  }
  if (action.actionKind === "submit_signal") {
    pushWalletMismatchError(errors, state, boundValue(action, state, "walletAddress"));
  }
  return errors;
}

function pushWalletMismatchError(
  errors: string[],
  state: AddOnManifestRuntimeState,
  candidateWallet: string
): void {
  const authorizedWallet = state.task.participantWallet ?? state.task.assigneeWallet ?? state.walletAddress;
  if (!candidateWallet.trim() || !authorizedWallet?.trim()) {
    return;
  }
  if (!sameAddress(candidateWallet, authorizedWallet)) {
    errors.push(`钱包与授权参与方不匹配。授权钱包为 ${shortWallet(authorizedWallet)}，请切换到对应钱包后重试。`);
  }
}

function boundValue(
  action: ParticipantAddOnManifestActionDTO,
  state: AddOnManifestRuntimeState,
  bindingKey: string
): string {
  const inputId = action.inputBindings[bindingKey];
  return inputId ? valueForInput(state, inputId).trim() : "";
}

/**
 * manifest 输入绑定值的只读访问（面板提交期读取 live state 用）：
 * 原履约者加签在 prepare 之后才有可签名对象，提交时从当前表单值取。
 */
export function manifestBoundValue(
  action: ParticipantAddOnManifestActionDTO,
  state: AddOnManifestRuntimeState,
  bindingKey: string
): string {
  return boundValue(action, state, bindingKey);
}

function valueForInput(state: AddOnManifestRuntimeState, inputId: string): string {
  if (state.confirmations[inputId]) {
    return "true";
  }
  return state.values[inputId] ?? "";
}

function normalizeExecutorPatchMode(value: string): ProductExecutorPatchMode | undefined {
  // 只认协议冻结的拼写（assign/handoff/replacement）：服务端虽把 "replace"
  // 别名归一为 replacement，但那是服务端宽限；客户端自造拼写会让 manifest
  // 驱动路径绕开应用层按 mode 建立的替换门槛（见 semanticErrorsForAction）。
  if (value === "assign" || value === "handoff" || value === "replacement") {
    return value;
  }
  return undefined;
}

function looksLikeHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/u.test(value.trim());
}

function parseOptionalJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("替换证明（approval）不是合法的 JSON 文本，已停止准备提交。");
  }
}

function isValidJsonText(value: string): boolean {
  try {
    JSON.parse(value.trim());
    return true;
  } catch {
    return false;
  }
}

export function manifestIntentLabel(intent: ParticipantAddOnManifestSignalIntent | undefined): string {
  switch (intent) {
    case "reject_stage":
      return "驳回";
    case "raise_dispute":
      return "发起争议";
    case "resolve_dispute":
      return "解决争议";
    case "confirm_stage":
    case undefined:
      return "确认";
  }
}
