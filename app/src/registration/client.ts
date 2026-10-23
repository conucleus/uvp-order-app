/**
 * registration 模块的类型化数据通路；只做 transport 与错误分类。
 */
import { readPersistedWalletSessionToken } from "../api/productApi";
import { personalSignWithInjectedWallet } from "../wallet/injectedWallet";
import type {
  AccountAddressesDTO,
  EntityRegistrationDTO,
  IdentityBindingDTO,
  IdentityBindingQuery,
  IdentityDescriptorSnapshotDTO,
  RegisterEntityInput,
  WalletAddressBindingDTO,
} from "./types";

export type RegistrationFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type RegistrationWalletSigner = (address: string, message: string) => Promise<string>;

export interface RegistrationClientOptions {
  readonly baseUrl?: string | undefined;
  readonly fetcher?: RegistrationFetcher | undefined;
  readonly timeoutMs?: number | undefined;
  readonly getSessionToken?: (() => string | undefined) | undefined;
  readonly signer?: RegistrationWalletSigner | undefined;
}

export interface RegistrationClient {
  loadIdentityBindings(query?: IdentityBindingQuery): Promise<readonly IdentityBindingDTO[]>;
  loadIdentityDescriptor(subjectId: string, descriptorHash: string): Promise<IdentityDescriptorSnapshotDTO>;
  loadAccountAddresses(): Promise<AccountAddressesDTO>;
  bindWalletAddress(input: { readonly address: string }): Promise<WalletAddressBindingDTO>;
  loadMyEntityRegistration(): Promise<EntityRegistrationDTO | undefined>;
  registerEntity(input: RegisterEntityInput): Promise<EntityRegistrationDTO>;
}

export class RegistrationApiError extends Error {
  override readonly name = "RegistrationApiError";
  readonly errorCode?: string;
  readonly bodyText?: string;

  constructor(
    readonly status: number,
    readonly endpoint: string,
    message: string,
    errorCode?: string,
    bodyText?: string,
  ) {
    super(message);
    if (errorCode !== undefined) {
      this.errorCode = errorCode;
    }
    if (bodyText !== undefined) {
      this.bodyText = bodyText;
    }
  }
}

export function isRegistrationApiError(error: unknown): error is RegistrationApiError {
  return error instanceof RegistrationApiError;
}

const DEFAULT_FETCH_TIMEOUT_MS = 6000;

export function createRegistrationClient(options: RegistrationClientOptions = {}): RegistrationClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? runtimeBaseUrl());
  if (!baseUrl) {
    throw new Error(
      "参与者服务地址未配置：请设置 VITE_UVP_CHAIN_SERVICES_URL。注册模块只连接真实参与者服务，没有本地样例数据回退。",
    );
  }
  return new HttpRegistrationClient({
    baseUrl,
    fetcher: options.fetcher ?? globalThis.fetch.bind(globalThis),
    timeoutMs: options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
    getSessionToken: options.getSessionToken ?? readPersistedWalletSessionToken,
    signer: options.signer ?? ((address, message) => personalSignWithInjectedWallet({ address, message })),
  });
}

interface HttpRegistrationClientConfig {
  readonly baseUrl: string;
  readonly fetcher: RegistrationFetcher;
  readonly timeoutMs: number;
  readonly getSessionToken: () => string | undefined;
  readonly signer: RegistrationWalletSigner;
}

class HttpRegistrationClient implements RegistrationClient {
  constructor(private readonly config: HttpRegistrationClientConfig) {}

  async loadIdentityBindings(query: IdentityBindingQuery = {}): Promise<readonly IdentityBindingDTO[]> {
    const params = new URLSearchParams();
    const account = query.account?.trim();
    if (account) {
      params.set("account", account);
    }
    if (query.activeOnly !== undefined) {
      params.set("activeOnly", query.activeOnly ? "true" : "false");
    }
    const queryString = params.size > 0 ? `?${params.toString()}` : "";
    const response = await this.requestJson<{ readonly bindings: readonly IdentityBindingDTO[] }>(
      "GET",
      `/identity/bindings${queryString}`,
      undefined,
      undefined,
    );
    return response.bindings;
  }

  async loadIdentityDescriptor(subjectId: string, descriptorHash: string): Promise<IdentityDescriptorSnapshotDTO> {
    const pathname = `/identity/descriptors/${encodeURIComponent(subjectId)}/${encodeURIComponent(descriptorHash)}`;
    return await this.requestJson<IdentityDescriptorSnapshotDTO>("GET", pathname, undefined, undefined);
  }

  async loadAccountAddresses(): Promise<AccountAddressesDTO> {
    const sessionToken = this.requireSessionToken("/store/auth/addresses");
    return await this.requestJson<AccountAddressesDTO>("GET", "/store/auth/addresses", undefined, sessionToken);
  }

  async loadMyEntityRegistration(): Promise<EntityRegistrationDTO | undefined> {
    const endpoint = "/product/registration/me";
    const sessionToken = this.requireSessionToken(endpoint);
    const response = await this.requestJson<{ readonly registration: EntityRegistrationDTO | null }>(
      "GET",
      endpoint,
      undefined,
      sessionToken,
    );
    return response.registration ?? undefined;
  }

  async registerEntity(input: RegisterEntityInput): Promise<EntityRegistrationDTO> {
    const endpoint = "/product/registration";
    const sessionToken = this.requireSessionToken(endpoint);
    const response = await this.requestJson<{ readonly registration: EntityRegistrationDTO }>(
      "POST",
      endpoint,
      {
        legalName: input.legalName.trim(),
        registrationNumber: input.registrationNumber.trim(),
        contactName: input.contactName.trim(),
      },
      sessionToken,
    );
    return response.registration;
  }

  async bindWalletAddress(input: { readonly address: string }): Promise<WalletAddressBindingDTO> {
    const endpoint = "/store/auth/challenge";
    const sessionToken = this.requireSessionToken(endpoint);
    const address = input.address.trim();
    if (!/^0x[0-9a-fA-F]{40}$/u.test(address)) {
      throw new RegistrationApiError(0, endpoint, "钱包地址格式不合法，无法发起地址归属签名。", "invalid_wallet_address");
    }
    const challenge = await this.requestJson<{
      readonly challenge: { readonly nonce: string; readonly message: string };
    }>("POST", "/store/auth/challenge", { address, intent: "anchor_address" }, sessionToken);
    const signature = await this.config.signer(address, challenge.challenge.message);
    const verified = await this.requestJson<{
      readonly session: { readonly accountId: string; readonly anchoredAddress: string };
      readonly linkedToExistingAccount: boolean;
    }>("POST", "/store/auth/verify", { nonce: challenge.challenge.nonce, signature }, sessionToken);
    const addresses = await this.requestJson<AccountAddressesDTO>("GET", "/store/auth/addresses", undefined, sessionToken);
    return {
      accountId: addresses.accountId,
      anchoredAddress: verified.session.anchoredAddress,
      linkedToExistingAccount: verified.linkedToExistingAccount,
      addresses: addresses.addresses,
    };
  }

  private requireSessionToken(endpoint: string): string {
    const token = this.config.getSessionToken()?.trim();
    if (!token) {
      throw new RegistrationApiError(
        0,
        endpoint,
        "需要钱包会话：请先完成钱包登录，再读写账号级档案。",
        "store_session_required",
      );
    }
    return token;
  }

  private async requestJson<TResponse>(
    method: string,
    pathname: string,
    body: unknown,
    sessionToken: string | undefined,
  ): Promise<TResponse> {
    const signal = AbortSignal.timeout(this.config.timeoutMs);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (sessionToken) {
      headers["x-uvp-store-session"] = sessionToken;
    }
    let response: Response;
    try {
      response = await withTimeout(
        this.config.fetcher(joinUrl(this.config.baseUrl, pathname), {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "manual",
          signal,
        }),
        signal,
      );
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "TimeoutError")) {
        throw new RegistrationApiError(
          0,
          pathname,
          `请求超时（${this.config.timeoutMs} 毫秒），服务端可能已处理本次请求。`,
        );
      }
      throw error;
    }
    if (response.status === 0 || (response.status >= 300 && response.status < 400)) {
      throw new RegistrationApiError(response.status, pathname, `redirect_refused:${response.status}`, "redirect_refused");
    }
    if (!response.ok) {
      const text = await responseText(response);
      let errorCode: string | undefined;
      let serverMessage: string | undefined;
      try {
        const parsed = JSON.parse(text) as { readonly error?: unknown; readonly message?: unknown };
        if (typeof parsed.error === "string") {
          errorCode = parsed.error;
        }
        if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
          serverMessage = parsed.message;
        }
      } catch {
      }
      throw new RegistrationApiError(
        response.status,
        pathname,
        serverMessage ?? text,
        errorCode,
        serverMessage !== undefined ? text : undefined,
      );
    }
    try {
      return await response.json() as TResponse;
    } catch (error) {
      throw new RegistrationApiError(
        response.status,
        pathname,
        error instanceof Error ? error.message : "response_not_json",
      );
    }
  }
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
      },
    );
  });
}

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim().replace(/\/+$/u, "");
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function runtimeBaseUrl(): string | undefined {
  return import.meta.env?.VITE_UVP_CHAIN_SERVICES_URL;
}

async function responseText(response: Response): Promise<string> {
  const text = await response.text();
  return text.length > 0 ? text : `${response.status} ${response.statusText}`;
}
