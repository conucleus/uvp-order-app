/**
 * registration 模块的传输契约；响应形态单源在 chain-services。
 */

export interface ChainFactPointerDTO {
  readonly chainId: number;
  readonly contractAddress: string;
  readonly blockNumber: string;
  readonly transactionIndex?: number | undefined;
  readonly transactionHash: string;
  readonly logIndex: number;
}

export type IdentityBindingStatus = "active" | "revoked";

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
  readonly activeOnly?: boolean | undefined;
}

export interface WalletAddressBindingDTO {
  readonly accountId: string;
  readonly anchoredAddress: string;
  readonly linkedToExistingAccount: boolean;
  readonly addresses: readonly AccountAddressDTO[];
}

export type EntityRegistrationStatus = "self_declared" | "pending_review";

export interface EntityRegistrationDTO {
  readonly registrationId: string;
  readonly accountAddress: string;
  readonly accountId?: string | undefined;
  readonly legalName: string;
  readonly registrationNumber: string;
  readonly contactName: string;
  readonly status: EntityRegistrationStatus;
  readonly verified: false;
  readonly chainWritten: false;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegisterEntityInput {
  readonly legalName: string;
  readonly registrationNumber: string;
  readonly contactName: string;
}

export type EntityRegistrationField = "legalName" | "registrationNumber" | "contactName";

export interface EntityRegistrationDraft {
  readonly legalName: string;
  readonly registrationNumber: string;
  readonly contactName: string;
}

export type EntityRegistrationErrors = Readonly<Partial<Record<EntityRegistrationField, string>>>;

export type EntityRegistrationValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: EntityRegistrationErrors };
