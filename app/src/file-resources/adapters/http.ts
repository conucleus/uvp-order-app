/* http 句柄适配器：只按 locator.httpFile.url 取字节并把 HTTP 状态映射为
 * resolver 错误码；不读取也不发送任何凭据，URL 不允许携带 userinfo。
 */
import type { FileResourceHandleDTO } from "@uvp-eth/product-dto";
import type { FileResourceAdapter } from "../types";
import { FileResourceError } from "../types";
import { decodeUtf8 } from "../text";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 15_000;
const TEXTUAL_CONTENT_TYPE = /^(?:text\/)|(?:json|xml|csv|yaml|x-www-form-urlencoded)/iu;

export interface HttpFileAdapterOptions {
  readonly fetcher?: Fetcher | undefined;
  readonly timeoutMs?: number | undefined;
}

export function createHttpFileAdapter(
  options: HttpFileAdapterOptions = {}
): FileResourceAdapter {
  const fetcher =
    options.fetcher ??
    ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    fileType: "http",
    async resolve(handle) {
      const url = parseHttpUrl(handle);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await withTimeout(
          fetcher(url, { method: "GET", signal: controller.signal }),
          controller.signal
        );
      } catch {
        throw controller.signal.aborted
          ? new FileResourceError(
              "unavailable",
              `读取文件超时（${timeoutMs} 毫秒）：${handle.key}`,
              handle.key
            )
          : new FileResourceError("unavailable", `文件不可达：${handle.key}`, handle.key);
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 401 || response.status === 403) {
        throw new FileResourceError(
          "unauthorized",
          `文件访问被拒绝（${response.status}）：${handle.key}`,
          handle.key
        );
      }
      if (response.status === 404) {
        throw new FileResourceError(
          "unavailable",
          `文件不存在或不可达（404）：${handle.key}`,
          handle.key
        );
      }
      if (!response.ok) {
        throw new FileResourceError(
          "unavailable",
          `文件读取失败（${response.status}）：${handle.key}`,
          handle.key
        );
      }

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch {
        throw new FileResourceError("unavailable", `文件读取失败：${handle.key}`, handle.key);
      }
      const mimeType = (response.headers.get("content-type") ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase() ?? "";
      const kind =
        TEXTUAL_CONTENT_TYPE.test(mimeType) && decodeUtf8(bytes) !== undefined
          ? "text"
          : "bytes";
      return { kind, bytes };
    }
  };
}

function parseHttpUrl(handle: FileResourceHandleDTO): URL {
  const raw = handle.locator.httpFile?.url;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new FileResourceError(
      "invalid_handle",
      `http locator 缺少 url：${handle.key}`,
      handle.key
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FileResourceError(
      "invalid_handle",
      `http locator 不是合法 URL：${handle.key}`,
      handle.key
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FileResourceError(
      "invalid_handle",
      `http locator 只支持 http(s)：${handle.key}`,
      handle.key
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new FileResourceError(
      "invalid_handle",
      `http locator 不得携带凭据：${handle.key}`,
      handle.key
    );
  }
  return url;
}

function withTimeout(
  promise: Promise<Response>,
  signal: AbortSignal
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new DOMException("signal aborted", "TimeoutError"));
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
