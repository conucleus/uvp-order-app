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
  taskPrimaryActionLabel
} from "./taskPresentation.js";
import {
  signalContainerForTask,
  supplierTrustBlocker
} from "./signalContainer.js";
import {
  filterParticipantTasksForWallet,
  sortParticipantTasks,
  taskDisplay,
  taskWalletHint
} from "./taskStatus.js";

const wallet = "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F";

describe("task plugin runtime", () => {
  it("defines PRD84 add-on kinds and keeps legacy fulfillment kinds available", () => {
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
      const task = taskFixture(legacyKindForAddOn(kind), { addOnKind: kind, canSubmit: true });
      const plugin = pluginForTask(task);
      const state = filledState(task);
      const validation = plugin.validate(state);
      const prepareInput = plugin.buildPrepareSubmit(state);

      assert.equal(taskAddOnKind(task), kind);
      assert.equal(plugin.kind, kind);
      assert.equal(validation.ok, true);
      assert.deepEqual(prepareInput.evidenceIds, [`evidence-${legacyKindForAddOn(kind)}`]);
      assert.equal(prepareInput.walletAddress, wallet);
      assert.equal(prepareInput.intent, legacyKindForAddOn(kind) === "dispute_material" ? "raise_dispute" : "confirm_stage");
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

  it("uses capability plugin metadata before legacy fulfillmentKind presentation", () => {
    const task = taskFixture("delivery_update", {
      fulfillmentKind: "delivery_update",
      capabilityPlugin: {
        pluginKind: "validation_confirm",
        source: "explicit",
        roleSlotId: "inspection-slot",
        title: "验收插件标题",
        summary: "来自 DTO 的验收插件说明",
        primaryActionLabel: "确认验收结论",
        requiredEvidence: ["验收单"],
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
    assert.deepEqual(presentation.allowedEvidenceTypes, ["验收单"]);
    assert.deepEqual(requiredInputsForTask(task, plugin).map((input) => input.label), ["验收报告编号"]);
    assert.equal(taskPrimaryActionLabel(task), "确认验收结论");
  });

  it("keeps legacy fulfillmentKind-only tasks selectable", () => {
    const task = taskFixture("dispute_material", {
      capabilityPlugin: undefined,
      fulfillmentKind: "dispute_material"
    });
    const plugin = pluginForTask(task);
    const presentation = pluginPresentationForTask(task, plugin);

    assert.equal(taskAddOnKind(task), "submit_signal");
    assert.equal(plugin.kind, "submit_signal");
    assert.equal(presentation.title, "争议材料");
    assert.match(presentation.summary, /争议说明/);
  });

  it("keeps canSubmit false tasks blocked at the runtime boundary", () => {
    const task = taskFixture("validation_confirm", { canSubmit: false });
    const plugin = pluginForTask(task);

    assert.equal(plugin.validate(filledState(task)).ok, false);
    assert.match(plugin.validate(filledState(task)).errors.join("\n"), /当前钱包暂不能提交/);
  });

  it("fails closed when supplier trust is missing or revoked", () => {
    const missing = taskFixture("delivery_update", {
      supplierSubjectId: "supplier-1",
      supplierTrustStatus: "not_found",
      canSubmit: true
    });
    const revoked = taskFixture("delivery_update", {
      supplierSubjectId: "supplier-1",
      supplierTrustStatus: "revoked",
      canSubmit: true
    });
    const plugin = pluginForTask(revoked);

    assert.equal(supplierTrustBlocker(missing), "未发现供应商背书，不能继续提交。");
    assert.equal(supplierTrustBlocker(revoked), "供应商背书已撤销，不能继续提交。");
    assert.equal(plugin.validate(filledState(revoked)).ok, false);
    assert.match(plugin.validate(filledState(revoked)).errors.join("\n"), /供应商背书已撤销/);
  });

  it("renders the payment placeholder contract without real funding claims", () => {
    const task = taskFixture("payment_placeholder", { capabilityPlugin: undefined });
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

  it("renders executor requirements and access status before legacy evidence", () => {
    const task = taskFixture("delivery_update", {
      addOnKind: "submit_signal",
      resourceRequirements: {
        inspection_report: {
          label: "第三方检验证明",
          documentType: "inspection_report",
          required: true,
          sourceLabel: "来自资源补充",
          visibility: "protected",
          ciphertextHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          accessStatus: {
            state: "request_required",
            label: "需要授权后查看加密文件",
            canRead: false
          }
        }
      }
    });
    const plugin = pluginForTask(task);
    const inputs = requiredInputsForTask(task, plugin);

    assert.equal(resourceRequirementDisplays(task)[0]?.label, "第三方检验证明");
    assert.equal(resourceRequirementDisplays(task)[0]?.accessLabel, "需要授权后查看加密文件");
    assert.equal(inputs[0]?.label, "第三方检验证明");
    assert.ok(inputs.some((input) => input.label === "凭证指纹"));
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

  it("blocks malformed Phase 2 manifest patch fields before prepare", () => {
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
      legacyResourceBindings: true
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
      supplierSubjectId: "supplier-1",
      supplierTrustStatus: "attested",
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
      summary.supplierTrustLabel,
      summary.requiredSummary,
      summary.proofSummaryLabel,
      summary.proofFingerprint
    ].join(" ");

    assert.equal(summary.executingWallet, wallet);
    assert.equal(summary.supplierTrustLabel, "已背书");
    assert.equal(summary.supplierTrustTone, "ok");
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
    requiredEvidence: ["凭证指纹"],
    status: overrides.status ?? "open",
    fulfillmentKind: kind,
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

function legacyKindForAddOn(kind: ParticipantAddOnKind): FulfillmentPluginKind {
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
  options: { readonly legacyResourceBindings?: boolean } = {}
): ParticipantAddOnManifestDTO {
  if (actionKind === "stage_executor_patch") {
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
            { componentId: "metadata-uri", componentKind: "uri", inputId: "metadataURI", label: "补充说明 URI", required: true },
            { componentId: "mode", componentKind: "select", inputId: "mode", label: "处理方式", options: [{ value: "assign", label: "选择履约者" }] }
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
          metadataURI: "metadataURI",
          mode: "mode"
        }
      }]
    };
  }
  if (actionKind === "stage_resource_patch") {
    const resourceComponents: ParticipantAddOnManifestComponentDTO[] = [
      { componentId: "selector-wallet", componentKind: "wallet", inputId: options.legacyResourceBindings ? "writerWallet" : "selectorWallet", label: "请求方钱包", required: true },
      { componentId: "target-stage", componentKind: "stage_select", inputId: "targetStageId", label: "目标阶段", required: true },
      { componentId: "resource-key", componentKind: "text", inputId: "resourceKey", label: "资源键", required: true },
      { componentId: "manifest-uri", componentKind: "uri", inputId: "manifestURI", label: "资源清单 URI", required: true },
      { componentId: "manifest-hash", componentKind: "hash", inputId: "manifestHash", label: "清单指纹", required: true },
      { componentId: "policy-hash", componentKind: "hash", inputId: "policyHash", label: "权限指纹", required: true }
    ];
    if (options.legacyResourceBindings) {
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
          ...(options.legacyResourceBindings ? { writerWallet: "writerWallet" } : { selectorWallet: "selectorWallet" }),
          targetStageId: "targetStageId",
          resourceKey: "resourceKey",
          manifestURI: "manifestURI",
          manifestHash: "manifestHash",
          policyHash: "policyHash",
          ...(options.legacyResourceBindings ? { visibility: "visibility" } : {})
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
