// 参与者会话的 headless 读模型：构建期 env、地址栏与 sessionStorage 都由
// 宿主注入；本模块只做“显式覆写优先、否则构建期命令钱包”的纯判定，不直接
// 访问 window/localStorage。环境覆写只在开发运行时放行。

import type { ParticipantQueryInput } from "../product/productApi";

export interface ParticipantSession {
  readonly walletAddress?: string;
  readonly walletSource?: "env" | "override";
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface ParticipantSessionReadInput {
  readonly env?: Readonly<Record<string, string | boolean | undefined>> | undefined;
  readonly locationSearch?: string | undefined;
  readonly sessionStorage?: SessionStorageLike | undefined;
  /** 宿主自己的覆写钱包持久化键；缺省用 kernel 的通用键。 */
  readonly walletOverrideSessionKey?: string | undefined;
  /** 宿主兼容的地址栏覆写参数名；缺省用 kernel 的通用集合。 */
  readonly walletOverrideQueryKeys?: readonly string[] | undefined;
}

export const DEFAULT_WALLET_OVERRIDE_SESSION_KEY = "uvp-participant-wallet-override";
const DEFAULT_OVERRIDE_QUERY_KEYS = ["participantWallet", "uvpParticipantWallet"] as const;
const allowedOverrideRuntimes = new Set(["local", "localhost", "development", "dev"]);

export function readParticipantSession(input: ParticipantSessionReadInput = {}): ParticipantSession {
  const env = input.env;
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

export function walletOverrideAllowed(env: Readonly<Record<string, string | boolean | undefined>> | undefined): boolean {
  const runtime = (
    envString(env, "VITE_UVP_RUNTIME_ENV") ??
    envString(env, "MODE")
  )?.trim().toLowerCase();
  if (runtime) {
    return allowedOverrideRuntimes.has(runtime);
  }
  return env?.DEV === true;
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
  const sessionStorage = input.sessionStorage;
  const locationSearch = input.locationSearch ?? "";
  if (!sessionStorage) {
    return undefined;
  }
  const sessionKey = input.walletOverrideSessionKey ?? DEFAULT_WALLET_OVERRIDE_SESSION_KEY;
  const queryKeys = input.walletOverrideQueryKeys ?? DEFAULT_OVERRIDE_QUERY_KEYS;

  const params = new URLSearchParams(locationSearch.startsWith("?") ? locationSearch.slice(1) : locationSearch);
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
