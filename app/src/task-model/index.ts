export type {
  CapturedEvidence,
  EvidenceCaptureStatus,
  EvidenceRequirement,
  EvidenceVerificationStatus,
  TaskSubmissionProof,
  TaskSubmissionStatus
} from "./types";
export {
  compactLabels,
  proofSummaryRowsForTask,
  signalContainerForTask,
  type TaskSignalContainerSummary
} from "../tasks/model/signalContainer";
export {
  taskAddOnKind,
  taskAddOnLabel,
  taskCapabilityPluginKind,
  taskExecutorDisplay,
  taskPrimaryActionLabel,
  taskRequiredInputsFromCapability,
  taskResourceRequirementInputs,
  taskSubmitIntent,
  type TaskExecutorDisplay,
  type TaskSubmitIntent
} from "../tasks/model/taskPresentation";
export {
  resourceRequirementDisplays,
  type EffectiveFileResourceDisplay
} from "../tasks/model/addOnTypes";
export {
  cleanString,
  parseEvidenceIds,
  sameAddress,
  // 签名域预期值（部署配置注入的独立来源）：evidence/proof 面板经此公共
  // 边界取用，不直接依赖 tasks 内部模块。
  stagePatchSignExpectation,
  submitSignExpectation,
  type SignDomainEnv
} from "../tasks/model/taskUtils";
export {
  // 任务作用域守卫（在途上传/提交的跨任务续作丢弃）：evidence 面板经此
  // 公共边界取用，不直接依赖 tasks 内部模块。
  useTaskScopeGuard
} from "../tasks/model/taskScope";
