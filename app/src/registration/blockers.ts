/**
 * 实体注册写路径缺失的精确 blocker：页面与 README 共用这一份事实，避免
 * 界面文案与交付说明各写一套。服务端出现可用写接口后先改这里，再接线，
 * 不让页面继续宣称"不可提交"。
 */
export interface EntityRegistrationBlocker {
  readonly code: string;
  readonly headline: string;
  readonly summary: string;
  /** 已核对的候选写路径与不足（文件、路由、拒绝条件）。 */
  readonly checkedPaths: readonly string[];
  /** 解除本 blocker 的前提。 */
  readonly unblockCondition: string;
}

export const entityRegistrationBlocker: EntityRegistrationBlocker = {
  code: "entity_registration_write_path_missing",
  headline: "实体注册暂不可提交",
  summary:
    "Chain Services 目前只有身份背书与登记档案的只读接口，没有任何接受企业名称、注册号、联系人的注册写入接口；本页不会发送请求，也不会伪造提交结果。",
  checkedPaths: [
    "GET /identity/bindings 与 GET /identity/descriptors/:subjectId(/:descriptorHash) 是公开只读投影（chain-services/service/src/api/routes/governance.ts:117-166），没有对应写路由。",
    "POST /admin/governance/register-identity 只接受治理管理员（governance/service.ts:140-141），且要求已存在的供应商审核记录（缺失即 409 review_not_approved，:145-164）；descriptor 由审核记录构建，不接受注册表单字段。",
    "POST /store/suppliers/:id/request-identity-registration 需要 store.supplier.identity.register 能力、已锚定会话与确认字段（api/routes/store-suppliers.ts:217-230），且只接受已存在的 supplier 记录。",
    "POST /store/join-applications 是订单范围内的角色授权申请（planId/roleSlotId/authorizationKind，store/join/types.ts:18-62），不是实体注册。",
    "链上 UVPIdentityRegistry.registerIdentityBinding 是 onlyOwner（uvp-protocol/contracts/uvp-contracts/src/UVPIdentityRegistry.sol:67-72），由治理服务登记，没有钱包自助登记路径。",
    "Order App 消费的 Product API 路由（/product/*）没有注册或身份写入路由。",
    "uvp-eth 全仓没有接受企业名称/注册号/联系人字段的接口；A 层（机构承认层，含实名/KYB 注册）在 used-car 的职责矩阵里仍是待接外部机构（docs/order-app-split-and-functions.md §1、docs/order-app-base-components.md §2.1）。",
  ],
  unblockCondition:
    "A 层或 Chain Services 提供参与者可用的实体注册/实名核验写接口（含三字段的服务端契约）后，表单提交按该接口接线；在那之前提交动作保持显式不可用。",
};
