/**
 * 实体注册写路径现状（页面与 README 共用的单一事实源）。
 */
export interface EntityRegistrationReadiness {
  readonly code: "entity_registration_self_service_ready";
  readonly headline: string;
  readonly summary: string;
  readonly verified: false;
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
