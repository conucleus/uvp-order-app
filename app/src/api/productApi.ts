// app 宿主适配层：kernel 只接收显式 baseUrl/超时/会话存储；构建期 env 与
// 浏览器 localStorage 留在这里，保持 order app 既有调用方式与行为不变。

import {
  createProductApiClient as createKernelProductApiClient,
  type ProductApiClient,
  type ProductApiClientOptions,
  type WalletSessionTokenStore
} from "@uvp-eth/order-kernel/product";

export * from "@uvp-eth/order-kernel/product";

const WALLET_SESSION_STORAGE_KEY = "uvp-order-app:wallet-session";

export function readPersistedWalletSessionToken(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(WALLET_SESSION_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function persistWalletSessionToken(token: string | undefined): void {
  try {
    if (token === undefined) {
      globalThis.localStorage?.removeItem(WALLET_SESSION_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(WALLET_SESSION_STORAGE_KEY, token);
    }
  } catch {
  }
}

const browserSessionTokenStore: WalletSessionTokenStore = {
  read: readPersistedWalletSessionToken,
  write: persistWalletSessionToken
};

const DEFAULT_FETCH_TIMEOUT_MS = 6000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;

export function createProductApiClient(options: ProductApiClientOptions = {}): ProductApiClient {
  const baseUrl = options.baseUrl ?? runtimeEnv();
  if (!baseUrl) {
    throw new Error(
      "参与者服务地址未配置：请设置 VITE_UVP_CHAIN_SERVICES_URL。Order App 只连接真实参与者服务，没有本地样例数据回退。"
    );
  }
  return createKernelProductApiClient({
    ...options,
    baseUrl,
    timeoutMs: options.timeoutMs ?? runtimeTimeoutMs("VITE_UVP_ORDER_APP_FETCH_TIMEOUT_MS") ?? DEFAULT_FETCH_TIMEOUT_MS,
    uploadTimeoutMs: options.uploadTimeoutMs ?? runtimeTimeoutMs("VITE_UVP_ORDER_APP_UPLOAD_TIMEOUT_MS") ?? DEFAULT_UPLOAD_TIMEOUT_MS,
    sessionTokenStore: options.sessionTokenStore ?? browserSessionTokenStore
  });
}

function runtimeEnv(): string | undefined {
  return import.meta.env?.VITE_UVP_CHAIN_SERVICES_URL;
}

function runtimeTimeoutMs(name: "VITE_UVP_ORDER_APP_FETCH_TIMEOUT_MS" | "VITE_UVP_ORDER_APP_UPLOAD_TIMEOUT_MS"): number | undefined {
  const raw = name === "VITE_UVP_ORDER_APP_FETCH_TIMEOUT_MS"
    ? import.meta.env?.VITE_UVP_ORDER_APP_FETCH_TIMEOUT_MS
    : import.meta.env?.VITE_UVP_ORDER_APP_UPLOAD_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
