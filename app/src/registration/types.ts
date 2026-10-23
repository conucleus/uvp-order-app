/**
 * registration 模块的传输契约：身份背书事实与钱包会话地址的服务端响应形态。
 * 形态单源在 chain-services：api/routes/governance.ts（/identity/*）、
 * api/routes/store-auth.ts（/store/auth/*）、indexer/identity-projections.ts、
 * governance/descriptors.ts、store/sessions/types.ts。app 的依赖面不含
 * chain-services 类型包，本文件是响应形状的只读镜像；状态词表与字段语义
 * 不在本地另立。
 */

/** 链上事实指针：JSON 序列化时 blockNumber（bigint）被服务端转成十进制字符串。 */
export interface ChainFactPointerDTO {
  readonly chainId: number;
  readonly contractAddress: string;
  readonly blockNumber: string;
  readonly transactionIndex?: number | undefined;
  readonly transactionHash: string;
  readonly logIndex: number;
}

export type IdentityBindingStatus = "active" | "revoked";

/** GET /identity/bindings 返回的 UVPIdentityRegistry 投影记录。 */
export interface IdentityBindingDTO {
  readonly registryAddress: string;
  readonly bindingId: string;
  readonly subjectId: string;
  readonly account: string;
  readonly descriptorHash: string;
  readonly descriptorURI: string;
  readonly registrar: string;
  readonly status: IdentityBindingStatus;
  readonly registeredAt: ChainFactPointerDTO;
  readonly updatedAt: ChainFactPointerDTO;
  readonly revokeReasonHash?: string | undefined;
  readonly revokeReasonURI?: string | undefined;
  readonly revokedAt?: ChainFactPointerDTO | undefined;
}

/** GET /identity/descriptors/:subjectId/:descriptorHash 返回的档案快照。 */
export interface IdentityDescriptorSnapshotDTO {
  readonly subjectId: string;
  readonly descriptorHash: string;
  readonly hashScheme: string;
  readonly descriptor: unknown;
  readonly descriptorJson: string;
  readonly verification: {
    readonly recomputedDescriptorHash: string;
    readonly matches: boolean;
  };
  readonly source: string;
  readonly createdAt: string;
}

export type AccountAddressStatus = "active" | "revoked";

/** GET /store/auth/addresses 返回的账号地址记录。 */
export interface AccountAddressDTO {
  readonly address: string;
  readonly status: AccountAddressStatus;
  readonly anchoredAt: string;
}

export interface AccountAddressesDTO {
  readonly accountId: string;
  readonly addresses: readonly AccountAddressDTO[];
}

export interface IdentityBindingQuery {
  readonly account?: string | undefined;
  /** false（缺省按服务端口径返回全部）时包含已撤销记录。 */
  readonly activeOnly?: boolean | undefined;
}

/** 一次地址归属签名证明（anchor_address intent）成功后的账号地址事实。 */
export interface WalletAddressBindingDTO {
  readonly accountId: string;
  readonly anchoredAddress: string;
  readonly linkedToExistingAccount: boolean;
  readonly addresses: readonly AccountAddressDTO[];
}

export type EntityRegistrationField = "entityName" | "registrationNumber" | "contactName";

/** 实体注册表单草稿（企业名称、注册号、联系人）。 */
export interface EntityRegistrationDraft {
  readonly entityName: string;
  readonly registrationNumber: string;
  readonly contactName: string;
}

export type EntityRegistrationErrors = Readonly<Partial<Record<EntityRegistrationField, string>>>;

export type EntityRegistrationValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: EntityRegistrationErrors };
