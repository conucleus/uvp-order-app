// V3 订单域 HTTP 传输：会话头、超时、拒绝跟随重定向与错误体解析都与现有
// product client 同口径；失败一律抛 ProductV3Error（status/短码/可读文案），
// 2xx 但形状不符按 invalid_response 处理，不把畸形响应当成空结果。

import { ProductV3Error } from "./errors";
import type { ProductV3Fetcher, ProductV3RequestOptions, ProductV3SessionTokenProvider } from "./types";

export const PRODUCT_V3_SESSION_HEADER = "x-uvp-store-session";
export const PRODUCT_V3_IDEMPOTENCY_HEADER = "idempotency-key";
export const DEFAULT_PRODUCT_V3_TIMEOUT_MS = 6000;

export interface ProductV3TransportConfig {
  readonly baseUrl: string;
  readonly fetcher: ProductV3Fetcher;
  readonly timeoutMs: number;
  readonly sessionToken?: string | undefined;
  readonly getSessionToken?: ProductV3SessionTokenProvider | undefined;
}

export class ProductV3Transport {
  readonly #config: ProductV3TransportConfig;
  #sessionToken: string | undefined;

  constructor(config: ProductV3TransportConfig) {
    this.#config = config;
    this.#sessionToken = config.sessionToken;
  }

  currentSessionToken(): string | undefined {
    return this.#resolveSessionToken();
  }

  restoreSessionToken(token: string | undefined): boolean {
    const changed = this.#sessionToken !== token;
    this.#sessionToken = token;
    return changed;
  }

  async request<T>(
    method: "GET" | "POST" | "PATCH",
    pathname: string,
    body: unknown,
    options: ProductV3RequestOptions = {},
  ): Promise<T> {
    const timeoutMs = this.#config.timeoutMs;
    const signal = AbortSignal.timeout(timeoutMs);
    const sessionToken = this.#resolveSessionToken();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (sessionToken !== undefined) {
      headers[PRODUCT_V3_SESSION_HEADER] = sessionToken;
    }
    if (options.idempotencyKey !== undefined) {
      headers[PRODUCT_V3_IDEMPOTENCY_HEADER] = options.idempotencyKey;
    }

    let response: Response;
    try {
      response = await withTimeout(
        this.#config.fetcher(joinUrl(this.#config.baseUrl, pathname), {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          // 会话头随请求发送：3xx 会让凭据头重放到 Location 指向的任意主机。
          redirect: "manual",
          signal
        }),
        signal
      );
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "TimeoutError")) {
        throw new ProductV3Error({
          status: 0,
          endpoint: pathname,
          kind: "timeout",
          message: `请求超时（${timeoutMs} 毫秒），服务端可能已处理本次请求。`
        });
      }
      throw new ProductV3Error({
        status: 0,
        endpoint: pathname,
        kind: "transport",
        message: `请求未送达：${errorMessage(error)}`
      });
    }

    if (response.status === 0 || (response.status >= 300 && response.status < 400)) {
      throw new ProductV3Error({
        status: response.status,
        endpoint: pathname,
        kind: "redirect_refused",
        message: `redirect_refused:${response.status}`
      });
    }
    if (!response.ok) {
      throw await errorFromResponse(response, pathname);
    }
    try {
      return await response.json() as T;
    } catch (error) {
      throw invalidResponse(pathname, `2xx 响应不是 JSON：${errorMessage(error)}`);
    }
  }

  #resolveSessionToken(): string | undefined {
    const provided = this.#config.getSessionToken?.();
    if (provided !== undefined) {
      return provided;
    }
    return this.#sessionToken;
  }
}

export function invalidResponse(endpoint: string, message: string): ProductV3Error {
  return new ProductV3Error({ status: 0, endpoint, kind: "invalid_response", message });
}

export function requireRecord(value: unknown, endpoint: string, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse(endpoint, message);
  }
  return value as Record<string, unknown>;
}

export function requireString(
  record: Readonly<Record<string, unknown>>,
  field: string,
  endpoint: string,
  message?: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidResponse(endpoint, message ?? `响应缺少 ${field}`);
  }
  return value;
}

export function requireArray(
  record: Readonly<Record<string, unknown>>,
  field: string,
  endpoint: string,
): readonly unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw invalidResponse(endpoint, `响应缺少 ${field} 数组`);
  }
  return value;
}

export function optionalRecord(
  record: Readonly<Record<string, unknown>>,
  field: string,
  endpoint: string,
): Record<string, unknown> | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  return requireRecord(value, endpoint, `响应中的 ${field} 不是对象`);
}

async function errorFromResponse(response: Response, pathname: string): Promise<ProductV3Error> {
  const text = await response.text();
  const bodyText = text.length > 0 ? text : `${response.status} ${response.statusText}`;
  let errorCode: string | undefined;
  let serverMessage: string | undefined;
  let details: unknown;
  try {
    const parsed = JSON.parse(bodyText) as { readonly error?: unknown; readonly message?: unknown; readonly details?: unknown };
    if (typeof parsed.error === "string") {
      errorCode = parsed.error;
    }
    if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
      serverMessage = parsed.message;
    }
    if (parsed.details !== undefined) {
      details = parsed.details;
    }
  } catch {
    // 非 JSON 错误体只有文本可用。
  }
  return new ProductV3Error({
    status: response.status,
    endpoint: pathname,
    message: serverMessage ?? bodyText,
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(details !== undefined ? { details } : {}),
    ...(serverMessage !== undefined ? { bodyText } : {})
  });
}

function withTimeout(promise: Promise<Response>, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("signal aborted", "TimeoutError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort);
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
