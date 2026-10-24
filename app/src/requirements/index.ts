/* order app V1 订单要求包模块的导出面：要求包读面、相对方合意与验收提交。 */
export { RequirementsPage, type RequirementsPageProps } from "./RequirementsPage";
export { AcceptancePanel, type AcceptancePanelProps } from "./AcceptancePanel";
export { consentFailureCopy } from "./consent";
export {
  createRequirementsResolver,
  fileResourcePrincipal,
  handleFailureCopy,
  handleStatusLabel,
  resolveFileHandle,
  type HandleResolutionStatus,
  type HandleResolutionView
} from "./handles";
