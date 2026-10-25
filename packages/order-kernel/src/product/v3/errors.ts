// V3 订单域错误面：把服务端 400/401/403/404/409/410/422/503 与传输层失败收敛
// 成稳定 kind + 服务端短码，供宿主分别呈现「未登录 / 越权 / 不存在 / 冲突 /
// 已过期 / 条款不合法 / 上游未就绪 / 结果未知」；不伪造成功，也不吞错误码。

export type ProductV3ErrorKind =
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

/** 服务端 OrderV3ErrorCode 的镜像（chain-services service/src/order/v3/types.ts）。 */
export const PRODUCT_V3_ERROR_CODES = [
  "invalid_request",
  "invalid_address",
  "invalid_amount",
  "invalid_fee_bps",
  "invalid_deadline",
  "invalid_window_value",
  "window_override_forbidden",
  "invalid_stage_subset",
  "invalid_stage_terms",
  "invalid_final_standard_hash",
  "invalid_invite_token",
  "invalid_invite_signature",
  "stage_terms_mismatch",
  "invite_nonce_mismatch",
  "wallet_identity_required",
  "wrong_wallet",
  "config_not_found",
  "config_not_published",
  "config_publish_forbidden",
  "config_hash_mismatch",
  "config_version_exists",
  "config_version_not_draft",
  "config_already_published",
  "config_already_deprecated",
  "order_draft_not_found",
  "order_not_found",
  "stage_not_found",
  "slot_not_found",
  "invite_not_found",
  "invite_expired",
  "invite_not_active",
  "invite_already_active",
  "invite_already_accepted",
  "slot_already_accepted",
  "stage_already_accepted",
  "stage_subset_immutable",
  "draft_frozen",
  "order_already_triggered",
  "required_slots_incomplete",
  "order_anchor_unavailable",
  "idempotency_key_reuse",
  "stage_scope_forbidden",
  "wallet_scope_forbidden",
  "visibility_denied",
  "projection_unavailable",
  "instruction_projection_unavailable",
  "handle_not_found",
  "resource_forbidden",
  "resource_parse_failed",
  "resource_unavailable",
  "resolver_unavailable",
  "signal_not_allowed",
  "signal_capability_missing",
  "plan_capability_unavailable",
  "birth_transport_unavailable",
  "birth_route_missing",
  "birth_signer_unavailable",
  "birth_signer_mismatch",
  "birth_broadcast_failed",
  "finalize_signature_required",
  "finalize_not_prepared",
  "finalize_authorization_expired",
  "finalize_authorization_mismatch",
  "fee_override_forbidden",
  "stage_skipped",
  "published_plan_missing",
  "published_plan_invalid",
  "published_plan_unavailable",
  "trigger_transport_unavailable",
  "trigger_result_invalid"
] as const;

export type ProductV3ErrorCode = (typeof PRODUCT_V3_ERROR_CODES)[number];

const KNOWN_CODES: ReadonlySet<string> = new Set(PRODUCT_V3_ERROR_CODES);

export function isKnownProductV3ErrorCode(value: string): value is ProductV3ErrorCode {
  return KNOWN_CODES.has(value);
}

export interface ProductV3ErrorInput {
  readonly status: number;
  readonly endpoint: string;
  readonly message: string;
  readonly kind?: ProductV3ErrorKind | undefined;
  readonly errorCode?: string | undefined;
  readonly details?: unknown;
  readonly bodyText?: string | undefined;
}

export class ProductV3Error extends Error {
  override readonly name = "ProductV3Error";
  readonly status: number;
  readonly endpoint: string;
  readonly kind: ProductV3ErrorKind;
  /** 服务端错误体 `error` 短码；非 JSON 体或传输失败时为空。 */
  readonly errorCode?: string;
  /** 服务端错误体 `details`（如 missing slot 列表）；只在服务端给出时存在。 */
  readonly details?: unknown;
  /** 服务端错误体原文，供展开核对（message 已提取为可读文案时）。 */
  readonly bodyText?: string;

  constructor(input: ProductV3ErrorInput) {
    super(input.message);
    this.status = input.status;
    this.endpoint = input.endpoint;
    this.kind = input.kind ?? classifyProductV3Failure(input.status, input.message);
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

  get knownErrorCode(): ProductV3ErrorCode | undefined {
    return this.errorCode !== undefined && isKnownProductV3ErrorCode(this.errorCode)
      ? this.errorCode
      : undefined;
  }
}

export function isProductV3Error(value: unknown): value is ProductV3Error {
  return value instanceof ProductV3Error;
}

/** 401 + wallet_identity_required：宿主应切到钱包会话登录，而不是重试同一请求。 */
export function isWalletIdentityRequiredV3(value: unknown): value is ProductV3Error {
  return isProductV3Error(value)
    && value.status === 401
    && (value.errorCode === undefined || value.errorCode === "wallet_identity_required");
}

export function isProductV3Forbidden(value: unknown): value is ProductV3Error {
  return isProductV3Error(value) && value.kind === "forbidden";
}

export function isProductV3NotFound(value: unknown): value is ProductV3Error {
  return isProductV3Error(value) && value.kind === "not_found";
}

export function isProductV3Conflict(value: unknown): value is ProductV3Error {
  return isProductV3Error(value) && value.kind === "conflict";
}

export function isProductV3Gone(value: unknown): value is ProductV3Error {
  return isProductV3Error(value) && value.kind === "gone";
}

export function classifyProductV3Failure(status: number, message: string): ProductV3ErrorKind {
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
