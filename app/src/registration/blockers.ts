/**
 * 实体注册写路径现状（页面与 README 共用的单一事实源）。
 *
 * 2026-10-23：Chain Services 已提供参与者可用的 `POST /product/registration`
 * 与 `GET /product/registration/me`（链下档案、会话锚定地址、单账号单活跃
 * 记录）。这里不再宣称"不可提交"，但必须把"未核验"与 A 层边界写清楚，
 * 避免把自助登记显示成身份核验或链上身份绑定。
 */
export interface EntityRegistrationReadiness {
  readonly code: "entity_registration_self_service_ready";
  readonly headline: string;
  readonly summary: string;
  /** 服务端 DTO 恒为 false 的事实：页面不得改写成"已验证"。 */
  readonly verified: false;
  /** 仍然存在的边界（人工核验 / A 机构 / 链上身份绑定）。 */
  readonly remainingBoundaries: readonly string[];
}

export const entityRegistrationReadiness: EntityRegistrationReadiness = {
  code: "entity_registration_self_service_ready",
  headline: "实体注册可自助提交（未核验）",
  summary:
    "提交后只写入 Chain Services 的链下登记档案，状态为「自助登记」：不写链、不创建供应商、不生成身份绑定。核验仍需人工或 A 机构，页面不会把登记显示成已验证。",
  verified: false,
  remainingBoundaries: [
    "实名/资质核验仍待人工或 A 机构（KYB）：当前登记状态恒为未核验，接口返回 verified: false。",
    "链上 UVPIdentityRegistry 身份绑定仍由治理服务登记（registerIdentityBinding 为 onlyOwner），自助登记不写链、不冒充身份注册表。",
    "不创建 Store 供应商档案，也不授予任何 Store 运营能力。",
    "注册号不做格式校验：服务端只校验必填与长度上限，不预设统一社会信用代码等格式规则。",
  ],
};
