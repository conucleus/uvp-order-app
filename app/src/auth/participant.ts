// 参与者会话纯逻辑已迁入 kernel；本文件保留 app 的构建期 env、地址栏与
// sessionStorage 适配，保持既有导入面与开发运行时覆写行为。

import {
  readParticipantSession as readKernelParticipantSession,
  walletOverrideAllowed as kernelWalletOverrideAllowed,
  type ParticipantSession,
  type ParticipantSessionReadInput
} from "@uvp-eth/order-kernel/session/participant";

export {
  participantQueryFromSession,
  shortWallet
} from "@uvp-eth/order-kernel/session/participant";
export type {
  ParticipantSession,
  ParticipantSessionReadInput,
  SessionStorageLike
} from "@uvp-eth/order-kernel/session/participant";

export const walletOverrideSessionKey = "uvp-order-app:participant-wallet-override";
const walletOverrideQueryKeys = ["participantWallet", "uvpParticipantWallet", "uvpOrderAppWallet"];

export function readParticipantSession(input: ParticipantSessionReadInput = {}): ParticipantSession {
  return readKernelParticipantSession({
    ...input,
    walletOverrideSessionKey: input.walletOverrideSessionKey ?? walletOverrideSessionKey,
    walletOverrideQueryKeys: input.walletOverrideQueryKeys ?? walletOverrideQueryKeys,
    env: input.env ?? buildTimeEnv(),
    locationSearch: input.locationSearch ?? readBrowserLocationSearch(),
    sessionStorage: input.sessionStorage ?? readBrowserSessionStorage()
  });
}

export function walletOverrideAllowed(
  env: Readonly<Record<string, string | boolean | undefined>> | undefined = buildTimeEnv()
): boolean {
  return kernelWalletOverrideAllowed(env);
}

function buildTimeEnv(): Readonly<Record<string, string | boolean | undefined>> {
  return {
    VITE_UVP_ORDER_APP_WALLET_ADDRESS: import.meta.env?.VITE_UVP_ORDER_APP_WALLET_ADDRESS,
    VITE_UVP_RUNTIME_ENV: import.meta.env?.VITE_UVP_RUNTIME_ENV,
    MODE: import.meta.env?.MODE,
    DEV: import.meta.env?.DEV
  };
}

function readBrowserLocationSearch(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.search;
}

function readBrowserSessionStorage(): Pick<Storage, "getItem" | "removeItem" | "setItem"> | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
