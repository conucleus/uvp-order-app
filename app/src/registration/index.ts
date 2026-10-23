/**
 * order app 注册模块的导出面。
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
export { entityRegistrationReadiness } from "./blockers";
export type { EntityRegistrationReadiness } from "./blockers";
export { validateEntityRegistrationDraft } from "./form";
export type {
  AccountAddressDTO,
  AccountAddressesDTO,
  AccountAddressStatus,
  ChainFactPointerDTO,
  EntityRegistrationDTO,
  EntityRegistrationDraft,
  EntityRegistrationErrors,
  EntityRegistrationField,
  EntityRegistrationStatus,
  EntityRegistrationValidation,
  IdentityBindingDTO,
  IdentityBindingQuery,
  IdentityBindingStatus,
  IdentityDescriptorSnapshotDTO,
  RegisterEntityInput,
  WalletAddressBindingDTO,
} from "./types";
