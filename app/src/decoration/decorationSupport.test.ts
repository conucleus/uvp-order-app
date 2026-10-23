import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductTaskDTO, ZhixuDetailDTO } from "@uvp-eth/product-dto";
import {
  decorateTaskEvidenceSpec,
  decorationEvidenceSpecForTask,
  decorationSlotsForStage,
  decorationTheme,
  planIdForZhixu,
  selectableTargetsFromZhixuStage,
  stageExecutorSelectionNote
} from "./decorationSupport.js";
import type { ZhixuDecorationView } from "./types.js";

function taskFixture(overrides: Partial<ProductTaskDTO> = {}): ProductTaskDTO {
  return {
    taskId: "task-1",
    orderId: "order-1",
    orderTitle: "订单",
    zhixuId: "zhixu-1",
    title: "任务",
    subtitle: "",
    assigneeRole: "参与方",
    stageId: "demand",
    stageName: "需求确认",
    deadline: "2026-05-01 18:00",
    fundingImpact: "无",
    status: "open",
    responsibilityStatements: [],
    proofRows: [],
    ...overrides
  } as ProductTaskDTO;
}

function zhixuFixture(overrides: Partial<ZhixuDetailDTO> = {}): ZhixuDetailDTO {
  return {
    zhixuId: "zhixu-1",
    title: "二手车出口",
    subtitle: "九阶段",
    reviewStatus: "approved",
    reviewLabel: "已审核",
    riskLevel: "中",
    applicableBusiness: [],
    excludedBusiness: [],
    stageCount: 2,
    roleSlotCount: 1,
    supportedPaymentMethods: [],
    maintainer: "运营方",
    updatedAt: "2026-01-01T00:00:00.000Z",
    planPublication: {
      status: "published",
      label: "已发布",
      stateMachineLabel: "状态机",
      planId: "0xplan",
      planHash: "0xhash"
    },
    roleSlots: [],
    dockableModules: [],
    stages: [
      { stageId: "demand", index: 0, name: "需求确认", evidence: [], ownerRole: "buyer", status: "active", selectedStageTargets: ["inspection"] },
      { stageId: "inspection", index: 2, name: "独立检测", evidence: [], ownerRole: "inspector", status: "pending" }
    ],
    orderPermissionTable: [],
    proofRows: [],
    createOrderHint: "",
    ...overrides
  } as ZhixuDetailDTO;
}

const decorationFixture: ZhixuDecorationView = {
  planId: "0xplan",
  current: {
    version: 2,
    data: {
      schemaVersion: "store-zhixu-decoration.v1",
      theme: {
        displayName: "中国—中亚二手车出口",
        description: "九步逐段确认",
        tags: ["二手车出口", "独立检测"],
        highlights: ["每阶段先交材料"]
      },
      taskDeclarations: [
        {
          stageId: "demand",
          evidenceSpec: [
            { key: "demand_vehicle", label: "意向车型与年份", inputKind: "text", required: true },
            { key: "demand_attachments", label: "补充需求清单", inputKind: "file", accept: [".pdf"], required: false }
          ]
        },
        {
          taskId: "task-1",
          evidenceSpec: [{ key: "exact_task", label: "任务级声明", inputKind: "text" }]
        },
        { stageId: "inspection", evidenceSpec: [] }
      ]
    }
  },
  versions: []
};

describe("decoration reader/evidence mapping", () => {
  it("reads theme only when it has displayable content", () => {
    assert.equal(decorationTheme(decorationFixture)?.displayName, "中国—中亚二手车出口");
    assert.deepEqual(decorationTheme(decorationFixture)?.tags, ["二手车出口", "独立检测"]);
    assert.equal(decorationTheme(undefined), undefined);
    assert.equal(
      decorationTheme({
        planId: "0xplan",
        current: { version: 1, data: { schemaVersion: "store-zhixu-decoration.v1", theme: { tags: ["  "] } } },
        versions: []
      }),
      undefined
    );
  });

  it("lists per-stage evidence slots for the reader page and skips empty declarations", () => {
    const demand = decorationSlotsForStage(decorationFixture, "demand");
    assert.deepEqual(demand.map((slot) => slot.key), ["demand_vehicle", "demand_attachments"]);
    assert.equal(demand[1]?.required, false);
    assert.deepEqual(decorationSlotsForStage(decorationFixture, "inspection"), []);
    assert.deepEqual(decorationSlotsForStage(undefined, "demand"), []);
  });

  it("fills task evidence from decoration only when the task carries no spec", () => {
    const fromDecoration = decorateTaskEvidenceSpec(taskFixture(), decorationFixture);
    assert.equal(fromDecoration.source, "decoration");
    // taskId 精确声明优先于 stageId 声明。
    assert.deepEqual(fromDecoration.task.evidenceSpec?.map((slot) => slot.key), ["exact_task"]);

    const byStage = decorateTaskEvidenceSpec(taskFixture({ taskId: "task-2" }), decorationFixture);
    assert.equal(byStage.source, "decoration");
    assert.deepEqual(byStage.task.evidenceSpec?.map((slot) => slot.key), ["demand_vehicle", "demand_attachments"]);

    const withOwnSpec = taskFixture({ evidenceSpec: [{ key: "own", label: "自有配置" }] });
    const kept = decorateTaskEvidenceSpec(withOwnSpec, decorationFixture);
    assert.equal(kept.source, "task");
    assert.equal(kept.task, withOwnSpec);
  });

  it("does not synthesize slots from invalid or absent declarations", () => {
    const invalidDecoration: ZhixuDecorationView = {
      planId: "0xplan",
      current: {
        version: 1,
        data: {
          schemaVersion: "store-zhixu-decoration.v1",
          taskDeclarations: [
            { stageId: "demand", evidenceSpec: [{ key: "dup", label: "a" }, { key: "dup", label: "b" }] }
          ]
        }
      },
      versions: []
    };
    assert.equal(decorationEvidenceSpecForTask(invalidDecoration, taskFixture()), undefined);
    const fallback = decorateTaskEvidenceSpec(taskFixture(), invalidDecoration);
    assert.equal(fallback.source, "none");
    assert.equal(fallback.task.evidenceSpec, undefined);
    assert.equal(decorationEvidenceSpecForTask(undefined, taskFixture()), undefined);
  });

  it("derives order-time executor targets from DSL selectedStages declarations", () => {
    const zhixu = zhixuFixture();
    const targets = selectableTargetsFromZhixuStage(zhixu, taskFixture());
    assert.deepEqual(targets.map((target) => target.targetStageId), ["inspection"]);
    assert.equal(targets[0]?.targetStageName, "独立检测");
    assert.equal(targets[0]?.selectorStageId, "demand");
    assert.deepEqual(selectableTargetsFromZhixuStage(zhixu, taskFixture({ stageId: "inspection" })), []);
    assert.deepEqual(selectableTargetsFromZhixuStage(undefined, taskFixture()), []);
  });

  it("states executor selection without introducing static/dynamic wording", () => {
    const zhixu = zhixuFixture();
    assert.equal(
      stageExecutorSelectionNote(zhixu, { stageId: "inspection" }),
      "执行者：由〈需求确认〉阶段在订单内选定"
    );
    assert.equal(stageExecutorSelectionNote(zhixu, { stageId: "demand" }), undefined);
    const selectedStageZhixu = zhixuFixture({
      stages: [{ stageId: "delivery", index: 3, name: "交付验收", evidence: [], ownerRole: "buyer", status: "pending", executorAssignment: "selected" }]
    });
    assert.equal(
      stageExecutorSelectionNote(selectedStageZhixu, { stageId: "delivery" }),
      "执行者：按约定在订单内选定"
    );
  });

  it("reads the decoration key from the plan publication identity", () => {
    assert.equal(planIdForZhixu(zhixuFixture()), "0xplan");
    assert.equal(
      planIdForZhixu({
        planPublication: { ...zhixuFixture().planPublication, planId: " " }
      } as ZhixuDetailDTO),
      undefined
    );
  });
});
