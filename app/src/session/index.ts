// 参与者钱包会话：app 自有 transport——POST /store/auth/challenge → 钱包
// personal_sign → POST /store/auth/verify 换取 x-uvp-store-session token。
// token 持久化端口由宿主注入；服务端 generic participant-session 契约尚未
// 提供，当前仍复用 /store/auth 通道（缺口见 README）。

export interface WalletSessionTokenStore {
  read(): string | undefined;
  write(token: string | undefined): void;
}

export type PersonalSigner = (address: string, message: string) => Promise<string>;

export interface ParticipantSessionOptions {
  readonly baseUrl: string;
  readonly personalSign: PersonalSigner;
  readonly tokenStore?: WalletSessionTokenStore | undefined;
  readonly fetcher?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface WalletSessionProof {
  readonly sessionToken: string;
  readonly anchoredAddress: string;
}

export interface ParticipantSession {
  currentSessionToken(): string | undefined;
  restoreSessionToken(token: string | undefined): boolean;
  proveWalletControl(address: string): Promise<WalletSessionProof>;
}

export type ParticipantSessionErrorCode =
  | "invalid_address"
  | "timeout"
  | "transport"
  | "http"
  | "invalid_response";

export class ParticipantSessionError extends Error {
  override readonly name = "ParticipantSessionError";
  readonly code: ParticipantSessionErrorCode;
  readonly status: number | undefined;

  constructor(code: ParticipantSessionErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 6000;

export function createParticipantSession(options: ParticipantSessionOptions): ParticipantSession {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/u, "");
  if (baseUrl.length === 0) {
    throw new Error("参与者服务地址未配置，无法建立钱包会话。");
  }
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tokenStore = options.tokenStore;

  let sessionToken = tokenStore?.read();

  async function postJson(pathname: string, body: unknown): Promise<Record<string, unknown>> {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        // 会话请求携带签名材料：3xx 会把 body 重放到 Location 指向的主机。
        redirect: "manual",
        signal
      });
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "TimeoutError")) {
        throw new ParticipantSessionError("timeout", `钱包会话请求超时（${timeoutMs} 毫秒），结果未知。`);
      }
      throw new ParticipantSessionError("transport", error instanceof Error ? error.message : String(error));
    }
    if (response.status === 0 || (response.status >= 300 && response.status < 400)) {
      throw new ParticipantSessionError("http", `钱包会话接口拒绝重定向（status ${response.status}）。`, response.status);
    }
    if (!response.ok) {
      throw new ParticipantSessionError("http", `钱包会话接口返回 ${response.status}。`, response.status);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ParticipantSessionError("invalid_response", "钱包会话接口返回了非 JSON 响应。", response.status);
    }
    return requireRecord(payload, "钱包会话响应");
  }

  return {
    currentSessionToken() {
      return sessionToken;
    },

    restoreSessionToken(token: string | undefined) {
      const changed = sessionToken !== token;
      sessionToken = token;
      tokenStore?.write(token);
      return changed;
    },

    async proveWalletControl(address: string): Promise<WalletSessionProof> {
      const signerAddress = address.trim();
      if (!/^0x[0-9a-fA-F]{40}$/u.test(signerAddress)) {
        throw new ParticipantSessionError("invalid_address", "钱包地址格式不合法，无法发起会话签名。");
      }
      const challengeBody = requireRecord(
        (await postJson("/store/auth/challenge", { address: signerAddress, intent: "login" })).challenge,
        "challenge"
      );
      const nonce = requireString(challengeBody.nonce, "challenge.nonce");
      const message = requireString(challengeBody.message, "challenge.message");
      const signature = await options.personalSign(signerAddress, message);
      const verified = await postJson("/store/auth/verify", { nonce, signature });
      const token = requireString(verified.token, "token");
      const session = verified.session === undefined ? {} : requireRecord(verified.session, "session");
      const anchoredAddress = typeof session.anchoredAddress === "string" ? session.anchoredAddress : signerAddress;
      sessionToken = token;
      tokenStore?.write(token);
      return { sessionToken: token, anchoredAddress };
    }
  };
}

export function createBrowserWalletSessionTokenStore(
  storageKey = "uvp-order-app:wallet-session"
): WalletSessionTokenStore {
  return {
    read() {
      try {
        return globalThis.localStorage?.getItem(storageKey) ?? undefined;
      } catch {
        return undefined;
      }
    },
    write(token: string | undefined) {
      try {
        if (token === undefined) {
          globalThis.localStorage?.removeItem(storageKey);
        } else {
          globalThis.localStorage?.setItem(storageKey, token);
        }
      } catch {
        // 存储不可用时只保留内存会话：刷新后重新签名，不静默写入别处。
      }
    }
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ParticipantSessionError("invalid_response", `钱包会话响应缺少 ${label}。`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ParticipantSessionError("invalid_response", `钱包会话响应缺少 ${label}。`);
  }
  return value;
}
