import type { ReactNode } from "react";
import type {
  CapabilityPluginSource,
  FulfillmentPluginKind,
  FulfillmentRequiredInputDTO,
  ProductTaskDTO
} from "@uvp-eth/product-dto";
import {
  executorPatchModeLabel,
  executorPatchModeOptionsForTarget,
  addOnManifestForTask,
  executorOverlayForTask,
  resourceRequirementDisplays,
  selectableTargetsForTask,
  targetStageLabel,
  type ParticipantAddOnKind
} from "./addOnTypes";
import {
  taskAddOnKind,
  taskAddOnLabel,
  taskCapabilityPluginKind,
  taskPrimaryActionLabel,
  taskResourceRequirementInputs,
  taskRequiredInputsFromCapability,
  taskSubmitIntent,
  type TaskSubmitIntent
} from "./taskPresentation";
import { parseEvidenceIds } from "./taskUtils";

export type { TaskSubmitIntent };

export interface PrepareSubmitInput {
  readonly evidenceIds: readonly string[];
  readonly walletAddress: string;
  readonly intent: TaskSubmitIntent;
}

export interface TaskPluginState {
  readonly task: ProductTaskDTO;
  readonly walletAddress?: string | undefined;
  readonly values: Readonly<Record<string, string>>;
  readonly confirmations: Readonly<Record<string, boolean>>;
}

export interface TaskPluginValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly missingInputIds: readonly string[];
}

export interface TaskPluginRenderInput {
  readonly task: ProductTaskDTO;
  readonly state: TaskPluginState;
  readonly onValueChange: (inputId: string, value: string) => void;
  readonly onConfirmationChange: (inputId: string, checked: boolean) => void;
}

export interface TaskPlugin {
  readonly kind: ParticipantAddOnKind;
  readonly title: string;
  readonly summary: string;
  readonly allowedEvidenceTypes: readonly string[];
  readonly confirmationCopy: string;
  readonly canRender: (task: ProductTaskDTO) => boolean;
  readonly render: (input: TaskPluginRenderInput) => ReactNode;
  readonly validate: (input: TaskPluginState) => TaskPluginValidation;
  readonly buildPrepareSubmit: (input: TaskPluginState) => PrepareSubmitInput;
}

export interface TaskPluginPresentation {
  readonly kind: ParticipantAddOnKind;
  readonly source?: CapabilityPluginSource | undefined;
  readonly title: string;
  readonly summary: string;
  readonly primaryActionLabel: string;
  readonly allowedEvidenceTypes: readonly string[];
  readonly confirmationCopy: string;
}

interface TaskPluginSpec {
  readonly kind: ParticipantAddOnKind;
  readonly title: string;
  readonly summary: string;
  readonly allowedEvidenceTypes: readonly string[];
  readonly confirmationCopy: string;
}

export const supportedTaskAddOnKinds: readonly ParticipantAddOnKind[] = [
  "submit_signal",
  "stage_executor_patch",
  "stage_resource_patch"
];

export const supportedTaskPluginKinds: readonly FulfillmentPluginKind[] = [
  "payment_placeholder",
  "evidence_submission",
  "delivery_update",
  "validation_confirm",
  "dispute_material"
];

const defaultPresentationByKind: Readonly<Record<FulfillmentPluginKind, Omit<TaskPluginSpec, "kind">>> = {
  payment_placeholder: {
    title: "付款条件占位",
    summary: "记录付款条件、凭证指纹和参与方确认；当前不代表真实资金移动。",
    allowedEvidenceTypes: ["付款条件确认", "资金凭证指纹", "外部付款记录引用"],
    confirmationCopy: "提交后只进入付款条件确认流程；当前不托管、不划转、不释放、不退款任何资金。"
  },
  evidence_submission: {
    title: "凭证提交",
    summary: "提交本阶段要求的链下凭证引用和凭证指纹。",
    allowedEvidenceTypes: ["凭证指纹", "业务文件引用"],
    confirmationCopy: "提交后等待链上确认，明文文件继续保留在链下系统。"
  },
  delivery_update: {
    title: "履约更新",
    summary: "提交本阶段履约进展，并绑定对应凭证。",
    allowedEvidenceTypes: ["履约凭证", "进展说明", "业务文件指纹"],
    confirmationCopy: "提交后该履约进展会进入订单时间线，并等待链上确认。"
  },
  validation_confirm: {
    title: "验收确认",
    summary: "核对阶段凭证是否满足订单条件，并提交确认结论。",
    allowedEvidenceTypes: ["验收记录", "补充凭证", "证明摘要"],
    confirmationCopy: "提交后验收结论会成为本阶段可核对证明的一部分。"
  },
  dispute_material: {
    title: "争议材料",
    summary: "提交争议说明、补充凭证和裁定所需材料。",
    allowedEvidenceTypes: ["争议说明", "往来记录指纹", "裁定通知", "补充凭证"],
    confirmationCopy: "提交后争议材料会进入订单证明记录，等待相关参与方处理。"
  }
};

const pluginSpecs: readonly TaskPluginSpec[] = [
  {
    kind: "stage_executor_patch",
    title: "调整执行者",
    summary: "为目标阶段选择或更新执行者，提交执行者引用和指纹。",
    allowedEvidenceTypes: ["执行者钱包", "执行者参考", "选择证明"],
    confirmationCopy: "提交后等待链上确认；业务文件原文继续保留在链下系统。"
  },
  {
    kind: "submit_signal",
    title: "提交执行信号",
    summary: "按当前有效凭证要求提交链下文件引用和凭证指纹。",
    allowedEvidenceTypes: ["凭证指纹", "资源清单", "业务确认"],
    confirmationCopy: "提交后等待链上确认，明文文件继续保留在链下系统。"
  },
  {
    kind: "stage_resource_patch",
    title: "配置资源要求",
    summary: "为目标阶段发布或更新加密资源清单和访问策略。",
    allowedEvidenceTypes: ["资源清单 URI", "清单指纹", "权限指纹"],
    confirmationCopy: "提交后等待链上确认；本页面不会托管或划转任何资金。"
  }
];

export const taskPlugins: readonly TaskPlugin[] = pluginSpecs.map(createTaskPlugin);

export function pluginForTask(task: ProductTaskDTO): TaskPlugin {
  return pluginForKind(taskAddOnKind(task));
}

export function pluginForKind(kind: ParticipantAddOnKind): TaskPlugin {
  const plugin = taskPlugins.find((candidate) => candidate.kind === kind);
  if (!plugin) {
    throw new Error(`unsupported task plugin kind: ${kind}`);
  }
  return plugin;
}

export function requiredInputsForTask(task: ProductTaskDTO, plugin: TaskPlugin): readonly FulfillmentRequiredInputDTO[] {
  const metadataInputs = taskRequiredInputsFromCapability(task);
  const effectiveResourceInputs = taskResourceRequirementInputs(task);
  if (metadataInputs && metadataInputs.length > 0 && effectiveResourceInputs.length > 0) {
    return mergeRequiredInputs(effectiveResourceInputs, metadataInputs);
  }
  if (metadataInputs && metadataInputs.length > 0) {
    return metadataInputs;
  }
  if (effectiveResourceInputs.length > 0) {
    return [
      ...effectiveResourceInputs,
      {
        inputId: `${task.taskId}:confirmation`,
        label: taskPrimaryActionLabel(task),
        inputType: "confirmation",
        required: true,
        completed: false
      }
    ];
  }
  return [
    {
      inputId: `${task.taskId}:confirmation`,
      label: taskCapabilityPluginKind(task) === "payment_placeholder" ? "确认付款条件占位" : taskPrimaryActionLabel(task),
      inputType: taskCapabilityPluginKind(task) === "payment_placeholder" ? "payment_placeholder" : "confirmation",
      required: true,
      completed: false
    }
  ];
}

export function pluginPresentationForTask(task: ProductTaskDTO, plugin: TaskPlugin = pluginForTask(task)): TaskPluginPresentation {
  const pluginKind = taskCapabilityPluginKind(task);
  // 缺能力插件类型的投影按通用提交插件展示（中性降级），渲染路径不 throw。
  const defaults = pluginKind ? defaultPresentationByKind[pluginKind] : undefined;
  const manifest = addOnManifestForTask(task);
  // 允许的凭证类型单轨：有 evidenceSpec 时由发布者标签派生，否则用通用兜底文案。
  const specLabels = (task.evidenceSpec ?? [])
    .map((entry) => entry.label.trim())
    .filter((label) => label.length > 0);
  return {
    kind: plugin.kind,
    ...(task.capabilityPlugin?.source ? { source: task.capabilityPlugin.source } : {}),
    title: manifest?.title ?? task.capabilityPlugin?.title ?? defaults?.title ?? plugin.title,
    summary: manifest?.summary ?? task.capabilityPlugin?.summary ?? defaults?.summary ?? plugin.summary,
    primaryActionLabel: taskPrimaryActionLabel(task),
    allowedEvidenceTypes: specLabels.length > 0 ? specLabels : defaults?.allowedEvidenceTypes ?? plugin.allowedEvidenceTypes,
    confirmationCopy: defaults?.confirmationCopy ?? plugin.confirmationCopy
  };
}

export function createInitialTaskPluginState(task: ProductTaskDTO, walletAddress: string | undefined): TaskPluginState {
  const plugin = pluginForTask(task);
  const confirmations: Record<string, boolean> = {};
  const values: Record<string, string> = {};

  // 完成态输入的"已完成"只由渲染层展示，不写进表单值：表单值是提交载荷
  // （collectEvidenceIds → evidenceIds）的唯一来源，占位文本混进去会被
  // parseEvidenceIds 解析成凭证 ID 发往 prepare-submit。
  for (const input of requiredInputsForTask(task, plugin)) {
    if (input.completed && (input.inputType === "confirmation" || input.inputType === "payment_placeholder")) {
      confirmations[input.inputId] = true;
    }
  }

  return {
    task,
    walletAddress,
    values,
    confirmations
  };
}

function createTaskPlugin(spec: TaskPluginSpec): TaskPlugin {
  return {
    kind: spec.kind,
    title: spec.title,
    summary: spec.summary,
    allowedEvidenceTypes: spec.allowedEvidenceTypes,
    confirmationCopy: spec.confirmationCopy,
    canRender: (task) => taskAddOnKind(task) === spec.kind,
    render: (input) => <PluginFields spec={spec} {...input} />,
    validate: (input) => validateTaskPluginInput(spec, input),
    buildPrepareSubmit: (input) => ({
      evidenceIds: collectEvidenceIds(input),
      walletAddress: input.walletAddress ?? "",
      // 提交意图按能力插件类型推导，单一来源见 taskSubmitIntent。
      intent: taskSubmitIntent(input.task)
    })
  };
}

function PluginFields({
  spec,
  task,
  state,
  onValueChange,
  onConfirmationChange
}: TaskPluginRenderInput & { readonly spec: TaskPluginSpec }) {
  const plugin = pluginForKind(spec.kind);
  const presentation = pluginPresentationForTask(task, plugin);
  const requiredInputs = requiredInputsForTask(task, plugin);
  const targets = selectableTargetsForTask(task);
  const effectiveResources = resourceRequirementDisplays(task);
  const overlay = executorOverlayForTask(task);

  return (
    <section className="workspace-block plugin-card" aria-labelledby="plugin-runtime-title">
      <div className="plugin-heading">
        <div>
          <span className="overline">任务附加能力</span>
          <h3 id="plugin-runtime-title">{presentation.title}</h3>
          <p>{presentation.summary}</p>
        </div>
        <span className="plugin-kind">{taskAddOnLabel(presentation.kind)}</span>
      </div>

      {task.settlementPreview ? (
        <div className="settlement-placeholder">
          <span className="overline">{task.settlementPreview.label}</span>
          <strong>{task.settlementPreview.statusLabel}</strong>
          <p>{task.settlementPreview.disclaimer}</p>
        </div>
      ) : null}

      <div className="allowed-evidence" aria-label="允许的凭证类型">
        {presentation.allowedEvidenceTypes.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      {targets.length > 0 && (presentation.kind === "stage_executor_patch" || presentation.kind === "stage_resource_patch") ? (
        <div className="addon-summary-list" aria-label="可管理阶段">
          <strong>{presentation.kind === "stage_executor_patch" ? "执行者调整阶段" : "可管理资源阶段"}</strong>
          {targets.map((target) => {
            const modeLabels = presentation.kind === "stage_executor_patch"
              ? executorPatchModeOptionsForTarget(target).map((mode) => mode.modeLabel).join(" / ")
              : "";
            return (
              <span key={targetStageLabel(target)}>
                {targetStageLabel(target)}
                {modeLabels ? `：${modeLabels}` : target.description ? `：${target.description}` : ""}
              </span>
            );
          })}
        </div>
      ) : null}

      {effectiveResources.length > 0 ? (
        <div className="resource-requirement-list" aria-label="有效凭证要求">
          <strong>有效凭证要求</strong>
          {effectiveResources.map((resource) => (
            <div className="resource-requirement" key={resource.resourceId}>
              <span>
                {resource.label}
                <small>{resource.required ? "必填" : "可选"}</small>
              </span>
              <p>{resource.description ?? resource.handleSummary}</p>
              {resource.sourceLabel ? <em>{resource.sourceLabel}</em> : null}
            </div>
          ))}
        </div>
      ) : null}

      {effectiveResources.length > 0 ? (
        <div className="resource-access-list" aria-label="资源权限">
          <strong>资源权限</strong>
          {effectiveResources.map((resource) => (
            <div className="resource-requirement" key={`${resource.resourceId}:access`}>
              <span>
                {resource.label}
                <small>{resource.visibility === "unknown" ? "权限待同步" : visibilityLabel(resource.visibility)}</small>
              </span>
              <p>{resource.accessLabel}</p>
            </div>
          ))}
        </div>
      ) : null}

      {overlay ? (
        <div className="executor-overlay-summary" aria-label="履约者证明">
          <strong>{overlay.modeLabel ?? (overlay.mode ? executorPatchModeLabel(overlay.mode) : "履约者调整已生效")}</strong>
          <span>{overlay.activeExecutorWallet ? `当前履约者 ${overlay.activeExecutorWallet}` : "履约者由阶段补充确定"}</span>
          {overlay.previousExecutor ? (
            <span>原履约者 {overlay.previousExecutor}</span>
          ) : null}
          {overlay.priorAuthorityLabel ? <span>{overlay.priorAuthorityLabel}</span> : null}
          {overlay.futureAuthorityLabel ? <span>{overlay.futureAuthorityLabel}</span> : null}
          {overlay.patchHash ? <code>证明 {overlay.patchHash}</code> : null}
        </div>
      ) : null}

      <div className="plugin-inputs">
        {requiredInputs.map((input) => (
          <TaskPluginInput
            input={input}
            key={input.inputId}
            value={state.values[input.inputId] ?? ""}
            checked={Boolean(state.confirmations[input.inputId])}
            onValueChange={onValueChange}
            onConfirmationChange={onConfirmationChange}
          />
        ))}
      </div>

      <p className="confirmation-copy">{presentation.confirmationCopy}</p>
    </section>
  );
}

function visibilityLabel(visibility: "public" | "protected" | "private" | "unknown"): string {
  switch (visibility) {
    case "public":
      return "公开";
    case "protected":
      return "受保护";
    case "private":
      return "私密";
    case "unknown":
      return "待同步";
  }
}

function TaskPluginInput({
  input,
  value,
  checked,
  onValueChange,
  onConfirmationChange
}: {
  readonly input: FulfillmentRequiredInputDTO;
  readonly value: string;
  readonly checked: boolean;
  readonly onValueChange: (inputId: string, value: string) => void;
  readonly onConfirmationChange: (inputId: string, checked: boolean) => void;
}) {
  const requiredLabel = input.required ? "必填" : "可选";
  const completedLabel = input.completed ? "已完成" : requiredLabel;

  if (input.inputType === "confirmation" || input.inputType === "payment_placeholder") {
    return (
      <label className="plugin-check">
        <input
          checked={checked || input.completed}
          disabled={input.completed}
          onChange={(event) => onConfirmationChange(input.inputId, event.currentTarget.checked)}
          type="checkbox"
        />
        <span>
          <strong>{input.label}</strong>
          <small>{input.inputType === "payment_placeholder" ? "确认这只是付款条件占位" : completedLabel}</small>
        </span>
      </label>
    );
  }

  if (input.inputType === "evidence") {
    return (
      <label className="plugin-field">
        <span>
          {input.label}
          <small>{completedLabel}</small>
        </span>
        <textarea
          aria-label={input.label}
          disabled={input.completed}
          onChange={(event) => onValueChange(input.inputId, event.currentTarget.value)}
          placeholder="输入凭证 ID、CID 或凭证指纹；多个值可换行"
          rows={3}
          value={input.completed ? "已完成" : value}
        />
      </label>
    );
  }

  return (
    <label className="plugin-field">
      <span>
        {input.label}
        <small>{completedLabel}</small>
      </span>
      <input
        aria-label={input.label}
        disabled={input.completed}
        onChange={(event) => onValueChange(input.inputId, event.currentTarget.value)}
        placeholder="填写链下业务摘要或凭证引用"
        type="text"
        value={input.completed ? "已完成" : value}
      />
    </label>
  );
}

function validateTaskPluginInput(spec: TaskPluginSpec, state: TaskPluginState): TaskPluginValidation {
  const errors: string[] = [];
  const missingInputIds: string[] = [];
  const task = state.task;
  const plugin = pluginForKind(spec.kind);

  if (!state.walletAddress) {
    errors.push("缺少参与者钱包，不能准备提交。请在环境变量中设置 VITE_UVP_ORDER_APP_WALLET_ADDRESS 或通过 URL 参数指定。");
  }
  if (task.status === "blocked") {
    errors.push(task.blockedReason ?? "当前待办受阻，暂不能提交。");
  }
  if (task.status === "submitted") {
    errors.push("已提交，正在等待链上确认。");
  }
  if (task.status === "done") {
    errors.push("该待办已确认完成。");
  }
  if (task.canSubmit === false) {
    errors.push("当前钱包暂不能提交此待办。请确认你使用的钱包与订单登记的一致。");
  }
  for (const input of requiredInputsForTask(task, plugin)) {
    if (!input.required || input.completed) {
      continue;
    }

    const isConfirmation = input.inputType === "confirmation" || input.inputType === "payment_placeholder";
    const isMissing = isConfirmation
      ? !state.confirmations[input.inputId]
      : input.inputType === "evidence"
        ? parseEvidenceIds(state.values[input.inputId] ?? "").length === 0
        : !state.values[input.inputId]?.trim();

    if (isMissing) {
      missingInputIds.push(input.inputId);
      errors.push(`请完成：${input.label}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    missingInputIds
  };
}

function collectEvidenceIds(state: TaskPluginState): readonly string[] {
  const plugin = pluginForTask(state.task);
  const ids = new Set<string>();

  for (const input of requiredInputsForTask(state.task, plugin)) {
    if (input.inputType !== "evidence") {
      continue;
    }
    for (const evidenceId of parseEvidenceIds(state.values[input.inputId] ?? "")) {
      ids.add(evidenceId);
    }
  }

  return [...ids];
}

function mergeRequiredInputs(
  primary: readonly FulfillmentRequiredInputDTO[],
  secondary: readonly FulfillmentRequiredInputDTO[]
): readonly FulfillmentRequiredInputDTO[] {
  // 只按 inputId 去重：label 是展示文案，两个必填项可以共用同一标签
  // （不同 inputId）；按 label 合并会把第二项整个吞掉，提交校验永远缺一步。
  const seen = new Set<string>();
  const merged: FulfillmentRequiredInputDTO[] = [];
  for (const input of [...primary, ...secondary]) {
    if (seen.has(input.inputId)) {
      continue;
    }
    seen.add(input.inputId);
    merged.push(input);
  }
  return merged;
}
