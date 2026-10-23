/**
 * order app 注册模块（rough）：实体注册表单、钱包归属签名证明、身份背书事实。
 * 数据通路与写路径 blocker 见同目录 README.md；本包只导出 RegistrationPage
 * 与类型化 client，宿主接线不改本目录之外的文件。
 */
export { RegistrationPage } from "./RegistrationPage";
export type {
  RegistrationPageProps,
  RegistrationSessionTokenSource,
  RegistrationWalletLogin,
} from "./RegistrationPage";
export { createRegistrationClient, isRegistrationApiError, RegistrationApiError } from "./client";
export type {
  RegistrationClient,
  RegistrationClientOptions,
  RegistrationFetcher,
  RegistrationWalletSigner,
} from "./client";
export { entityRegistrationBlocker } from "./blockers";
export type { EntityRegistrationBlocker } from "./blockers";
export { validateEntityRegistrationDraft } from "./form";
export type {
  AccountAddressDTO,
  AccountAddressesDTO,
  AccountAddressStatus,
  ChainFactPointerDTO,
  EntityRegistrationDraft,
  EntityRegistrationErrors,
  EntityRegistrationField,
  EntityRegistrationValidation,
  IdentityBindingDTO,
  IdentityBindingQuery,
  IdentityBindingStatus,
  IdentityDescriptorSnapshotDTO,
  WalletAddressBindingDTO,
} from "./types";
