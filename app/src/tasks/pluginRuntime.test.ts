import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  FulfillmentPluginKind,
  ParticipantAddOnManifestComponentDTO,
  ParticipantAddOnManifestDTO,
  ProductTaskDTO
} from "@uvp-eth/product-dto";
import {
  executorPatchModeLabel,
  executorPatchModeOptionsForTarget,
  resourceRequirementDisplays,
  selectableTargetsForTask,
  type ParticipantAddOnKind,
  type ProductTaskWithAddOns
} from "./addOnTypes.js";
import {
  buildAddOnManifestPrepareInput,
  createInitialAddOnManifestState,
  validateAddOnManifestAction
} from "./addOnManifestRuntime.js";
import {
  pluginPresentationForTask,
  pluginForTask,
  requiredInputsForTask,
  supportedTaskAddOnKinds,
  supportedTaskPluginKinds,
  type TaskPluginState
} from "./pluginRuntime.js";
import {
  taskAddOnKind,
  taskCapabilityPluginKind,
  taskExecutorDisplay,
  taskPrimaryActionLabel,
  taskSubmitIntent
} from "./taskPresentation.js";
import { signalContainerForTask } from "./signalContainer.js";
import {
  filterParticipantTasksForWallet,
  sortParticipantTasks,
  taskDisplay,
  taskWalletHint
} from "./taskStatus.js";

const wallet = "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F";

describe("task plugin runtime", () => {
  it("defines add-on action kinds and supported capability plugin kinds", () => {
    assert.deepEqual(supportedTaskAddOnKinds, [
      "submit_signal",
      "stage_executor_patch",
      "stage_resource_patch"
    ]);
    assert.deepEqual(supportedTaskPluginKinds, [
      "payment_placeholder",
      "evidence_submission",
      "delivery_update",
      "validation_confirm",
      "dispute_material"
    ]);

    for (const kind of supportedTaskAddOnKinds) {
      const task = taskFixture(capabilityKindForAddOn(kind), { addOnKind: kind, canSubmit: true });
      const plugin = pluginForTask(task);
      const state = filledState(task);
      const validation = plugin.validate(state);
      const prepareInput = plugin.buildPrepareSubmit(state);

      assert.equal(taskAddOnKind(task), kind);
      assert.equal(plugin.kind, kind);
      assert.equal(validation.ok, true);
      assert.deepEqual(prepareInput.evidenceIds, [`evidence-${capabilityKindForAddOn(kind)}`]);
      assert.equal(prepareInput.walletAddress, wallet);
      assert.equal(prepareInput.intent, capabilityKindForAddOn(kind) === "dispute_material" ? "raise_dispute" : "confirm_stage");
    }
  });

  it("keeps submit disabled until required plugin inputs pass validation", () => {
    const task = taskFixture("delivery_update", { canSubmit: true });
    const plugin = pluginForTask(task);
    const emptyState: TaskPluginState = {
      task,
      walletAddress: wallet,
      values: {},
      confirmations: {}
    };

    assert.equal(plugin.validate(emptyState).ok, false);
    assert.deepEqual(plugin.validate(filledState(task)).missingInputIds, []);
    assert.equal(plugin.validate(filledState(task)).ok, true);
  });

  it("uses explicit capability plugin metadata for presentation", () => {
    const task = taskFixture("delivery_update", {
      evidenceSpec: [
        { key: "acceptance_form", label: "验收单", required: true }
      ],
      capabilityPlugin: {
        pluginKind: "validation_confirm",
        source: "explicit",
        roleSlotId: "inspection-slot",
        title: "验收插件标题",
        summary: "来自 DTO 的验收插件说明",
        primaryActionLabel: "确认验收结论",
        inputPolicy: [
          {
            inputId: "inspection-report",
            label: "验收报告编号",
            inputType: "text",
            required: true,
            completed: false
          }
        ]
      }
    });
    const plugin = pluginForTask(task);
    const presentation = pluginPresentationForTask(task, plugin);

    assert.equal(taskAddOnKind(task), "submit_signal");
    assert.equal(taskCapabilityPluginKind(task), "validation_confirm");
    assert.equal(plugin.kind, "submit_signal");
    assert.equal(presentation.title, "验收插件标题");
    assert.equal(presentation.summary, "来自 DTO 的验收插件说明");
    assert.equal(presentation.primaryActionLabel, "确认验收结论");
    // 允许的凭证类型由发布者 evidenceSpec 标签派生（单轨）。
    assert.deepEqual(presentation.allowedEvidenceTypes, ["验收单"]);
    assert.deepEqual(requiredInputsForTask(task, plugin).map((input) => input.label), ["验收报告编号"]);
    assert.equal(taskPrimaryActionLabel(task), "确认验收结论");
  });

  it("keeps canSubmit false tasks blocked at the runtime boundary", () => {
    const task = taskFixture("validation_confirm", { canSubmit: false });
    const plugin = pluginForTask(task);

    assert.equal(plugin.validate(filledState(task)).ok, false);
    assert.match(plugin.validate(filledState(task)).errors.join("\n"), /当前钱包暂不能提交/);
  });

  it("renders the payment placeholder contract without real funding claims", () => {
    const task = taskFixture("payment_placeholder");
    const plugin = pluginForTask(task);
    const presentation = pluginPresentationForTask(task, plugin);
    const copy = [
      presentation.title,
      presentation.summary,
      presentation.confirmationCopy,
      ...presentation.allowedEvidenceTypes
    ].join(" ");

    assert.match(copy, /付款条件占位/);
    assert.match(copy, /不托管、不划转、不释放、不退款/);
    assert.doesNotMatch(copy, /escrow released|funds held|资金已划转|资金已释放/u);
  });

  it("rejects tasks without an explicit capability plugin kind", () => {
    const task = taskFixture("payment_placeholder", { capabilityPlugin: undefined });

    assert.throws(() => pluginForTask(task), /missing capabilityPlugin\.pluginKind/);
  });

  it("uses executor patch action targets for executor patch capable tasks", () => {
    const task = taskFixture("evidence_submission", {
      addOnKind: "stage_executor_patch",
      selectableTargets: [
        {
          targetStageId: "inspection",
          targetStageName: "检验阶段",
          description: "允许选择检验履约者",
          workStarted: false,
          executorPatchModes: [
            {
              mode: "assign",
              modeLabel: "选择履约者",
              allowed: true,
              workStarted: false,
              requiresSelectorSignature: true,
              requiresPreviousExecutorSignature: false,
              requiresApprovalSignal: false
            }
          ]
        }
      ]
    });

    assert.equal(taskAddOnKind(task), "stage_executor_patch");
    assert.equal(pluginForTask(task).kind, "stage_executor_patch");
    assert.deepEqual(selectableTargetsForTask(task).map((target) => target.targetStageId), ["inspection"]);
    assert.deepEqual(executorPatchModeOptionsForTarget(selectableTargetsForTask(task)[0]).map((mode) => mode.mode), ["assign"]);
    assert.equal(executorPatchModeLabel("assign"), "选择履约者");
  });

  it("separates post-start handoff and replacement executor patch modes", () => {
    const previousExecutor = "0x2222222222222222222222222222222222222222";
    const task = taskFixture("evidence_submission", {
      addOnKind: "stage_executor_patch",
      selectableTargets: [
        {
          targetStageId: "inspection",
          targetStageName: "检验阶段",
          allowed: true,
          workStarted: true,
          currentExecutorWallet: previousExecutor,
          currentExecutorLabel: "原检验履约者",
          executorPatchModes: [
            {
              mode: "handoff",
              modeLabel: "交接履约者",
              allowed: true,
              workStarted: true,
              requiresSelectorSignature: true,
              requiresPreviousExecutorSignature: true,
              requiresApprovalSignal: false,
              previousExecutor,
              priorAuthorityLabel: "已完成部分不变"
            },
            {
              mode: "replacement",
              modeLabel: "申请替换履约者",
              allowed: true,
              workStarted: true,
              requiresSelectorSignature: true,
              requiresPreviousExecutorSignature: false,
              requiresApprovalSignal: true,
              previousExecutor,
              approvalSourceId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              approvalSignalId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              guidanceLabel: "需要替换证明",
              priorAuthorityLabel: "已完成部分不变"
            }
          ]
        }
      ]
    });
    const target = selectableTargetsForTask(task)[0];
    const modes = executorPatchModeOptionsForTarget(target);

    assert.deepEqual(modes.map((mode) => mode.mode), ["handoff", "replacement"]);
    assert.equal(modes.some((mode) => mode.mode === "assign"), false);
    assert.equal(modes[0]?.requiresPreviousExecutorSignature, true);
    assert.equal(modes[0]?.previousExecutor, previousExecutor);
    assert.equal(modes[1]?.requiresApprovalSignal, true);
    assert.equal(modes[1]?.guidanceLabel, "需要替换证明");
    assert.equal(modes.every((mode) => mode.priorAuthorityLabel === "已完成部分不变"), true);
  });

  it("renders executor requirements and access status before evidence", () => {
    const task = taskFixture("delivery_update", {
      addOnKind: "submit_signal",
      resourceRequirements: [
        {
          resourceId: "inspection_report",
          resourceKey: "inspection_report",
          label: "第三方检验证明",
          required: true,
          source: "resource_patch",
          visibility: "protected",
          ciphertextHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          accessStatus: {
            state: "request_required",
            label: "需要授权后查看加密文件",
            canRead: false
          }
        }
      ]
    });
    const plugin = pluginForTask(task);
    const inputs = requiredInputsForTask(task, plugin);

    assert.equal(resourceRequirementDisplays(task)[0]?.label, "第三方检验证明");
    assert.equal(resourceRequirementDisplays(task)[0]?.accessLabel, "需要授权后查看加密文件");
    assert.equal(inputs[0]?.label, "第三方检验证明");
  });

  it("keeps same-label required inputs with distinct inputIds instead of swallowing one", () => {
    const task = taskFixture("evidence_submission", {
      addOnKind: "submit_signal",
      resourceRequirements: [
        {
          resourceId: "acceptance_form",
          resourceKey: "acceptance_form",
          label: "验收单",
          required: true,
          source: "resource_patch",
          visibility: "protected",
          ciphertextHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          accessStatus: {
            state: "request_required",
            label: "需要授权后查看加密文件",
            canRead: false
          }
        }
      ],
      capabilityPlugin: {
        pluginKind: "evidence_submission",
        source: "explicit",
        inputPolicy: [
          {
            inputId: "acceptance-form-number",
            label: "验收单",
            inputType: "text",
            required: true,
            completed: false
          }
        ]
      }
    });
    const plugin = pluginForTask(task);
    const inputs = requiredInputsForTask(task, plugin);

    // 标签是展示文案，去重只能按 inputId：同标签的两条必填都要保留，
    // 否则提交校验永远缺一步（0216 O24）。
    assert.deepEqual(inputs.map((input) => input.inputId), [
      "resource-requirement:acceptance_form",
      "acceptance-form-number"
    ]);
    assert.equal(inputs.filter((input) => input.label === "验收单").length, 2);

    const missing = plugin.validate({
      task,
      walletAddress: wallet,
      values: { "acceptance-form-number": "ACC-1" },
      confirmations: {}
    }).missingInputIds;
    assert.deepEqual(missing, ["resource-requirement:acceptance_form"]);
  });

  it("builds submit_signal inputs from a declarative add-on manifest", () => {
    const manifest = addOnManifestFixture("submit_signal", "submit_signal");
    const task = taskFixture("delivery_update", {
      addOnManifest: manifest,
      canSubmit: true
    });
    const state = {
      ...createInitialAddOnManifestState(task, wallet),
      values: {
        executorWallet: wallet,
        evidenceRefs: "evidence-1\nevidence-2"
      },
      confirmations: {
        confirm: true
      }
    };
    const action = manifest.actions[0]!;
    const validation = validateAddOnManifestAction(manifest, action, state);
    const prepare = buildAddOnManifestPrepareInput(action, state);

    assert.equal(taskAddOnKind(task), "submit_signal");
    assert.equal(validation.ok, true);
    assert.equal(prepare.actionKind, "submit_signal");
    assert.deepEqual(prepare.input.evidenceIds, ["evidence-1", "evidence-2"]);
    assert.equal(prepare.input.walletAddress, wallet);
    assert.equal(prepare.input.intent, "confirm_stage");
  });

  it("derives the submit intent from the manifest declaration first, aligned with zhixu-store", () => {
    const manifestIntent = (
      intent: NonNullable<ParticipantAddOnManifestDTO["actions"][number]["intent"]>,
      primary = true
    ): ParticipantAddOnManifestDTO => ({
      schemaVersion: "participant-addon-manifest.v1",
      manifestId: "intent-manifest:v1",
      roleSlotId: "delivery",
      addOnKind: "submit_signal",
      title: "提交",
      summary: "",
      stageBindings: [],
      pages: [],
      actions: [
        { actionId: "a-primary", actionKind: "submit_signal", label: "主操作", primary, inputBindings: {}, intent },
        { actionId: "a-secondary", actionKind: "submit_signal", label: "次要", inputBindings: {}, intent: "confirm_stage" }
      ]
    });

    // manifest 显式声明优先于插件类型推导（与 zhixu-store 同源同序）。
    assert.equal(taskSubmitIntent(taskFixture("dispute_material", { addOnManifest: manifestIntent("reject_stage") })), "reject_stage");
    // manifest 未声明 intent 时回落插件类型映射：争议任务不得以 confirm_stage 提交。
    assert.equal(taskSubmitIntent(taskFixture("dispute_material")), "raise_dispute");
    assert.equal(taskSubmitIntent(taskFixture("delivery_update")), "confirm_stage");
  });

  it("builds executor and resource patch inputs from manifest action bindings", () => {
    const selectorManifest = addOnManifestFixture("stage_executor_patch", "stage_executor_patch");
    const selectorTask = taskFixture("evidence_submission", {
      addOnManifest: selectorManifest,
      canSubmit: true,
      selectableTargets: [{ targetStageId: "inspection", targetStageName: "检验", allowed: true }]
    });
    const selectorAction = selectorManifest.actions[0]!;
    const selectorPrepare = buildAddOnManifestPrepareInput(selectorAction, {
      ...createInitialAddOnManifestState(selectorTask, wallet),
      values: {
        selectorWallet: wallet,
        targetStageId: "inspection",
        executorWallet: "0x0000000000000000000000000000000000000002",
        executorMetadataHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        executorReference: "customs-supplier-2",
        metadataURI: "ipfs://executor/inspection",
        mode: "assign"
      },
      confirmations: {}
    });

    const resourcePatchManifest = addOnManifestFixture("stage_resource_patch", "stage_resource_patch");
    const resourcePatchTask = taskFixture("payment_placeholder", {
      addOnManifest: resourcePatchManifest,
      canSubmit: true,
      selectableTargets: [{ targetStageId: "inspection", targetStageName: "检验", allowed: true }]
    });
    const resourcePatchAction = resourcePatchManifest.actions[0]!;
    const resourcePatchPrepare = buildAddOnManifestPrepareInput(resourcePatchAction, {
      ...createInitialAddOnManifestState(resourcePatchTask, wallet),
      values: {
        selectorWallet: wallet,
        targetStageId: "inspection",
        resourceKey: "inspection_report",
        manifestURI: "ipfs://resource/inspection",
        manifestHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
        policyHash: "0x4444444444444444444444444444444444444444444444444444444444444444"
      },
      confirmations: {}
    });

    assert.equal(taskAddOnKind(selectorTask), "stage_executor_patch");
    assert.equal(selectorPrepare.actionKind, "stage_executor_patch");
    assert.equal(selectorPrepare.input.targetStageId, "inspection");
    assert.equal(selectorPrepare.input.executorWallet, "0x0000000000000000000000000000000000000002");
    assert.equal(selectorPrepare.input.executorMetadataHash, "0x2222222222222222222222222222222222222222222222222222222222222222");
    assert.equal(selectorPrepare.input.executorReference, "customs-supplier-2");
    assert.equal(selectorPrepare.input.mode, "assign");
    assert.equal(taskAddOnKind(resourcePatchTask), "stage_resource_patch");
    assert.equal(resourcePatchPrepare.actionKind, "stage_resource_patch");
    assert.equal(resourcePatchPrepare.input.selectorWallet, wallet);
    assert.equal(resourcePatchPrepare.input.resourceKey, "inspection_report");
    assert.equal("writerWallet" in resourcePatchPrepare.input, false);
    assert.equal("visibility" in resourcePatchPrepare.input, false);
  });

  it("blocks malformed manifest patch fields before prepare", () => {
    const selectorManifest = addOnManifestFixture("stage_executor_patch", "stage_executor_patch");
    const selectorAction = selectorManifest.actions[0]!;
    const selectorTask = taskFixture("evidence_submission", {
      addOnManifest: selectorManifest,
      canSubmit: true,
      selectableTargets: [{ targetStageId: "inspection", targetStageName: "检验", allowed: true }]
    });
    const selectorValidation = validateAddOnManifestAction(selectorManifest, selectorAction, {
      ...createInitialAddOnManifestState(selectorTask, wallet),
      values: {
        selectorWallet: wallet,
        targetStageId: "inspection",
        executorWallet: "0x0000000000000000000000000000000000000002",
        executorMetadataHash: "supplier-ref-is-not-a-hash",
        metadataURI: "https://example.invalid/plaintext",
        mode: "assign"
      },
      confirmations: {}
    });
    const resourcePatchManifest = addOnManifestFixture("stage_resource_patch", "stage_resource_patch", {
      unsupportedResourceBindings: true
    });
    const resourcePatchAction = resourcePatchManifest.actions[0]!;
    const resourcePatchTask = taskFixture("payment_placeholder", {
      addOnManifest: resourcePatchManifest,
      canSubmit: true,
      selectableTargets: [{ targetStageId: "inspection", targetStageName: "检验", allowed: true }]
    });
    const resourcePatchValidation = validateAddOnManifestAction(resourcePatchManifest, resourcePatchAction, {
      ...createInitialAddOnManifestState(resourcePatchTask, wallet),
      values: {
        writerWallet: wallet,
        targetStageId: "inspection",
        resourceKey: "inspection_report",
        manifestURI: "ipfs://resource/inspection",
        manifestHash: "not-a-hash",
        policyHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
        visibility: "protected"
      },
      confirmations: {}
    });

    assert.equal(selectorValidation.ok, false);
    assert.match(selectorValidation.errors.join("\n"), /executorMetadataHash/);
    assert.match(selectorValidation.errors.join("\n"), /内容寻址 URI/);
    assert.equal(resourcePatchValidation.ok, false);
    assert.match(resourcePatchValidation.errors.join("\n"), /selectorWallet/);
    assert.match(resourcePatchValidation.errors.join("\n"), /writerWallet/);
    assert.match(resourcePatchValidation.errors.join("\n"), /资源可见性/);
  });

  it("blocks approval input that is not valid JSON instead of sending the raw string", () => {
    const manifest = addOnManifestFixture("stage_executor_patch", "stage_executor_patch", { withApprovalBinding: true });
    const action = manifest.actions[0]!;
    const task = taskFixture("evidence_submission", {
      addOnManifest: manifest,
      canSubmit: true,
      selectableTargets: [{ targetStageId: "inspection", targetStageName: "检验", allowed: true }]
    });
    const baseValues = {
      selectorWallet: wallet,
      targetStageId: "inspection",
      executorWallet: "0x0000000000000000000000000000000000000002",
      executorMetadataHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      metadataURI: "ipfs://executor/inspection",
      mode: "assign"
    };

    const invalidValidation = validateAddOnManifestAction(manifest, action, {
      ...createInitialAddOnManifestState(task, wallet),
      values: { ...baseValues, approval: "source-id signal-id" },
      confirmations: {}
    });
    assert.equal(invalidValidation.ok, false);
    assert.match(invalidValidation.errors.join("\n"), /approval.*JSON/u);

    assert.throws(
      () => buildAddOnManifestPrepareInput(action, {
        ...createInitialAddOnManifestState(task, wallet),
        values: { ...baseValues, approval: "source-id signal-id" },
        confirmations: {}
      }),
      /approval.*JSON/u
    );

    const validPrepare = buildAddOnManifestPrepareInput(action, {
      ...createInitialAddOnManifestState(task, wallet),
      values: { ...baseValues, approval: JSON.stringify({ sourceId: "0xaaaa", signalId: "0xbbbb" }) },
      confirmations: {}
    });
    assert.equal(validPrepare.actionKind, "stage_executor_patch");
    if (validPrepare.actionKind === "stage_executor_patch") {
      assert.deepEqual(validPrepare.input.approval, { sourceId: "0xaaaa", signalId: "0xbbbb" });
    }
  });

  it("blocks manifest wallet fields that do not match the authorized participant", () => {
    const wrongWallet = "0x0000000000000000000000000000000000000002";
    const selectorManifest = addOnManifestFixture("stage_executor_patch", "stage_executor_patch");
    const selectorAction = selectorManifest.actions[0]!;
    const selectorTask = taskFixture("evidence_submission", {
      addOnManifest: selectorManifest,
      canSubmit: true,
      participantWallet: wallet,
      selectableTargets: [{ targetStageId: "inspection", targetStageName: "检验", allowed: true }]
    });
    const selectorValidation = validateAddOnManifestAction(selectorManifest, selectorAction, {
      ...createInitialAddOnManifestState(selectorTask, wallet),
      values: {
        selectorWallet: wrongWallet,
        targetStageId: "inspection",
        executorWallet: "0x0000000000000000000000000000000000000003",
        executorMetadataHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        metadataURI: "ipfs://executor/inspection",
        mode: "assign"
      },
      confirmations: {}
    });

    const resourcePatchManifest = addOnManifestFixture("stage_resource_patch", "stage_resource_patch");
    const resourcePatchAction = resourcePatchManifest.actions[0]!;
    const resourcePatchTask = taskFixture("payment_placeholder", {
      addOnManifest: resourcePatchManifest,
      canSubmit: true,
      participantWallet: wallet,
      selectableTargets: [{ targetStageId: "inspection", targetStageName: "检验", allowed: true }]
    });
    const resourcePatchValidation = validateAddOnManifestAction(resourcePatchManifest, resourcePatchAction, {
      ...createInitialAddOnManifestState(resourcePatchTask, wallet),
      values: {
        selectorWallet: wrongWallet,
        targetStageId: "inspection",
        resourceKey: "inspection_report",
        manifestURI: "ipfs://resource/inspection",
        manifestHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
        policyHash: "0x4444444444444444444444444444444444444444444444444444444444444444"
      },
      confirmations: {}
    });

    const submitSignalManifest = addOnManifestFixture("submit_signal", "submit_signal");
    const submitSignalAction = submitSignalManifest.actions[0]!;
    const submitSignalTask = taskFixture("delivery_update", {
      addOnManifest: submitSignalManifest,
      canSubmit: true,
      participantWallet: wallet
    });
    const submitSignalValidation = validateAddOnManifestAction(submitSignalManifest, submitSignalAction, {
      ...createInitialAddOnManifestState(submitSignalTask, wallet),
      values: {
        executorWallet: wrongWallet,
        evidenceRefs: "evidence-1"
      },
      confirmations: {
        confirm: true
      }
    });

    for (const validation of [selectorValidation, resourcePatchValidation, submitSignalValidation]) {
      assert.equal(validation.ok, false);
      assert.deepEqual(validation.missingInputIds, []);
      assert.match(validation.errors.join("\n"), /钱包与授权参与方不匹配/);
    }
  });

  it("keeps multiple performance slots for one wallet distinguishable", () => {
    const customs = taskFixture("delivery_update", {
      taskId: "customs-task",
      assigneeWallet: wallet,
      participantWallet: wallet,
      participantRoleLabel: "履约者",
      performanceSlotId: "customs-slot",
      performanceSlotLabel: "出口报关履约者",
      businessPersonaLabels: ["报关行"]
    });
    const warehouse = taskFixture("evidence_submission", {
      taskId: "warehouse-task",
      assigneeWallet: wallet,
      participantWallet: wallet,
      participantRoleLabel: "履约者",
      performanceSlotId: "warehouse-slot",
      performanceSlotLabel: "入仓交付履约者",
      businessPersonaLabels: ["仓储方"]
    });
    const filterResult = filterParticipantTasksForWallet([customs, warehouse], wallet);
    const visible = filterResult.tasks;
    const displays = visible.map(taskExecutorDisplay);

    assert.deepEqual(visible.map((task) => task.taskId), ["customs-task", "warehouse-task"]);
    assert.notEqual(displays[0]?.slotKey, displays[1]?.slotKey);
    assert.deepEqual(displays.map((display) => display.performanceSlotLabel), ["出口报关履约者", "入仓交付履约者"]);
    assert.deepEqual(displays.map((display) => display.personaLabel), ["报关行", "仓储方"]);
  });
});

describe("participant task inbox helpers", () => {
  it("summarizes signal container elements without protocol jargon", () => {
    const task = taskFixture("delivery_update", {
      participantWallet: wallet,
      proofSummary: {
        label: "已生成证明",
        txHash: "0x7a3b",
        payloadHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    });
    const summary = signalContainerForTask(task);
    const visibleCopy = [
      summary.executingWalletLabel,
      summary.executingWalletSourceLabel,
      summary.requiredSummary,
      summary.proofSummaryLabel,
      summary.proofFingerprint
    ].join(" ");

    assert.equal(summary.executingWallet, wallet);
    assert.deepEqual(summary.evidenceLabels, ["凭证指纹"]);
    assert.equal(summary.proofAvailable, true);
    assert.doesNotMatch(visibleCopy, /HookReady|sourceId|signalId|ABI|calldata|gas/u);
  });

  it("filters wallet-bound tasks while retaining unbound demo tasks", () => {
    const filterResult = filterParticipantTasksForWallet([
      taskFixture("delivery_update", { taskId: "mine", assigneeWallet: wallet }),
      taskFixture("delivery_update", { taskId: "other", assigneeWallet: "0x0000000000000000000000000000000000000001" }),
      taskFixture("delivery_update", { taskId: "unbound" })
    ], wallet);

    assert.deepEqual(filterResult.tasks.map((task) => task.taskId), ["mine", "unbound"]);
    assert.equal(filterResult.totalFromApi, 3);
    assert.equal(filterResult.filtered, true);
    assert.equal(filterResult.filteredOutCount, 1);
  });

  it("sorts ready overdue, ready, blocked, submitted, failed, then confirmed tasks", () => {
    const now = new Date("2026-04-29T12:00:00Z");
    const ordered = sortParticipantTasks([
      taskFixture("delivery_update", { taskId: "done", status: "done", deadline: "2026-04-20 18:00" }),
      taskFixture("delivery_update", { taskId: "ready", status: "open", deadline: "2026-05-01 18:00" }),
      taskFixture("delivery_update", { taskId: "overdue", status: "open", deadline: "2026-04-20 18:00" }),
      taskFixture("delivery_update", { taskId: "submitted", status: "submitted", deadline: "2026-04-21 18:00" }),
      taskFixture("delivery_update", { taskId: "blocked", status: "blocked", deadline: "2026-04-21 18:00" }),
      taskFixture("delivery_update", { taskId: "failed", status: "submitted", deadline: "2026-04-21 18:00", errorCode: "REVERTED" })
    ], now);

    assert.deepEqual(ordered.map((task) => task.taskId), [
      "overdue",
      "ready",
      "blocked",
      "submitted",
      "failed",
      "done"
    ]);
    assert.equal(taskDisplay(ordered[0]!, now).label, "逾期待办");
  });

  it("keeps done tasks confirmed even when a stale errorCode lingers from an earlier failed attempt", () => {
    const doneWithResidualError = taskFixture("delivery_update", {
      taskId: "done-residual-error",
      status: "done",
      errorCode: "EARLIER_ATTEMPT_FAILED"
    });

    const display = taskDisplay(doneWithResidualError);

    assert.equal(display.state, "confirmed");
    assert.equal(display.label, "已确认");
  });

  it("renders submitted tasks as waiting-for-indexing, never as confirmed", () => {
    const submitted = taskFixture("delivery_update", { taskId: "submitted-only", status: "submitted" });

    const display = taskDisplay(submitted);

    assert.equal(display.state, "submitted");
    assert.equal(display.label, "等待链上确认");
  });

  it("keeps blocked and open tasks out of the failed bucket when a stale errorCode lingers", () => {
    // 残留的失败扩展不得改写服务端权威任务态：blocked 显示受阻、open 显示待办，
    // 只有 submitted 中间态才允许由失败扩展判"提交失败"。
    const blocked = taskDisplay(taskFixture("delivery_update", { taskId: "blocked-stale", status: "blocked", errorCode: "REVERTED" }));
    assert.equal(blocked.state, "blocked");
    assert.equal(blocked.label, "受阻");

    const open = taskDisplay(taskFixture("delivery_update", { taskId: "open-stale", status: "open", errorCode: "REVERTED", deadline: "2099-05-01 18:00" }));
    assert.equal(open.state, "ready");
    assert.equal(open.label, "待办");

    const submitted = taskDisplay(taskFixture("delivery_update", { taskId: "submitted-failed", status: "submitted", errorCode: "REVERTED" }));
    assert.equal(submitted.state, "failed");
    assert.equal(submitted.label, "提交失败");
  });

  it("returns all tasks unfiltered when no wallet is provided", () => {
    const result = filterParticipantTasksForWallet([
      taskFixture("delivery_update", { taskId: "a", assigneeWallet: wallet }),
      taskFixture("delivery_update", { taskId: "b", assigneeWallet: "0x0000000000000000000000000000000000000001" }),
      taskFixture("delivery_update", { taskId: "c" })
    ], undefined);

    assert.equal(result.filtered, false);
    assert.equal(result.filteredOutCount, 0);
    assert.equal(result.totalFromApi, 3);
    assert.deepEqual(result.tasks.map((task) => task.taskId), ["a", "b", "c"]);
  });

  it("filters all tasks out when wallet matches none", () => {
    const result = filterParticipantTasksForWallet([
      taskFixture("delivery_update", { taskId: "a", assigneeWallet: "0x0000000000000000000000000000000000000001" }),
      taskFixture("delivery_update", { taskId: "b", assigneeWallet: "0x0000000000000000000000000000000000000002" })
    ], wallet);

    assert.equal(result.tasks.length, 0);
    assert.equal(result.filtered, true);
    assert.equal(result.filteredOutCount, 2);
    assert.equal(result.totalFromApi, 2);
  });

  it("filters by participantWallet as well as assigneeWallet", () => {
    const result = filterParticipantTasksForWallet([
      taskFixture("delivery_update", { taskId: "a", participantWallet: wallet }),
      taskFixture("delivery_update", { taskId: "b", assigneeWallet: wallet }),
      taskFixture("delivery_update", { taskId: "c", participantWallet: "0x0000000000000000000000000000000000000003" })
    ], wallet);

    assert.deepEqual(result.tasks.map((task) => task.taskId), ["a", "b"]);
    assert.equal(result.filteredOutCount, 1);
  });

  it("formats wallet hint for display", () => {
    const hint = taskWalletHint("0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F");
    assert.equal(hint, "0x9d8a...5a4f");

    const short = taskWalletHint("0x0000000000000000000000000000000000000001");
    assert.equal(short, "0x0000...0001");
  });

  it("reports filter metadata when wallet matches all tasks", () => {
    const result = filterParticipantTasksForWallet([
      taskFixture("delivery_update", { taskId: "a", assigneeWallet: wallet }),
      taskFixture("delivery_update", { taskId: "b", participantWallet: wallet })
    ], wallet);

    assert.equal(result.tasks.length, 2);
    assert.equal(result.filtered, true);
    assert.equal(result.filteredOutCount, 0);
    assert.equal(result.totalFromApi, 2);
  });
});

function taskFixture(
  kind: FulfillmentPluginKind,
  overrides: Partial<ProductTaskWithAddOns> & { readonly errorCode?: string } = {}
): ProductTaskDTO {
  return {
    taskId: overrides.taskId ?? `task-${kind}`,
    orderId: "order-1",
    orderTitle: "样例订单",
    zhixuId: "zhixu-1",
    title: "提交待办",
    subtitle: "完成本阶段要求",
    assigneeRole: "参与方",
    assigneeWallet: overrides.assigneeWallet,
    stageId: "stage-1",
    stageName: "阶段一",
    deadline: overrides.deadline ?? "2026-05-01 18:00",
    fundingImpact: "进入下一阶段条件检查",
    status: overrides.status ?? "open",
    capabilityPlugin: overrides.capabilityPlugin ?? {
      pluginKind: kind,
      source: "explicit"
    },
    primaryActionLabel: "提交确认",
    requiredInputs: [
      {
        inputId: "evidence",
        label: "凭证指纹",
        inputType: "evidence",
        required: true,
        completed: false
      },
      {
        inputId: "confirmation",
        label: kind === "payment_placeholder" ? "确认付款条件占位" : "提交确认",
        inputType: kind === "payment_placeholder" ? "payment_placeholder" : "confirmation",
        required: true,
        completed: false
      }
    ],
    participantRoleLabel: "参与方",
    participantWallet: overrides.participantWallet,
    canSubmit: overrides.canSubmit,
    responsibilityStatements: [
      {
        title: "我确认材料真实",
        desc: "提交前已完成核对。"
      }
    ],
    proofRows: [],
    ...overrides
  } as ProductTaskDTO;
}

function filledState(task: ProductTaskDTO): TaskPluginState {
  const pluginKind = taskCapabilityPluginKind(task);
  return {
    task,
    walletAddress: wallet,
    values: {
      evidence: `evidence-${pluginKind}`
    },
    confirmations: {
      confirmation: true
    }
  };
}

function capabilityKindForAddOn(kind: ParticipantAddOnKind): FulfillmentPluginKind {
  switch (kind) {
    case "stage_executor_patch":
    case "submit_signal":
      return "evidence_submission";
    case "stage_resource_patch":
      return "payment_placeholder";
  }
}

function addOnManifestFixture(
  addOnKind: ParticipantAddOnKind,
  actionKind: ParticipantAddOnManifestDTO["actions"][number]["actionKind"],
  options: { readonly unsupportedResourceBindings?: boolean; readonly withApprovalBinding?: boolean } = {}
): ParticipantAddOnManifestDTO {
  if (actionKind === "stage_executor_patch") {
    const approvalComponent: ParticipantAddOnManifestComponentDTO = {
      componentId: "approval",
      componentKind: "text",
      inputId: "approval",
      label: "替换证明"
    };
    return {
      schemaVersion: "participant-addon-manifest.v1",
      manifestId: "stage-executor-patch:v1",
      roleSlotId: "stage-executor-patch",
      addOnKind,
      title: "选择履约者",
      summary: "选择后续履约者。",
      stageBindings: ["inspection"],
      pages: [{
        pageId: "main",
        title: "选择履约者",
        sections: [{
          sectionId: "inputs",
          title: "输入",
          components: [
            { componentId: "selector-wallet", componentKind: "wallet", inputId: "selectorWallet", label: "选择方钱包", required: true },
            { componentId: "target-stage", componentKind: "stage_select", inputId: "targetStageId", label: "目标阶段", required: true },
            { componentId: "executor-wallet", componentKind: "wallet", inputId: "executorWallet", label: "履约者钱包", required: true },
            { componentId: "executor-metadata-hash", componentKind: "hash", inputId: "executorMetadataHash", label: "履约者指纹", required: true },
            { componentId: "executor-reference", componentKind: "text", inputId: "executorReference", label: "履约者参考" },
            { componentId: "previous-executor", componentKind: "wallet", inputId: "previousExecutorWallet", label: "原履约者钱包" },
            { componentId: "metadata-uri", componentKind: "uri", inputId: "metadataURI", label: "补充说明 URI", required: true },
            { componentId: "mode", componentKind: "select", inputId: "mode", label: "处理方式", options: [{ value: "assign", label: "选择履约者" }] },
            ...(options.withApprovalBinding ? [approvalComponent] : [])
          ]
        }]
      }],
      actions: [{
        actionId: "select",
        actionKind,
        label: "选择履约者",
        primary: true,
        inputBindings: {
          selectorWallet: "selectorWallet",
          targetStageId: "targetStageId",
          executorWallet: "executorWallet",
          executorMetadataHash: "executorMetadataHash",
          executorReference: "executorReference",
          previousExecutorWallet: "previousExecutorWallet",
          metadataURI: "metadataURI",
          mode: "mode",
          ...(options.withApprovalBinding ? { approval: "approval" } : {})
        }
      }]
    };
  }
  if (actionKind === "stage_resource_patch") {
    const resourceComponents: ParticipantAddOnManifestComponentDTO[] = [
      { componentId: "selector-wallet", componentKind: "wallet", inputId: options.unsupportedResourceBindings ? "writerWallet" : "selectorWallet", label: "请求方钱包", required: true },
      { componentId: "target-stage", componentKind: "stage_select", inputId: "targetStageId", label: "目标阶段", required: true },
      { componentId: "resource-key", componentKind: "text", inputId: "resourceKey", label: "资源键", required: true },
      { componentId: "manifest-uri", componentKind: "uri", inputId: "manifestURI", label: "资源清单 URI", required: true },
      { componentId: "manifest-hash", componentKind: "hash", inputId: "manifestHash", label: "清单指纹", required: true },
      { componentId: "policy-hash", componentKind: "hash", inputId: "policyHash", label: "权限指纹", required: true }
    ];
    if (options.unsupportedResourceBindings) {
      resourceComponents.push({
        componentId: "visibility",
        componentKind: "select",
        inputId: "visibility",
        label: "可见性",
        required: true,
        options: [{ value: "protected", label: "受保护" }]
      });
    }
    return {
      schemaVersion: "participant-addon-manifest.v1",
      manifestId: "stage-resource-patch:v1",
      roleSlotId: "stage-resource-patch",
      addOnKind,
      title: "补充凭证要求",
      summary: "补充资源清单。",
      stageBindings: ["inspection"],
      pages: [{
        pageId: "main",
        title: "补充凭证要求",
        sections: [{
          sectionId: "inputs",
          title: "输入",
          components: resourceComponents
        }]
      }],
      actions: [{
        actionId: "resource",
        actionKind,
        label: "补充凭证要求",
        primary: true,
        inputBindings: {
          ...(options.unsupportedResourceBindings ? { writerWallet: "writerWallet" } : { selectorWallet: "selectorWallet" }),
          targetStageId: "targetStageId",
          resourceKey: "resourceKey",
          manifestURI: "manifestURI",
          manifestHash: "manifestHash",
          policyHash: "policyHash",
          ...(options.unsupportedResourceBindings ? { visibility: "visibility" } : {})
        }
      }]
    };
  }
  return {
    schemaVersion: "participant-addon-manifest.v1",
    manifestId: "submit-signal:v1",
    roleSlotId: "submit-signal",
    addOnKind,
    title: "履约提交",
    summary: "提交履约凭证。",
    stageBindings: ["stage-1"],
    pages: [{
      pageId: "main",
      title: "履约提交",
      sections: [{
        sectionId: "inputs",
        title: "输入",
        components: [
          { componentId: "wallet", componentKind: "wallet", inputId: "executorWallet", label: "履约者钱包", required: true },
          { componentId: "evidence", componentKind: "evidence_refs", inputId: "evidenceRefs", label: "凭证引用", required: true },
          { componentId: "confirm", componentKind: "confirmation", inputId: "confirm", label: "确认提交", required: true }
        ]
      }]
    }],
    actions: [{
      actionId: "confirm",
      actionKind,
      label: "提交确认",
      primary: true,
      intent: "confirm_stage",
      inputBindings: {
        walletAddress: "executorWallet",
        evidenceIds: "evidenceRefs"
      }
    }]
  };
}

describe("manifest-driven executor patch honors the replacement gate", () => {
  const manifest = addOnManifestFixture("stage_executor_patch", "stage_executor_patch", { withApprovalBinding: true });
  const task = taskFixture("evidence_submission", {
    addOnManifest: manifest,
    canSubmit: true,
    selectableTargets: [{ targetStageId: "inspection", targetStageName: "检验", allowed: true }]
  });
  const baseValues = {
    selectorWallet: wallet,
    targetStageId: "inspection",
    executorWallet: "0x0000000000000000000000000000000000000002",
    executorMetadataHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    metadataURI: "ipfs://executor/inspection"
  };

  function validateWith(values: Record<string, string>) {
    const action = manifest.actions[0]!;
    return validateAddOnManifestAction(manifest, action, {
      task,
      walletAddress: wallet,
      values: { ...baseValues, ...values },
      confirmations: {}
    });
  }

  it("rejects the self-invented replace spelling instead of letting it slip through as assign", () => {
    const validation = validateWith({ mode: "replace" });
    assert.equal(validation.ok, false);
    assert.ok(validation.errors.includes("处理方式必须是 assign/handoff/replacement 之一（协议拼写）。"));
  });

  it("requires a replacement proof for replacement mode, aligned with the application-level panel", () => {
    const missing = validateWith({ mode: "replacement" });
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.includes("需要替换证明。"));

    const present = validateWith({
      mode: "replacement",
      approval: JSON.stringify({ sourceId: "0x11", signalId: "0x22" }),
      previousExecutorWallet: "0x0000000000000000000000000000000000000003"
    });
    assert.equal(present.ok, true);
  });

  it("requires the previous executor wallet for handoff and replacement modes", () => {
    const handoff = validateWith({ mode: "handoff" });
    assert.equal(handoff.ok, false);
    assert.ok(handoff.errors.includes("请填写原履约者钱包。"));

    const replacement = validateWith({ mode: "replacement", approval: JSON.stringify({ sourceId: "0x11", signalId: "0x22" }) });
    assert.equal(replacement.ok, false);
    assert.ok(replacement.errors.includes("请填写原履约者钱包。"));
  });
});
