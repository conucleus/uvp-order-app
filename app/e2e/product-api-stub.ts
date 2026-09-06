import type { Page, Route } from "@playwright/test";
import type {
  ParticipantAddOnManifestDTO,
  ProductExecutorPatchMode,
  ProductOrderDTO,
  ProductParticipantProfileDTO,
  ProductResourceRequirementDTO,
  ProductTaskDTO
} from "@uvp-eth/product-dto";
import {
  buildProductSubmitTypedData,
  STAGE_EXECUTOR_PATCH_DOMAIN_NAME,
  STAGE_EXECUTOR_PATCH_DOMAIN_VERSION
} from "@uvp-eth/executor-kit/participant";
import type { ProductTaskWithAddOns, SelectableTargetStageDTO } from "../src/tasks/addOnTypes";

export type { ProductTaskWithAddOns };

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
  participantId: "participant-customs-agent",
  displayName: "张经理",
  walletAddress: participantWallet,
  roleLabels: ["报关行", "交付方"],
  source: "wallet"
};

const stubOrder: ProductOrderDTO = {
  orderId: "order-cross-border-001",
  zhixuId: "zhixu-cross-border-001",
  title: "跨境出口报关订单",
  status: "registered",
  statusLabel: "履约中",
  totalAmount: { amount: "10000", currency: "USDC", display: "10,000 USDC" },
  fundingStatus: "funds_protected",
  currentStageId: "customs-complete",
  currentStageName: "出口报关",
  currentTaskId: "task-customs-submit-001",
  currentTaskTitle: "确认出口报关完成",
  currentTaskSummary: "提交本阶段报关凭证并确认阶段完成。",
  stages: [],
  participants: [],
  recentEvents: [],
  proofRows: []
};

function submitSignalManifest(input: {
  readonly roleSlotId: string;
  readonly title: string;
  readonly summary: string;
  readonly stageBindings: readonly string[];
  readonly actionLabel: string;
  readonly evidenceLabel: string;
}): ParticipantAddOnManifestDTO {
  return {
    schemaVersion: "participant-addon-manifest.v1",
    manifestId: `${input.roleSlotId}:submit-signal:v1`,
    roleSlotId: input.roleSlotId,
    addOnKind: "submit_signal",
    title: input.title,
    summary: input.summary,
    stageBindings: [...input.stageBindings],
    pages: [
      {
        pageId: "main",
        title: input.title,
        summary: input.summary,
        sections: [
          {
            sectionId: "inputs",
            title: "提交材料",
            components: [
              {
                componentId: "wallet",
                componentKind: "wallet",
                inputId: `${input.roleSlotId}.wallet`,
                label: "参与方钱包",
                required: true
              },
              {
                componentId: "evidence",
                componentKind: "evidence_refs",
                inputId: `${input.roleSlotId}.evidence`,
                label: input.evidenceLabel,
                required: true,
                placeholder: "输入 evidenceId、CID 或凭证指纹；多个值可换行"
              },
              {
                componentId: "confirmation",
                componentKind: "confirmation",
                inputId: `${input.roleSlotId}.confirmation`,
                label: input.actionLabel,
                required: true
              },
              {
                componentId: "proof",
                componentKind: "proof_rows",
                label: "证明"
              }
            ]
          }
        ]
      }
    ],
    actions: [
      {
        actionId: `${input.roleSlotId}.confirm`,
        actionKind: "submit_signal",
        label: input.actionLabel,
        primary: true,
        intent: "confirm_stage",
        inputBindings: {
          walletAddress: `${input.roleSlotId}.wallet`,
          evidenceIds: `${input.roleSlotId}.evidence`,
          confirmation: `${input.roleSlotId}.confirmation`
        }
      }
    ]
  };
}

const deliveryAddOnManifest = submitSignalManifest({
  roleSlotId: "delivery",
  title: "交付进度更新",
  summary: "提交报关、装船、物流和到港凭证，更新交付环节状态。",
  stageBindings: ["customs-complete"],
  actionLabel: "确认报关完成",
  evidenceLabel: "交付凭证引用"
});

const validationAddOnManifest = submitSignalManifest({
  roleSlotId: "validation",
  title: "检验验收确认",
  summary: "核对检验报告和验收单，确认阶段条件是否满足。",
  stageBindings: ["inspection"],
  actionLabel: "确认验收结果",
  evidenceLabel: "验收凭证引用"
});

const selectorAddOnManifest: ParticipantAddOnManifestDTO = {
  schemaVersion: "participant-addon-manifest.v1",
  manifestId: "buyer-selector:v1",
  roleSlotId: "buyer-selector",
  addOnKind: "stage_executor_patch",
  title: "选择履约者",
  summary: "为目标阶段选择、交接或替换后续履约者。",
  stageBindings: ["customs-complete"],
  pages: [
    {
      pageId: "executor-selection",
      title: "履约者选择",
      sections: [
        {
          sectionId: "selection",
          title: "选择设置",
          components: [
            { componentId: "target-stage", componentKind: "stage_select", inputId: "selector.targetStageId", label: "目标阶段", required: true },
            { componentId: "mode", componentKind: "select", inputId: "selector.mode", label: "处理方式", required: true, defaultValue: "assign", options: [
              { value: "assign", label: "选择履约者" },
              { value: "handoff", label: "交接履约者" },
              { value: "replacement", label: "申请替换履约者" }
            ] },
            { componentId: "selector-wallet", componentKind: "wallet", inputId: "selector.selectorWallet", label: "选择方钱包", required: true },
            { componentId: "executor-wallet", componentKind: "wallet", inputId: "selector.executorWallet", label: "履约者钱包", required: true },
            { componentId: "executor-metadata-hash", componentKind: "hash", inputId: "selector.executorMetadataHash", label: "履约者元数据指纹", required: true },
            { componentId: "executor-reference", componentKind: "text", inputId: "selector.executorReference", label: "履约者参考" },
            { componentId: "metadata-uri", componentKind: "uri", inputId: "selector.metadataURI", label: "补充说明 URI", required: true },
            { componentId: "proof", componentKind: "proof_rows", label: "证明" }
          ]
        }
      ]
    }
  ],
  actions: [
    {
      actionId: "selector.apply-executor-patch",
      actionKind: "stage_executor_patch",
      label: "选择履约者",
      primary: true,
      inputBindings: {
        selectorWallet: "selector.selectorWallet",
        targetStageId: "selector.targetStageId",
        mode: "selector.mode",
        executorWallet: "selector.executorWallet",
        executorMetadataHash: "selector.executorMetadataHash",
        metadataURI: "selector.metadataURI"
      }
    }
  ]
};

const resourcePatchAddOnManifest: ParticipantAddOnManifestDTO = {
  schemaVersion: "participant-addon-manifest.v1",
  manifestId: "buyer-resource-controller:v1",
  roleSlotId: "buyer-resource-controller",
  addOnKind: "stage_resource_patch",
  title: "补充凭证要求",
  summary: "为目标阶段发布内容寻址资源清单和访问策略。",
  stageBindings: ["customs-complete"],
  pages: [
    {
      pageId: "resource-requirements",
      title: "资源清单",
      sections: [
        {
          sectionId: "resource",
          title: "补充资源",
          components: [
            { componentId: "target-stage", componentKind: "stage_select", inputId: "resourcePatch.targetStageId", label: "目标阶段", required: true },
            { componentId: "selector-wallet", componentKind: "wallet", inputId: "resourcePatch.selectorWallet", label: "资源配置钱包", required: true },
            { componentId: "resource-key", componentKind: "text", inputId: "resourcePatch.resourceKey", label: "资源键", required: true },
            { componentId: "manifest-uri", componentKind: "uri", inputId: "resourcePatch.manifestURI", label: "资源清单 URI", required: true },
            { componentId: "manifest-hash", componentKind: "hash", inputId: "resourcePatch.manifestHash", label: "清单指纹", required: true },
            { componentId: "policy-hash", componentKind: "hash", inputId: "resourcePatch.policyHash", label: "权限指纹", required: true },
            { componentId: "requirements", componentKind: "resource_requirements", label: "有效凭证要求" },
            { componentId: "proof", componentKind: "proof_rows", label: "证明" }
          ]
        }
      ]
    }
  ],
  actions: [
    {
      actionId: "resourcePatch.apply-resource-patch",
      actionKind: "stage_resource_patch",
      label: "补充凭证要求",
      primary: true,
      inputBindings: {
        selectorWallet: "resourcePatch.selectorWallet",
        targetStageId: "resourcePatch.targetStageId",
        resourceKey: "resourcePatch.resourceKey",
        manifestURI: "resourcePatch.manifestURI",
        manifestHash: "resourcePatch.manifestHash",
        policyHash: "resourcePatch.policyHash"
      }
    }
  ]
};

const inspectionResourceRequirement: ProductResourceRequirementDTO = {
  resourceId: "inspection_report",
  resourceKey: "inspection_report",
  label: "第三方检验证明",
  required: true,
  source: "resource_patch",
  visibility: "protected",
  manifestURI: "ipfs://bafyuvp-inspection-manifest",
  manifestHash: "0x5555555555555555555555555555555555555555555555555555555555555555",
  accessPolicy: {
    visibility: "protected",
    readers: [],
    writers: [],
    controllers: [],
    policyHash: "0x8888888888888888888888888888888888888888888888888888888888888888"
  }
};

// BFF 任务契约要求 capabilityPlugin.pluginKind（缺省会使前端 taskCapabilityPluginKind 直接抛错）。
// 与 product-dto fixtures/customs.ts 的插件形态保持一致。
const customsDeliveryPlugin = {
  pluginKind: "delivery_update",
  source: "explicit",
  roleSlotId: "delivery",
  title: "交付进度更新",
  summary: "报关履约者提交报关、装船、物流凭证并更新交付状态。",
  primaryActionLabel: "确认报关完成"
} as const;

const stageSelectorPlugin = {
  pluginKind: "evidence_submission",
  source: "explicit",
  roleSlotId: "buyer-selector",
  title: "选择履约者",
  summary: "买家为目标阶段选择、交接或替换履约者。",
  primaryActionLabel: "选择履约者"
} as const;

const resourceControllerPlugin = {
  pluginKind: "evidence_submission",
  source: "explicit",
  roleSlotId: "buyer-resource-controller",
  title: "补充凭证要求",
  summary: "买家发布内容寻址资源清单和访问策略。",
  primaryActionLabel: "补充凭证要求"
} as const;

const inspectionValidationPlugin = {
  pluginKind: "validation_confirm",
  source: "explicit",
  roleSlotId: "validation",
  title: "检验验收确认",
  summary: "验收方核对检验凭证并确认验收结果。",
  primaryActionLabel: "确认验收结果"
} as const;

const customsBaseTask: ProductTaskWithAddOns = {
  taskId: "task-customs-submit-001",
  orderId: stubOrder.orderId,
  zhixuId: stubOrder.zhixuId,
  orderTitle: stubOrder.title,
  title: "确认出口报关完成",
  subtitle: "你代表 XX 报关行，需要提交本阶段凭证。",
  assigneeRole: "XX 报关行",
  stageId: "customs-complete",
  stageName: "出口报关",
  deadline: "2026-05-03 18:00",
  fundingImpact: "进入验收；通过后第 2 阶段付款条件满足",
  status: "open",
  addOnKind: "submit_signal",
  addOnManifest: deliveryAddOnManifest,
  capabilityPlugin: customsDeliveryPlugin,
  primaryActionLabel: "确认报关完成",
  participantRoleLabel: "报关行",
  responsibilityStatements: [],
  proofRows: []
};

export function readinessTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  return {
    ...customsBaseTask,
    assigneeWallet: participantWallet,
    participantWallet,
    canSubmit: true,
    ...overrides
  } as ProductTaskDTO;
}

/**
 * 无 addOnManifest 的提交任务：EvidencePanel 直渲染路径（evidenceSpec 单轨口径），
 * 用于必填凭证校验、钱包授权预检与签名提交链路的负向用例。
 */
export function customsEvidenceTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  return readinessTask({
    taskId: "task-customs-evidence-001",
    addOnManifest: undefined,
    evidenceSpec: [
      {
        key: "customs_declaration_pdf",
        label: "报关单 PDF",
        required: true,
        inputKind: "file",
        accept: ["application/pdf", ".pdf"]
      }
    ],
    ...overrides
  });
}

const manifestTasks: Readonly<Record<string, ProductTaskDTO>> = {
  "task-customs-submit-001": readinessTask(),
  "task-selector-customs-001": readinessTask({
    taskId: "task-selector-customs-001",
    title: "选择或交接履约者",
    subtitle: "未开始阶段可选择履约者；已开始阶段需走交接或替换证明。",
    stageId: "order-confirmed",
    stageName: "订单确认",
    addOnKind: "stage_executor_patch",
    addOnManifest: selectorAddOnManifest,
    capabilityPlugin: stageSelectorPlugin,
    selectableTargets: [
      {
        targetStageId: "customs-complete",
        targetStageName: "出口报关",
        allowed: true
      }
    ],
    primaryActionLabel: "选择履约者"
  }),
  "task-resource-controller-001": readinessTask({
    taskId: "task-resource-controller-001",
    title: "补充报关凭证要求",
    subtitle: "你可以为目标阶段发布加密内容寻址资源清单和访问策略。",
    stageId: "order-confirmed",
    stageName: "订单确认",
    addOnKind: "stage_resource_patch",
    addOnManifest: resourcePatchAddOnManifest,
    capabilityPlugin: resourceControllerPlugin,
    selectableTargets: [
      {
        targetStageId: "customs-complete",
        targetStageName: "出口报关",
        allowed: true,
        resourceRequirements: [inspectionResourceRequirement]
      }
    ],
    resourceRequirements: [inspectionResourceRequirement],
    primaryActionLabel: "补充凭证要求"
  })
};

export function manifestTask(taskId: string, overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  const baseTask = manifestTasks[taskId] ?? readinessTask();
  return {
    ...baseTask,
    ...overrides
  } as ProductTaskDTO;
}

export function executorManifestTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  return readinessTask({
    taskId: "task-executor-manifest-001",
    title: "核对检验凭证",
    subtitle: "核对提交材料并确认验收结果。",
    stageId: "inspection",
    stageName: "检验验收",
    addOnKind: "submit_signal",
    addOnManifest: validationAddOnManifest,
    capabilityPlugin: inspectionValidationPlugin,
    primaryActionLabel: "确认验收结果",
    participantRoleLabel: "验收方",
    ...overrides
  });
}

export function selectorTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  return readinessTask({
    taskId: "task-selector-001",
    title: "选择检验履约者",
    subtitle: "为未开始阶段选择履约者。",
    stageId: "selector-stage",
    stageName: "检验方选择",
    deadline: "2026-05-02 18:00",
    fundingImpact: "目标阶段履约者更新后继续推进",
    primaryActionLabel: "选择履约者",
    participantRoleLabel: "选择方",
    addOnKind: "stage_executor_patch",
    // 补丁动作走 ExecutorPatchPanel 直渲染：不带 addOnManifest（否则 manifest 流量门控
    // 会改为渲染 ManifestAddOnPanel，覆盖不到履约者选择表单）。
    addOnManifest: undefined,
    capabilityPlugin: stageSelectorPlugin,
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
  });
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
        previousExecutor: previousExecutorWallet,
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
  });
}

export function replacementSelectorTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  const replacementTarget: SelectableTargetStageDTO = {
    targetStageId: "inspection",
    targetStageName: "检验阶段",
    allowed: true,
    workStarted: true,
    stageSignalCount: 2,
    currentExecutorWallet: previousExecutorWallet,
    previousExecutor: previousExecutorWallet,
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
  };
  return selectorTask({
    taskId: "task-selector-replacement-001",
    title: "申请替换检验履约者",
    subtitle: "已开始阶段缺少原履约者同意时，需要替换证明。",
    primaryActionLabel: "申请替换履约者",
    selectableTargets: [replacementTarget],
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
  });
}

export function resourcePatchTask(overrides: Partial<ProductTaskWithAddOns> = {}): ProductTaskDTO {
  return readinessTask({
    taskId: "task-resource-controller-001-patch-flow",
    title: "补充检验凭证要求",
    subtitle: "为检验阶段发布加密内容寻址资源清单和访问策略。",
    stageId: "resource-controller-stage",
    stageName: "检验凭证要求",
    deadline: "2026-05-02 18:00",
    fundingImpact: "目标阶段凭证清单更新后继续推进",
    primaryActionLabel: "补充凭证要求",
    participantRoleLabel: "资源配置方",
    addOnKind: "stage_resource_patch",
    // 资源补充走 ResourcePatchPanel 直渲染：不带 addOnManifest。
    addOnManifest: undefined,
    capabilityPlugin: resourceControllerPlugin,
    selectableTargets: [
      {
        targetStageId: "inspection",
        targetStageName: "检验阶段",
        allowed: true,
        description: "为检验阶段发布加密资源清单。",
        resourceRequirements: [inspectionResourceRequirement]
      }
    ],
    responsibilityStatements: [
      {
        title: "我确认资源清单符合订单授权",
        desc: "提交前已核对目标阶段、清单指纹和访问策略。"
      }
    ],
    ...overrides
  });
}

export async function installProductApiStub(page: Page, options: StubOptions = {}): Promise<void> {
  if (process.env.UVP_ORDER_APP_E2E_PROFILE === "full") {
    throw new Error("Product API stubs cannot be installed when UVP_ORDER_APP_E2E_PROFILE=full");
  }

  const task = options.task ?? readinessTask();
  const orders = [stubOrder];
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
          // submitted 是等待索引的中间态，不计入已完成。
          completedTaskCount: tasks.filter((item) => item.status === "done").length
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

    if (request.method() === "POST" && pathname === "/product/evidence") {
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

    if (request.method() === "GET" && pathname === `/product/evidence/${evidenceId}/proof`) {
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
        readonly previousExecutorWallet?: string;
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
      const previousExecutor = body.previousExecutorWallet;
      const approvalSource = body.approval?.sourceId;
      const approvalSignal = body.approval?.signalId;
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
        patchHash: executorMetadataHash,
        expiresAt: "2026-04-29T13:00:00.000Z",
        typedData: {
          domain: {
            name: STAGE_EXECUTOR_PATCH_DOMAIN_NAME,
            version: STAGE_EXECUTOR_PATCH_DOMAIN_VERSION,
            chainId: 31337,
            verifyingContract: "0x8888888888888888888888888888888888888888"
          },
          types: {
            UVPStagePatchModuleStageExecutorPatch: [
              { name: "orderId", type: "bytes32" },
              { name: "targetStageId", type: "string" },
              { name: "mode", type: "string" },
              { name: "selector", type: "address" },
              { name: "previousExecutor", type: "address" },
              { name: "approvalSourceId", type: "bytes32" },
              { name: "approvalSignalId", type: "bytes32" }
            ]
          },
          primaryType: "UVPStagePatchModuleStageExecutorPatch",
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
        readonly previousExecutorWallet?: string;
        readonly previousExecutorSignature?: string;
      };
      const mode = isExecutorPatchMode(body.mode) ? body.mode : "assign";
      const previousExecutor = body.previousExecutorWallet;
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
        readonly targetStageId?: string;
        readonly resourceKey?: string;
        readonly manifestURI?: string;
        readonly manifestHash?: string;
        readonly policyHash?: string;
      };
      if (body.selectorWallet?.toLowerCase() !== participantWallet.toLowerCase()) {
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
            name: STAGE_EXECUTOR_PATCH_DOMAIN_NAME,
            version: STAGE_EXECUTOR_PATCH_DOMAIN_VERSION,
            chainId: 31337,
            verifyingContract: "0x8888888888888888888888888888888888888888"
          },
          types: {
            UVPStagePatchModuleStageResourcePatch: [
              { name: "orderId", type: "bytes32" },
              { name: "targetStageId", type: "string" },
              { name: "resourceKey", type: "string" },
              { name: "selector", type: "address" }
            ]
          },
          primaryType: "UVPStagePatchModuleStageResourcePatch",
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
          action: "protected",
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
    // %PDF- 首字节魔数：evidenceSpec accept=pdf 时前端做快检，伪造 MIME/扩展名在上传前拦截。
    buffer: Buffer.from("%PDF-1.4\norder app readiness customs pdf")
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
