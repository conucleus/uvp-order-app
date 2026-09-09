import type { ParticipantQueryInput } from "../api/productApi";

export interface ParticipantSession {
  readonly walletAddress?: string;
  readonly walletSource?: "env" | "override";
}

export interface ParticipantSessionReadInput {
  readonly env?: Readonly<Record<string, string | boolean | undefined>>;
  readonly locationSearch?: string;
  readonly sessionStorage?: Pick<Storage, "getItem" | "removeItem" | "setItem">;
}

export const walletOverrideSessionKey = "uvp-order-app:participant-wallet-override";
const walletOverrideQueryKeys = ["participantWallet", "uvpParticipantWallet", "uvpOrderAppWallet"];
const allowedOverrideRuntimes = new Set(["local", "localhost", "development", "dev"]);

export function readParticipantSession(input: ParticipantSessionReadInput = {}): ParticipantSession {
  const env = input.env ?? buildTimeEnv();
  const overrideWallet = readWalletAddressOverride(input, env);
  if (overrideWallet) {
    return { walletAddress: overrideWallet, walletSource: "override" };
  }
  const walletAddress = readWalletAddressEnv(env);
  return walletAddress ? { walletAddress, walletSource: "env" } : {};
}

export function participantQueryFromSession(session: ParticipantSession): ParticipantQueryInput {
  return session.walletAddress ? { walletAddress: session.walletAddress } : {};
}

export function shortWallet(walletAddress: string | undefined): string {
  if (!walletAddress) {
    return "未绑定钱包";
  }
  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}

function readWalletAddressEnv(env: Readonly<Record<string, string | boolean | undefined>> | undefined): string | undefined {
  return envString(env, "VITE_UVP_ORDER_APP_WALLET_ADDRESS")?.trim() || undefined;
}

function readWalletAddressOverride(
  input: ParticipantSessionReadInput,
  env: Readonly<Record<string, string | boolean | undefined>> | undefined
): string | undefined {
  if (!walletOverrideAllowed(env)) {
    return undefined;
  }
  const sessionStorage = input.sessionStorage ?? readBrowserSessionStorage();
  const locationSearch = input.locationSearch ?? readBrowserLocationSearch() ?? "";
  if (!sessionStorage) {
    return undefined;
  }

  const params = new URLSearchParams(locationSearch.startsWith("?") ? locationSearch.slice(1) : locationSearch);
  for (const key of walletOverrideQueryKeys) {
    if (!params.has(key)) {
      continue;
    }
    const value = cleanWalletAddress(params.get(key));
    if (!value) {
      sessionStorage.removeItem(walletOverrideSessionKey);
      return undefined;
    }
    sessionStorage.setItem(walletOverrideSessionKey, value);
    return value;
  }

  return cleanWalletAddress(sessionStorage.getItem(walletOverrideSessionKey));
}

export function walletOverrideAllowed(env: Readonly<Record<string, string | boolean | undefined>> | undefined = buildTimeEnv()): boolean {
  const runtime = (
    envString(env, "VITE_UVP_RUNTIME_ENV") ??
    envString(env, "MODE")
  )?.trim().toLowerCase();
  if (runtime) {
    return allowedOverrideRuntimes.has(runtime);
  }
  return env?.DEV === true;
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
