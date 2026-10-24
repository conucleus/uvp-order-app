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

// 构建期注入的静态值集合：每个键都经 import.meta.env.X 静态成员访问
// （Vite 构建时内联为字面量），不把整个 env 对象留在运行期——随包分发
// 环境开关是禁止形态。测试用例经 input.env 注入自己的值。
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
