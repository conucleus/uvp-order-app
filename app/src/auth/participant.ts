// order-app 自有的参与者会话解析：构建期 env、地址栏与 sessionStorage 覆写策略
// 都在宿主（kernel 只保留纯读模型类型）。环境覆写只在开发运行时放行。

import type { ParticipantQueryInput } from "../api/productApi";
import type { ParticipantSession } from "@uvp-eth/uvp-client/browser";

export type { ParticipantSession };

export { shortWallet } from "@uvp-eth/uvp-client/browser";

export interface SessionStorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export const walletOverrideSessionKey = "uvp-order-app:participant-wallet-override";
const walletOverrideQueryKeys = ["participantWallet", "uvpParticipantWallet", "uvpOrderAppWallet"];
const allowedOverrideRuntimes = new Set(["local", "localhost", "development", "dev"]);

export interface ParticipantSessionReadInput {
  readonly env?: Readonly<Record<string, string | boolean | undefined>> | undefined;
  readonly locationSearch?: string | undefined;
  readonly sessionStorage?: SessionStorageLike | undefined;
  /** 宿主自己的覆写钱包持久化键；缺省用 app 开发覆写键。 */
  readonly walletOverrideSessionKey?: string | undefined;
  /** 宿主兼容的地址栏覆写参数名；缺省用 app 开发覆写集合。 */
  readonly walletOverrideQueryKeys?: readonly string[] | undefined;
}

export function readParticipantSession(input: ParticipantSessionReadInput = {}): ParticipantSession {
  const env = input.env ?? buildTimeEnv();
  const locationSearch = input.locationSearch ?? readBrowserLocationSearch();
  const sessionStorage = input.sessionStorage ?? readBrowserSessionStorage();
  const overrideWallet = readWalletAddressOverride(
    {
      ...input,
      walletOverrideSessionKey: input.walletOverrideSessionKey ?? walletOverrideSessionKey,
      walletOverrideQueryKeys: input.walletOverrideQueryKeys ?? walletOverrideQueryKeys
    },
    env,
    locationSearch,
    sessionStorage
  );
  if (overrideWallet) {
    return { walletAddress: overrideWallet, walletSource: "override" };
  }
  const walletAddress = readWalletAddressEnv(env);
  return walletAddress ? { walletAddress, walletSource: "env" } : {};
}

export function participantQueryFromSession(session: ParticipantSession): ParticipantQueryInput {
  return session.walletAddress ? { walletAddress: session.walletAddress } : {};
}

export function walletOverrideAllowed(
  env: Readonly<Record<string, string | boolean | undefined>> | undefined = buildTimeEnv()
): boolean {
  const runtime = (
    envString(env, "VITE_UVP_RUNTIME_ENV") ??
    envString(env, "MODE")
  )?.trim().toLowerCase();
  if (runtime) {
    return allowedOverrideRuntimes.has(runtime);
  }
  return env?.DEV === true;
}

function readWalletAddressEnv(
  env: Readonly<Record<string, string | boolean | undefined>> | undefined
): string | undefined {
  return envString(env, "VITE_UVP_ORDER_APP_WALLET_ADDRESS")?.trim() || undefined;
}

function readWalletAddressOverride(
  input: ParticipantSessionReadInput,
  env: Readonly<Record<string, string | boolean | undefined>> | undefined,
  locationSearch: string | undefined,
  sessionStorage: SessionStorageLike | undefined
): string | undefined {
  if (!walletOverrideAllowed(env) || !sessionStorage) {
    return undefined;
  }
  const sessionKey = input.walletOverrideSessionKey ?? walletOverrideSessionKey;
  const queryKeys = input.walletOverrideQueryKeys ?? walletOverrideQueryKeys;
  const search = locationSearch ?? "";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of queryKeys) {
    if (!params.has(key)) {
      continue;
    }
    const value = cleanWalletAddress(params.get(key));
    if (!value) {
      sessionStorage.removeItem(sessionKey);
      return undefined;
    }
    sessionStorage.setItem(sessionKey, value);
    return value;
  }
  return cleanWalletAddress(sessionStorage.getItem(sessionKey));
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

function readBrowserSessionStorage(): SessionStorageLike | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function envString(
  env: Readonly<Record<string, string | boolean | undefined>> | undefined,
  key: string
): string | undefined {
  const value = env?.[key];
  return typeof value === "string" ? value : undefined;
}

function cleanWalletAddress(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return /^0x[0-9a-fA-F]{40}$/u.test(trimmed) ? trimmed : undefined;
}
