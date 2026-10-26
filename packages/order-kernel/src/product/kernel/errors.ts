// 订单域错误面：把服务端 400/401/403/404/409/410/422/503 与传输层失败收敛
// 成稳定 kind + 服务端短码，供宿主分别呈现「未登录 / 越权 / 不存在 / 冲突 /
// 已过期 / 条款不合法 / 上游未就绪 / 结果未知」；不伪造成功，也不吞错误码。

export type ProductErrorKind =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "gone"
  | "invalid_terms"
  | "unavailable"
  | "timeout"
  | "redirect_refused"
  | "invalid_response"
  | "transport"
  | "unknown";

export interface ProductErrorInput {
  readonly status: number;
  readonly endpoint: string;
  readonly message: string;
  readonly kind?: ProductErrorKind | undefined;
  readonly errorCode?: string | undefined;
  readonly details?: unknown;
  readonly bodyText?: string | undefined;
}

export class ProductError extends Error {
  override readonly name = "ProductError";
  readonly status: number;
  readonly endpoint: string;
  readonly kind: ProductErrorKind;
  /** 服务端错误体 `error` 短码；非 JSON 体或传输失败时为空。 */
  readonly errorCode?: string;
  /** 服务端错误体 `details`（如 missing slot 列表）；只在服务端给出时存在。 */
  readonly details?: unknown;
  /** 服务端错误体原文，供展开核对（message 已提取为可读文案时）。 */
  readonly bodyText?: string;

  constructor(input: ProductErrorInput) {
    super(input.message);
    this.status = input.status;
    this.endpoint = input.endpoint;
    this.kind = input.kind ?? classifyProductFailure(input.status, input.message);
    if (input.errorCode !== undefined) {
      this.errorCode = input.errorCode;
    }
    if (input.details !== undefined) {
      this.details = input.details;
    }
    if (input.bodyText !== undefined) {
      this.bodyText = input.bodyText;
    }
  }

  /** 仅 503 与超时可按「稍后重试」呈现；409/410/422 重试不会变好。 */
  get retryable(): boolean {
    return this.kind === "unavailable" || this.kind === "timeout";
  }

}

export function isProductError(value: unknown): value is ProductError {
  return value instanceof ProductError;
}

/** 401 + wallet_identity_required：宿主应切到钱包会话登录，而不是重试同一请求。 */
export function isWalletIdentityRequiredKernel(value: unknown): value is ProductError {
  return isProductError(value)
    && value.status === 401
    && (value.errorCode === undefined || value.errorCode === "wallet_identity_required");
}

export function isProductForbidden(value: unknown): value is ProductError {
  return isProductError(value) && value.kind === "forbidden";
}

export function isProductNotFound(value: unknown): value is ProductError {
  return isProductError(value) && value.kind === "not_found";
}

export function isProductConflict(value: unknown): value is ProductError {
  return isProductError(value) && value.kind === "conflict";
}

export function isProductGone(value: unknown): value is ProductError {
  return isProductError(value) && value.kind === "gone";
}

export function classifyProductFailure(status: number, message: string): ProductErrorKind {
  if (status === 0) {
    if (message.includes("请求超时")) {
      return "timeout";
    }
    if (message.startsWith("redirect_refused")) {
      return "redirect_refused";
    }
    return "invalid_response";
  }
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 410:
      return "gone";
    case 422:
      return "invalid_terms";
    case 503:
      return "unavailable";
    default:
      if (status >= 300 && status < 400) {
        return "redirect_refused";
      }
      if (status >= 500) {
        return "unavailable";
      }
      return "unknown";
  }
}
