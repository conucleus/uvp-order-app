// StageEscrowV3 binding read/deposit-intent client. Identity follows the same
// contract as the rest of the kernel: an explicit wallet declaration for local
// runtimes and `x-uvp-store-session` for session-anchored requests. Response
// parsing is fail-closed via ./read; this module never fabricates a binding.

import {
  parseOrderBindings,
  parseOrderSettlementInstructions,
  parseSettlementInstruction,
  parseStageBinding
} from "./read";
import {
  BindingReadError,
  type DepositIntentDTO,
  type DepositTypedData,
  type OrderBindingsReadResult,
  type OrderSettlementInstructionsReadResult,
  type SettlementInstructionDTO,
  type StageBindingReadResult
} from "./types";

export class BindingApiError extends Error {
  override readonly name = "BindingApiError";

  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
    readonly errorCode?: string
  ) {
    super(message);
  }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface BindingApiClientOptions {
  readonly baseUrl: string;
  readonly fetcher?: Fetcher;
  readonly timeoutMs?: number;
  /** Session token from proveWalletControl; sent as x-uvp-store-session. */
  readonly sessionToken?: string;
  /** local/testnet wallet declaration; ignored by the server when a session is present. */
  readonly walletAddress?: string;
  readonly idempotencyKey?: string;
}

export interface DepositIntentReadResult {
  readonly intent: DepositIntentDTO;
  readonly typedData: DepositTypedData;
  readonly replayed: boolean;
}

export interface BindingApiClient {
  getOrderBindings(orderId: string): Promise<OrderBindingsReadResult>;
  getStageBinding(orderId: string, stageKey: string): Promise<StageBindingReadResult>;
  getOrderSettlementInstructions(orderId: string): Promise<OrderSettlementInstructionsReadResult>;
  createDepositIntent(
    orderId: string,
    stageKey: string,
    options?: { readonly idempotencyKey?: string }
  ): Promise<DepositIntentReadResult>;
  /** Sign the current settlement instruction as payer/payee/verifier. */
  signSettlementInstruction(
    orderId: string,
    instructionId: string,
    input: { readonly signature: string }
  ): Promise<SettlementInstructionDTO>;
}

const DEFAULT_TIMEOUT_MS = 6_000;

export function createBindingApiClient(options: BindingApiClientOptions): BindingApiClient {
  if (!options.baseUrl.trim()) {
    throw new Error("binding API baseUrl is required");
  }
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(pathname: string, init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string }) {
    const sessionHeaders = options.sessionToken ? { "x-uvp-store-session": options.sessionToken } : {};
    const headers: Record<string, string> = {
      accept: "application/json",
      ...sessionHeaders,
      ...(init.method === "POST" ? { "content-type": "application/json" } : {}),
      ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {})
    };
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetcher(joinUrl(options.baseUrl, pathname), {
        method: init.method,
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        redirect: "manual",
        signal
      });
    } catch (error) {
      throw new BindingApiError(0, pathname, error instanceof Error ? error.message : "binding request failed");
    }
    if (response.status === 0 || (response.status >= 300 && response.status < 400)) {
      throw new BindingApiError(response.status, pathname, `redirect_refused:${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new BindingApiError(response.status, pathname, "binding response is not JSON");
    }
    if (!response.ok) {
      const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const code = typeof record.error === "string" ? record.error : undefined;
      const message = typeof record.message === "string" ? record.message : `binding request failed with ${response.status}`;
      throw new BindingApiError(response.status, pathname, message, code);
    }
    return { pathname, body };
  }

  function walletQuery(base: string): string {
    if (!options.walletAddress) {
      return base;
    }
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}walletAddress=${encodeURIComponent(options.walletAddress)}`;
  }

  return {
    async getOrderBindings(orderId) {
      const { pathname, body } = await request(
        walletQuery(`/product/orders/${encodeURIComponent(orderId)}/bindings`),
        { method: "GET" }
      );
      try {
        return parseOrderBindings(orderId, body);
      } catch (error) {
        throw asApiError(error, pathname);
      }
    },

    async getStageBinding(orderId, stageKey) {
      const { pathname, body } = await request(
        walletQuery(
          `/product/orders/${encodeURIComponent(orderId)}/stages/${encodeURIComponent(stageKey)}/binding`
        ),
        { method: "GET" }
      );
      try {
        return parseStageBinding(orderId, body);
      } catch (error) {
        throw asApiError(error, pathname);
      }
    },

    async getOrderSettlementInstructions(orderId) {
      const { pathname, body } = await request(
        walletQuery(`/product/orders/${encodeURIComponent(orderId)}/settlement-instructions`),
        { method: "GET" }
      );
      try {
        return parseOrderSettlementInstructions(orderId, body);
      } catch (error) {
        throw asApiError(error, pathname);
      }
    },

    async signSettlementInstruction(orderId, instructionId, input) {
      const { pathname, body } = await request(
        walletQuery(
          `/product/orders/${encodeURIComponent(orderId)}/settlement-instructions/${encodeURIComponent(instructionId)}/signatures`
        ),
        { method: "POST", body: { signature: input.signature } }
      );
      const record = requireObject(body, "signature response is not an object");
      try {
        return parseSettlementInstruction(record.instruction, orderId, "signed instruction");
      } catch (error) {
        throw asApiError(error, pathname);
      }
    },

    async createDepositIntent(orderId, stageKey, intentOptions = {}) {
      const { pathname, body } = await request(
        walletQuery(
          `/product/orders/${encodeURIComponent(orderId)}/stages/${encodeURIComponent(stageKey)}/deposit-intent`
        ),
        {
          method: "POST",
          body: {},
          ...(intentOptions.idempotencyKey
            ? { idempotencyKey: intentOptions.idempotencyKey }
            : options.idempotencyKey
              ? { idempotencyKey: options.idempotencyKey }
              : {})
        }
      );
      try {
        return parseDepositIntent(orderId, stageKey, body);
      } catch (error) {
        throw asApiError(error, pathname);
      }
    }
  };
}

export function parseDepositIntent(
  expectedOrderId: string,
  expectedStageKey: string,
  body: unknown
): DepositIntentReadResult {
  const record = requireObject(body, "deposit intent response is not an object");
  const intent = requireObject(record.intent, "deposit intent response is missing intent");
  const orderId = requireBytes32(intent, "orderId", "deposit intent is missing orderId");
  if (orderId.toLowerCase() !== expectedOrderId.toLowerCase()) {
    throw new BindingReadError("order_id_mismatch", "deposit intent orderId does not match the request");
  }
  if (requireString(intent, "stageKey", "deposit intent is missing stageKey") !== expectedStageKey) {
    throw new BindingReadError("invalid_response", "deposit intent stageKey does not match the request");
  }
  const typedData = requireObject(record.typedData, "deposit intent response is missing typedData");
  const domain = requireObject(typedData.domain, "deposit typedData is missing domain");
  const message = requireObject(typedData.message, "deposit typedData is missing message");
  if (domain.name !== "UVPStageEscrow" || domain.version !== "3") {
    throw new BindingReadError("invalid_response", "deposit typedData domain is not UVPStageEscrow/3");
  }
  const stageId = requireBytes32(intent, "stageId", "deposit intent is missing stageId");
  const trancheId = requireBytes32(intent, "trancheId", "deposit intent is missing trancheId");
  const payer = requireString(intent, "payer", "deposit intent is missing payer");
  const payee = requireString(intent, "payee", "deposit intent is missing payee");
  const verifier = requireString(intent, "verifier", "deposit intent is missing verifier");
  const amount = requireBaseUnits(intent, "amount", "deposit intent is missing amount");
  const nonce = requireString(intent, "nonce", "deposit intent is missing nonce");
  const deadline = requireString(intent, "deadline", "deposit intent is missing deadline");
  if (
    message.orderId !== orderId ||
    message.stageId !== stageId ||
    message.payer !== payer ||
    message.payee !== payee ||
    message.verifier !== verifier ||
    message.amount !== amount ||
    message.nonce !== nonce ||
    message.deadline !== deadline
  ) {
    throw new BindingReadError("invalid_response", "deposit typedData message does not match the intent");
  }
  const feeBps = requireInteger(intent, "feeBps", "deposit intent is missing feeBps");
  const feeRecipient = requireString(intent, "feeRecipient", "deposit intent is missing feeRecipient");
  const typedDataOut: DepositTypedData = {
    types: (typedData.types ?? {}) as DepositTypedData["types"],
    primaryType: "DepositTerms",
    domain: {
      name: "UVPStageEscrow",
      version: "3",
      chainId: requireInteger(domain, "chainId", "deposit typedData domain is missing chainId"),
      verifyingContract: requireString(domain, "verifyingContract", "deposit typedData domain is missing verifyingContract")
    },
    message: {
      orderId,
      stageId,
      payer,
      payee,
      verifier,
      amount,
      feeBps,
      feeRecipient,
      deadline,
      nonce
    }
  };
  return {
    intent: {
      intentId: requireString(intent, "intentId", "deposit intent is missing intentId"),
      chainId: requireInteger(intent, "chainId", "deposit intent is missing chainId"),
      escrowAddress: requireString(intent, "escrowAddress", "deposit intent is missing escrowAddress"),
      orderId,
      stageKey: expectedStageKey,
      stageId,
      trancheId,
      payer,
      payee,
      verifier,
      amount,
      feeBps,
      feeRecipient,
      termsHash: requireBytes32(intent, "termsHash", "deposit intent is missing termsHash"),
      nonce,
      deadline,
      status: requireString(intent, "status", "deposit intent is missing status"),
      typedData: typedDataOut
    },
    typedData: typedDataOut,
    replayed: record.replayed === true
  };
}

function asApiError(error: unknown, pathname: string): BindingApiError {
  if (error instanceof BindingApiError) {
    return error;
  }
  if (error instanceof BindingReadError) {
    return new BindingApiError(0, pathname, error.message, error.code);
  }
  return new BindingApiError(0, pathname, error instanceof Error ? error.message : "invalid binding response");
}

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/${pathname.replace(/^\/+/u, "")}`;
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BindingReadError("invalid_response", message);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, message: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BindingReadError("invalid_response", message);
  }
  return value;
}

function requireBytes32(record: Record<string, unknown>, key: string, message: string): string {
  const value = requireString(record, key, message);
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new BindingReadError("invalid_response", message);
  }
  return value;
}

function requireBaseUnits(record: Record<string, unknown>, key: string, message: string): string {
  const value = requireString(record, key, message);
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new BindingReadError("invalid_response", message);
  }
  return value;
}

function requireInteger(record: Record<string, unknown>, key: string, message: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new BindingReadError("invalid_response", message);
  }
  return value;
}
