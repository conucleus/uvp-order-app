import type { Page, Route } from "@playwright/test";
import { demoProductCatalog } from "@uvp-eth/product-dto/fixtures";
import type { ProductExecutorPatchMode, ProductOrderDTO, ProductParticipantProfileDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import { buildProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";
import type { ProductTaskWithAddOns } from "../src/tasks/addOnTypes";

export const productApiBaseUrl = "http://product-api.test";
export const participantWallet = "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F";
export const unauthorizedWallet = "0x000000000000000000000000000000000000dEaD";
export const previousExecutorWallet = "0x2222222222222222222222222222222222222222";
export const approvalSourceId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const approvalSignalId = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const executorMetadataHash = "0x6666666666666666666666666666666666666666666666666666666666666666";

interface StubOptions {
  readonly task?: ProductTaskDTO;
  readonly submitStatus?: "indexing" | "confirmed";
  readonly walletMode?: "available" | "missing" | "reject";
}

const participant: ProductParticipantProfileDTO = {
  participantId: "demo-customs-agent",
  displayName: "张经理",
  walletAddress: participantWallet,
  roleLabels: ["报关行", "交付方"],
  source: "wallet"
};

export function readinessTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  const baseTask = demoProductCatalog.tasks.find((task) => task.taskId === "task-customs-complete-001") ??
    demoProductCatalog.tasks[1] ??
    demoProductCatalog.tasks[0];
  const { addOnManifest: _addOnManifest, ...fallbackBaseTask } = baseTask as ProductTaskWithAddOns;
  return {
    ...fallbackBaseTask,
    assigneeWallet: participantWallet,
    participantWallet,
    canSubmit: true,
    ...overrides
  } as ProductTaskDTO;
}

export function manifestTask(taskId: string, overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  const baseTask = demoProductCatalog.tasks.find((task) => task.taskId === taskId) ??
    demoProductCatalog.tasks[0];
  return {
    ...baseTask,
    assigneeWallet: participantWallet,
    participantWallet,
    canSubmit: true,
    ...overrides
  } as ProductTaskDTO;
}

export function executorManifestTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  const manifest = demoProductCatalog.zhixus[0]?.roleSlots.find((slot) => slot.slotId === "validation")?.addOnManifest;
  return readinessTask({
    taskId: "task-executor-manifest-001",
    title: "核对检验凭证",
    subtitle: "核对提交材料并确认验收结果。",
    assigneeRole: "验收方",
    stageId: "inspection",
    stageName: "检验验收",
    requiredEvidence: ["检验报告"],
    requiredInputs: [],
    addOnKind: "submit_signal",
    fulfillmentKind: "validation_confirm",
    performanceSlotId: "validation",
    performanceSlotLabel: "验收执行者",
    participantRoleLabel: "验收方",
    ...(manifest ? { addOnManifest: manifest } : {}),
    ...overrides
  });
}

export function selectorTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  return readinessTask({
    taskId: "task-selector-001",
    title: "选择检验履约者",
    subtitle: "为未开始阶段选择履约者。",
    assigneeRole: "买家",
    stageId: "selector-stage",
    stageName: "检验方选择",
    deadline: "2026-05-02 18:00",
    fundingImpact: "目标阶段履约者更新后继续推进",
    requiredEvidence: ["第三方检验证明"],
    requiredInputs: [],
    fulfillmentKind: "evidence_submission",
    primaryActionLabel: "选择履约者",
    performanceSlotId: "selector",
    performanceSlotLabel: "选择方",
    businessPersonaLabels: ["买家"],
    participantRoleLabel: "选择方",
    addOnKind: "stage_executor_patch",
    selectableTargets: [
      {
        targetStageId: "inspection",
        targetStageName: "检验阶段",
        allowed: true,
        workStarted: false,
        stageSignalCount: 0,
        description: "为检验阶段选择履约者。",
        executorPatchMode: "assign",
        executorPatchModes: [
          {
            mode: "assign",
            modeLabel: "选择履约者",
            allowed: true,
            workStarted: false,
            requiresSelectorSignature: true,
            requiresPreviousExecutorSignature: false,
            requiresApprovalSignal: false,
            priorAuthorityLabel: "阶段尚未开始",
            futureAuthorityLabel: "确认后由新履约者处理后续提交"
          }
        ]
      }
    ],
    responsibilityStatements: [
      {
        title: "我确认选择符合订单授权",
        desc: "提交前已核对目标阶段和履约者信息。"
      }
    ],
    ...overrides
  } as Partial<ProductTaskWithAddOns>);
}

export function handoffSelectorTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  return selectorTask({
    taskId: "task-selector-handoff-001",
    title: "交接检验履约者",
    subtitle: "已开始阶段由原履约者签名交接剩余工作。",
    primaryActionLabel: "交接履约者",
    selectableTargets: [
      {
        targetStageId: "inspection",
        targetStageName: "检验阶段",
        allowed: true,
        workStarted: true,
        stageSignalCount: 1,
        currentExecutorWallet: previousExecutorWallet,
        currentExecutorLabel: "原检验履约者",
        previousExecutor: previousExecutorWallet,
        previousExecutorWallet,
        previousExecutorLabel: "原检验履约者",
        executorPatchMode: "handoff",
        executorPatchModes: [
          {
            mode: "handoff",
            modeLabel: "交接履约者",
            allowed: true,
            workStarted: true,
            requiresSelectorSignature: true,
            requiresPreviousExecutorSignature: true,
            requiresApprovalSignal: false,
            previousExecutor: previousExecutorWallet,
            previousExecutorWallet,
            previousExecutorLabel: "原检验履约者",
            priorAuthorityLabel: "已完成部分不变",
            futureAuthorityLabel: "交接确认后，新履约者只接续后续工作",
            guidanceLabel: "需要原履约者签名"
          }
        ],
        priorAuthorityLabel: "已完成部分不变",
        futureAuthorityLabel: "交接确认后，新履约者只接续后续工作"
      }
    ],
    responsibilityStatements: [
      {
        title: "已完成部分不变",
        desc: "交接只影响后续履约权限，不改写已提交的阶段事实。"
      }
    ],
    ...overrides
  } as Partial<ProductTaskWithAddOns>);
}

export function replacementSelectorTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  return selectorTask({
    taskId: "task-selector-replacement-001",
    title: "申请替换检验履约者",
    subtitle: "已开始阶段缺少原履约者同意时，需要替换证明。",
    primaryActionLabel: "申请替换履约者",
    selectableTargets: [
      {
        targetStageId: "inspection",
        targetStageName: "检验阶段",
        allowed: true,
        workStarted: true,
        stageSignalCount: 2,
        currentExecutorWallet: previousExecutorWallet,
        currentExecutorLabel: "原检验履约者",
        previousExecutor: previousExecutorWallet,
        previousExecutorWallet,
        previousExecutorLabel: "原检验履约者",
        executorPatchMode: "replacement",
        approvalSourceId,
        approvalSignalId,
        approvalSignalLabel: "裁定方替换证明",
        executorPatchModes: [
          {
            mode: "replacement",
            modeLabel: "申请替换履约者",
            allowed: true,
            workStarted: true,
            requiresSelectorSignature: true,
            requiresPreviousExecutorSignature: false,
            requiresApprovalSignal: true,
            previousExecutor: previousExecutorWallet,
            previousExecutorWallet,
            previousExecutorLabel: "原检验履约者",
            approvalSourceId,
            approvalSignalId,
            approvalSignalLabel: "裁定方替换证明",
            approvalSignal: {
              approvalSourceId,
              approvalSignalId,
              label: "裁定方替换证明"
            },
            priorAuthorityLabel: "已完成部分不变",
            futureAuthorityLabel: "替换确认后，新履约者只接续后续工作",
            guidanceLabel: "需要替换证明"
          }
        ],
        priorAuthorityLabel: "已完成部分不变",
        futureAuthorityLabel: "替换确认后，新履约者只接续后续工作"
      }
    ],
    responsibilityStatements: [
      {
        title: "已完成部分不变",
        desc: "替换只影响后续履约权限，不改写已提交的阶段事实。"
      },
      {
        title: "需要替换证明",
        desc: "提交前需确认已有链上可核对的裁定或审批证明。"
      }
    ],
    ...overrides
  } as Partial<ProductTaskWithAddOns>);
}

export function resourcePatchTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  return readinessTask({
    taskId: "task-resource-controller-001",
    title: "补充检验凭证要求",
    subtitle: "为检验阶段发布加密内容寻址资源清单和访问策略。",
    assigneeRole: "买家",
    stageId: "resource-controller-stage",
    stageName: "检验凭证要求",
    deadline: "2026-05-02 18:00",
    fundingImpact: "目标阶段凭证清单更新后继续推进",
    requiredEvidence: ["第三方检验证明"],
    requiredInputs: [],
    fulfillmentKind: "evidence_submission",
    primaryActionLabel: "补充凭证要求",
    performanceSlotId: "resource-controller",
    performanceSlotLabel: "资源配置方",
    businessPersonaLabels: ["买家"],
    participantRoleLabel: "资源配置方",
    addOnKind: "stage_resource_patch",
    selectableTargets: [
      {
        targetStageId: "inspection",
        targetStageName: "检验阶段",
        allowed: true,
        description: "为检验阶段发布加密资源清单。",
        resourceRequirements: {
          inspection_report: {
            resourceKey: "inspection_report",
            label: "第三方检验证明",
            documentType: "inspection_report",
            required: true,
            source: "resource_patch",
            visibility: "protected",
            manifestURI: "ipfs://bafyuvp-inspection-manifest",
            manifestHash: "0x5555555555555555555555555555555555555555555555555555555555555555",
            accessPolicy: {
              policyHash: "0x8888888888888888888888888888888888888888888888888888888888888888"
            }
          }
        }
      }
    ],
    responsibilityStatements: [
      {
        title: "我确认资源清单符合订单授权",
        desc: "提交前已核对目标阶段、清单指纹和访问策略。"
      }
    ],
    ...overrides
  } as Partial<ProductTaskWithAddOns>);
}

export async function installProductApiStub(page: Page, options: StubOptions = {}): Promise<void> {
  if (process.env.UVP_ORDER_APP_E2E_PROFILE === "full") {
    throw new Error("Product API stubs cannot be installed when UVP_ORDER_APP_E2E_PROFILE=full");
  }

  const task = options.task ?? readinessTask();
  const orders = demoProductCatalog.orders as readonly ProductOrderDTO[];
  const tasks = [task];
  const evidenceId = "ev-customs-pdf-001";
  const payloadHash = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const walletMode = options.walletMode ?? "available";

  if (walletMode !== "missing") {
    await page.addInitScript(({ signature, reject }) => {
      const provider = {
        request: async ({ method }: { readonly method: string; readonly params?: readonly unknown[] }) => {
          if (method !== "eth_signTypedData_v4") {
            throw new Error(`unsupported wallet method ${method}`);
          }
          if (reject) {
            throw { code: 4001, message: "User rejected the request" };
          }
          return signature;
        }
      };
      (window as typeof window & { ethereum?: typeof provider }).ethereum = provider;
    }, {
      signature: `0x${"aa".repeat(65)}`,
      reject: walletMode === "reject"
    });
  }

  await page.route(`${productApiBaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (request.method() === "GET" && pathname === "/product/me") {
      await fulfillJson(route, {
        participant,
        summary: {
          orderCount: orders.length,
          openTaskCount: tasks.filter((item) => item.status === "open").length,
          blockedTaskCount: tasks.filter((item) => item.status === "blocked").length,
          completedTaskCount: tasks.filter((item) => item.status === "done" || item.status === "submitted").length
        }
      });
      return;
    }

    if (request.method() === "GET" && pathname === "/product/me/orders") {
      await fulfillJson(route, { participant, orders });
      return;
    }

    if (request.method() === "GET" && pathname === "/product/me/tasks") {
      await fulfillJson(route, { participant, tasks });
      return;
    }

    if (request.method() === "POST" && pathname === "/evidence") {
      await fulfillJson(route, {
        evidence: {
          evidenceId,
          orderId: task.orderId,
          taskId: task.taskId,
          stageIdentifier: task.stageId,
          fileName: "customs.pdf",
          mimeType: "application/pdf",
          size: 28,
          storageURI: `stub-offchain://${evidenceId}`,
          contentHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          metadataHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          payloadHash,
          payloadRef: `stub-proof://${payloadHash.slice(2)}`,
          status: "uploaded",
          createdAt: "2026-04-29T12:00:00.000Z"
        }
      });
      return;
    }

    if (request.method() === "GET" && pathname === `/evidence/${evidenceId}/proof`) {
      await fulfillJson(route, {
        proof: {
          evidenceId,
          payloadHash,
          contentHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          metadataHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          payloadRef: `stub-proof://${payloadHash.slice(2)}`,
          verificationStatus: "matched",
          blockNumber: "18,735,002",
          submitter: participantWallet
        }
      });
      return;
    }

    if (request.method() === "POST" && pathname === `/product/tasks/${task.taskId}/prepare-submit`) {
      const body = JSON.parse(request.postData() ?? "{}") as { readonly evidenceIds?: readonly string[]; readonly walletAddress?: string };
      if (!body.evidenceIds?.length) {
        await fulfillJson(route, { message: "missing evidence" }, 400);
        return;
      }
      if (body.walletAddress?.toLowerCase() !== participantWallet.toLowerCase()) {
        await fulfillJson(route, { message: "unauthorized wallet" }, 403);
        return;
      }
      await fulfillJson(route, {
        prepareId: "prep-customs-001",
        taskId: task.taskId,
        orderId: task.orderId,
        intent: "confirm_stage",
        payloadHash,
        submitter: participantWallet,
        expiresAt: "2026-04-29T13:00:00.000Z",
        typedData: buildProductSubmitTypedData({
          chainId: 31337,
          verifyingContract: "0x8888888888888888888888888888888888888888",
          orderId: "0x0101010101010101010101010101010101010101010101010101010101010101",
          sourceId: "0x0202020202020202020202020202020202020202020202020202020202020202",
          signalId: "0x0303030303030303030303030303030303030303030303030303030303030303",
          payloadHash,
          idempotencyKey: "0x0404040404040404040404040404040404040404040404040404040404040404",
          submitter: participantWallet,
          deadline: "1777777777"
        }),
        evidence: [{ evidenceId }]
      });
      return;
    }

    if (request.method() === "POST" && pathname === `/product/tasks/${task.taskId}/prepare-stage-executor-patch`) {
      const body = JSON.parse(request.postData() ?? "{}") as {
        readonly selectorWallet?: string;
        readonly targetStageId?: string;
        readonly mode?: unknown;
        readonly previousExecutor?: string;
        readonly previousExecutorWallet?: string;
        readonly approvalSourceId?: string;
        readonly approvalSignalId?: string;
        readonly approval?: {
          readonly sourceId?: string;
          readonly signalId?: string;
        };
        readonly executorWallet?: string;
        readonly executorReference?: string;
        readonly executorMetadataHash?: string;
        readonly metadataURI?: string;
      };
      const mode = isExecutorPatchMode(body.mode) ? body.mode : "assign";
      const previousExecutor = body.previousExecutorWallet ?? body.previousExecutor;
      const approvalSource = body.approvalSourceId ?? body.approval?.sourceId;
      const approvalSignal = body.approvalSignalId ?? body.approval?.signalId;
      if (body.selectorWallet?.toLowerCase() !== participantWallet.toLowerCase()) {
        await fulfillJson(route, { message: "unauthorized wallet" }, 403);
        return;
      }
      if (body.mode && !isExecutorPatchMode(body.mode)) {
        await fulfillJson(route, { message: "invalid executor patch mode" }, 400);
        return;
      }
      if (!body.targetStageId) {
        await fulfillJson(route, { message: "missing target stage" }, 400);
        return;
      }
      if ((mode === "handoff" || mode === "replacement") && !previousExecutor) {
        await fulfillJson(route, { message: "missing previous executor" }, 400);
        return;
      }
      if (mode === "replacement" && (!approvalSource || !approvalSignal)) {
        await fulfillJson(route, { message: "missing approval proof" }, 400);
        return;
      }
      if (!body.executorWallet) {
        await fulfillJson(route, { message: "missing executor" }, 400);
        return;
      }
      if (!body.executorMetadataHash) {
        await fulfillJson(route, { message: "missing executor metadata hash" }, 400);
        return;
      }
      if (!body.metadataURI) {
        await fulfillJson(route, { message: "missing metadata URI" }, 400);
        return;
      }
      await fulfillJson(route, {
        prepareId: "prep-executor-patch-001",
        taskId: task.taskId,
        selectorTaskId: task.taskId,
        orderId: task.orderId,
        targetStageId: body.targetStageId,
        mode,
        previousExecutor,
        previousExecutorWallet: previousExecutor,
        approvalSourceId: approvalSource,
        approvalSignalId: approvalSignal,
        patchHash: executorMetadataHash,
        expiresAt: "2026-04-29T13:00:00.000Z",
        typedData: {
          domain: {
            name: "UVPStateMachine",
            version: "0.2",
            chainId: 31337,
            verifyingContract: "0x8888888888888888888888888888888888888888"
          },
          types: {
            UVPStateMachineStageExecutorPatch: [
              { name: "orderId", type: "bytes32" },
              { name: "targetStageId", type: "string" },
              { name: "mode", type: "string" },
              { name: "selector", type: "address" },
              { name: "previousExecutor", type: "address" },
              { name: "approvalSourceId", type: "bytes32" },
              { name: "approvalSignalId", type: "bytes32" }
            ]
          },
          primaryType: "UVPStateMachineStageExecutorPatch",
          message: {
            orderId: task.orderId,
            targetStageId: body.targetStageId,
            mode,
            selector: participantWallet,
            previousExecutor: previousExecutor ?? "0x0000000000000000000000000000000000000000",
            approvalSourceId: approvalSource ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
            approvalSignalId: approvalSignal ?? "0x0000000000000000000000000000000000000000000000000000000000000000"
          }
        },
        humanSummary: {
          purpose: executorPatchModeLabel(mode),
          taskTitle: task.title,
          targetStage: body.targetStageId,
          action: executorPatchModeLabel(mode),
          validUntil: "2026-04-29T13:00:00.000Z"
        }
      });
      return;
    }

    if (request.method() === "POST" && pathname === `/product/tasks/${task.taskId}/submit-stage-executor-patch`) {
      const body = JSON.parse(request.postData() ?? "{}") as {
        readonly mode?: unknown;
        readonly previousExecutor?: string;
        readonly previousExecutorWallet?: string;
        readonly previousExecutorSignature?: string;
      };
      const mode = isExecutorPatchMode(body.mode) ? body.mode : "assign";
      const previousExecutor = body.previousExecutorWallet ?? body.previousExecutor;
      if (mode === "handoff" && !body.previousExecutorSignature) {
        await fulfillJson(route, { message: "missing previous executor signature" }, 400);
        return;
      }
      const status = options.submitStatus ?? "confirmed";
      await fulfillJson(route, {
        submissionId: "sub-executor-patch-001",
        prepareId: "prep-executor-patch-001",
        taskId: task.taskId,
        selectorTaskId: task.taskId,
        orderId: task.orderId,
        targetStageId: "inspection",
        mode,
        previousExecutor,
        previousExecutorWallet: previousExecutor,
        approvalSourceId: mode === "replacement" ? approvalSourceId : undefined,
        approvalSignalId: mode === "replacement" ? approvalSignalId : undefined,
        status,
        txHash: status === "confirmed" ? "0x7777777777777777777777777777777777777777777777777777777777777777" : undefined,
        blockNumber: status === "confirmed" ? "18,735,010" : undefined,
        retryable: status !== "confirmed",
        proofRows: [
          { label: "StageExecutorPatchApplied", value: status },
          { label: "处理方式", value: executorPatchModeLabel(mode) },
          ...(previousExecutor ? [{ label: "原履约者", value: previousExecutor }] : []),
          ...(mode === "replacement" ? [{ label: "替换证明", value: `${approvalSourceId} / ${approvalSignalId}` }] : []),
          { label: "凭证指纹", value: "0x6666666666666666666666666666666666666666666666666666666666666666" }
        ]
      });
      return;
    }

    if (request.method() === "POST" && pathname === `/product/tasks/${task.taskId}/prepare-stage-resource-patch`) {
      const body = JSON.parse(request.postData() ?? "{}") as {
        readonly selectorWallet?: string;
        readonly writerWallet?: string;
        readonly targetStageId?: string;
        readonly resourceKey?: string;
        readonly manifestURI?: string;
        readonly manifestHash?: string;
        readonly policyHash?: string;
        readonly visibility?: string;
      };
      const selectorWallet = body.selectorWallet ?? body.writerWallet;
      if (selectorWallet?.toLowerCase() !== participantWallet.toLowerCase()) {
        await fulfillJson(route, { message: "unauthorized wallet" }, 403);
        return;
      }
      if (!body.targetStageId || !body.resourceKey) {
        await fulfillJson(route, { message: "missing resource target" }, 400);
        return;
      }
      if (!body.manifestURI || !body.manifestHash || !body.policyHash) {
        await fulfillJson(route, { message: "missing manifest policy" }, 400);
        return;
      }
      await fulfillJson(route, {
        prepareId: "prep-resource-patch-001",
        taskId: task.taskId,
        orderId: task.orderId,
        targetStageId: body.targetStageId,
        resourceKey: body.resourceKey,
        manifestHash: body.manifestHash,
        policyHash: body.policyHash,
        patchHash: "0x9999999999999999999999999999999999999999999999999999999999999999",
        expiresAt: "2026-04-29T13:00:00.000Z",
        typedData: {
          domain: {
            name: "UVPStateMachine",
            version: "0.2",
            chainId: 31337,
            verifyingContract: "0x8888888888888888888888888888888888888888"
          },
          types: {
            UVPStateMachineStageResourcePatch: [
              { name: "orderId", type: "bytes32" },
              { name: "targetStageId", type: "string" },
              { name: "resourceKey", type: "string" },
              { name: "selector", type: "address" }
            ]
          },
          primaryType: "UVPStateMachineStageResourcePatch",
          message: {
            orderId: task.orderId,
            targetStageId: body.targetStageId,
            resourceKey: body.resourceKey,
            selector: participantWallet
          }
        },
        humanSummary: {
          purpose: "补充凭证要求",
          taskTitle: task.title,
          targetStage: body.targetStageId,
          resourceLabel: body.resourceKey,
          action: body.visibility ?? "protected",
          validUntil: "2026-04-29T13:00:00.000Z"
        }
      });
      return;
    }

    if (request.method() === "POST" && pathname === `/product/tasks/${task.taskId}/submit-stage-resource-patch`) {
      const status = options.submitStatus ?? "confirmed";
      await fulfillJson(route, {
        submissionId: "sub-resource-patch-001",
        prepareId: "prep-resource-patch-001",
        taskId: task.taskId,
        orderId: task.orderId,
        targetStageId: "inspection",
        resourceKey: "inspection_report",
        status,
        txHash: status === "confirmed" ? "0x9999999999999999999999999999999999999999999999999999999999990000" : undefined,
        blockNumber: status === "confirmed" ? "18,735,011" : undefined,
        retryable: status !== "confirmed",
        proofRows: [
          { label: "StageResourcePatchApplied", value: status },
          { label: "资源补充指纹", value: "0x9999999999999999999999999999999999999999999999999999999999999999" }
        ]
      });
      return;
    }

    if (request.method() === "POST" && pathname === `/product/tasks/${task.taskId}/submit`) {
      const body = JSON.parse(request.postData() ?? "{}") as { readonly signature?: string };
      if ((body.signature ?? "").toLowerCase().includes("reject")) {
        await fulfillJson(route, { message: "钱包签名被拒绝，未创建提交。" }, 400);
        return;
      }
      const status = options.submitStatus ?? "confirmed";
      await fulfillJson(route, {
        submissionId: "sub-customs-001",
        prepareId: "prep-customs-001",
        taskId: task.taskId,
        orderId: task.orderId,
        status,
        txHash: status === "confirmed" ? "0x4444444444444444444444444444444444444444444444444444444444444444" : undefined,
        blockNumber: status === "confirmed" ? "18,735,004" : undefined,
        retryable: status !== "confirmed",
        proofRows: [
          { label: "提交状态", value: status },
          { label: "凭证指纹", value: payloadHash }
        ]
      });
      return;
    }

    await fulfillJson(route, { message: `unhandled stub route ${request.method()} ${pathname}` }, 404);
  });
}

export async function uploadCustomsPdf(page: Page): Promise<void> {
  await page.getByLabel("选择报关单 PDF").setInputFiles({
    name: "customs.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("order app readiness customs pdf")
  });
}

function isExecutorPatchMode(value: unknown): value is ProductExecutorPatchMode {
  return value === "assign" || value === "handoff" || value === "replacement";
}

function executorPatchModeLabel(mode: ProductExecutorPatchMode): string {
  switch (mode) {
    case "assign":
      return "选择履约者";
    case "handoff":
      return "交接履约者";
    case "replacement":
      return "申请替换履约者";
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
