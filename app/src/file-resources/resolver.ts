/* FileResourceResolver 的 registry 实现：按 fileType 选择适配器，先做句柄
 * 形状校验与按 visibility/policy 的 principal 授权（fail-closed），再校验
 * 摘要并按需解密；任何失败都抛 FileResourceError，绝不返回空文件。
 * 内容摘要复用 evidence/hashing 的 sha256 单源，密文解密单源在 cipher.ts。
 */
import type {
  FileResourceCipherDTO,
  FileResourceHandleDTO,
  FileResourceLocatorDTO,
  FileResourceType
} from "@uvp-eth/product-dto";
import { sha256Hex } from "../evidence/hashing";
import { createHttpFileAdapter, type HttpFileAdapterOptions } from "./adapters/http";
import { createLocalFileAdapter } from "./adapters/local";
import { createPlainTextFileAdapter } from "./adapters/plainText";
import {
  createTxcloudFileAdapter,
  type TxcloudFileAdapterOptions
} from "./adapters/txcloud";
import { decryptFileResource } from "./cipher";
import { decodeUtf8 } from "./text";
import {
  FileResourceError,
  type FileResourceAdapter,
  type FileResourceAdapterResult,
  type FileResourceAuthorizer,
  type FileResourceKeyProvider,
  type FileResourceMetadata,
  type FileResourcePrincipal,
  type FileResourceResolver,
  type Hex,
  type ResolvedFileResource
} from "./types";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const VISIBILITIES: ReadonlySet<string> = new Set(["public", "protected", "private"]);
const LOCATOR_FIELD_BY_TYPE = {
  http: "httpFile",
  txcloud: "txCloudFile",
  local: "localFile",
  plain_text: "plainText"
} as const satisfies Readonly<Record<FileResourceType, keyof FileResourceLocatorDTO>>;

export interface FileResourceRegistryOptions {
  readonly keyProvider?: FileResourceKeyProvider | undefined;
  readonly authorize?: FileResourceAuthorizer | undefined;
}

export class FileResourceRegistry implements FileResourceResolver {
  readonly #adapters: ReadonlyMap<FileResourceType, FileResourceAdapter>;
  readonly #keyProvider: FileResourceKeyProvider | undefined;
  readonly #authorize: FileResourceAuthorizer | undefined;

  constructor(
    adapters: readonly FileResourceAdapter[],
    options: FileResourceRegistryOptions = {}
  ) {
    const byType = new Map<FileResourceType, FileResourceAdapter>();
    for (const adapter of adapters) {
      if (byType.has(adapter.fileType)) {
        throw new Error(`重复的 fileType 适配器：${adapter.fileType}`);
      }
      byType.set(adapter.fileType, adapter);
    }
    this.#adapters = byType;
    this.#keyProvider = options.keyProvider;
    this.#authorize = options.authorize;
  }

  supports(handle: FileResourceHandleDTO): boolean {
    if (typeof handle !== "object" || handle === null) {
      return false;
    }
    return (
      typeof handle.fileType === "string" && this.#adapters.has(handle.fileType)
    );
  }

  async resolve(
    handle: FileResourceHandleDTO,
    principal: FileResourcePrincipal
  ): Promise<ResolvedFileResource> {
    assertHandleEnvelope(handle);
    const adapter = this.#adapters.get(handle.fileType);
    if (!adapter) {
      throw new FileResourceError(
        "unsupported_file_type",
        `不支持的 fileType：${handle.fileType}`,
        handle.key
      );
    }
    const validated = validateHandleBody(handle);
    await this.#authorizeOrThrow(handle, principal);

    let payload: FileResourceAdapterResult;
    try {
      payload = await adapter.resolve(handle, principal);
    } catch (error) {
      if (error instanceof FileResourceError) {
        throw error;
      }
      throw new FileResourceError("unavailable", `文件读取失败：${handle.key}`, handle.key);
    }
    if (!(payload.bytes instanceof Uint8Array)) {
      throw new FileResourceError(
        "unavailable",
        `适配器未返回字节：${handle.key}`,
        handle.key
      );
    }

    let contentBytes = payload.bytes;
    if (validated.cipherHash !== undefined) {
      const actual = await hashBytes(contentBytes, handle.key);
      if (!sameHash(actual, validated.cipherHash)) {
        throw hashMismatch(handle.key, "密文", validated.cipherHash, actual);
      }
    }
    if (validated.cipher !== undefined) {
      contentBytes = await decryptFileResource({
        cipher: validated.cipher,
        ciphertext: contentBytes,
        handle,
        principal,
        keyProvider: this.#keyProvider
      });
    }
    const plainHash = await verifyOrComputeHash(
      contentBytes,
      validated.contentHash,
      handle.key
    );
    const metadata = validated.metadata;

    if (payload.kind === "text") {
      const content = decodeUtf8(contentBytes);
      if (content === undefined) {
        throw new FileResourceError(
          "invalid_handle",
          `文件内容不是有效 UTF-8 文本：${handle.key}`,
          handle.key
        );
      }
      return { kind: "text", content, hash: plainHash, metadata };
    }
    return { kind: "bytes", content: contentBytes, hash: plainHash, metadata };
  }

  async #authorizeOrThrow(
    handle: FileResourceHandleDTO,
    principal: FileResourcePrincipal
  ): Promise<void> {
    if (
      typeof principal !== "object" ||
      principal === null ||
      typeof principal.id !== "string" ||
      principal.id.trim() === ""
    ) {
      throw new FileResourceError("unauthorized", `缺少有效的 principal：${handle.key}`, handle.key);
    }
    const visibility = handle.visibility ?? "private";
    if (visibility === "public") {
      return;
    }
    if (!this.#authorize) {
      throw new FileResourceError(
        "unauthorized",
        `文件 ${handle.key} 的可见性为 ${visibility}，未配置授权策略`,
        handle.key
      );
    }
    let allowed = false;
    try {
      allowed = await this.#authorize(handle, principal);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      throw new FileResourceError("unauthorized", `无权读取文件：${handle.key}`, handle.key);
    }
  }
}

export interface V1FileResourceResolverOptions {
  readonly localRoots?: readonly string[] | undefined;
  readonly http?: HttpFileAdapterOptions | undefined;
  readonly txcloud?: TxcloudFileAdapterOptions | undefined;
  readonly keyProvider?: FileResourceKeyProvider | undefined;
  readonly authorize?: FileResourceAuthorizer | undefined;
}

export function createV1FileResourceResolver(
  options: V1FileResourceResolverOptions = {}
): FileResourceResolver {
  const adapters: FileResourceAdapter[] = [
    createHttpFileAdapter(options.http),
    createPlainTextFileAdapter(),
    createTxcloudFileAdapter(options.txcloud)
  ];
  if (options.localRoots !== undefined && options.localRoots.length > 0) {
    adapters.push(createLocalFileAdapter({ allowedRoots: options.localRoots }));
  }
  return new FileResourceRegistry(adapters, {
    keyProvider: options.keyProvider,
    authorize: options.authorize
  });
}

interface ValidatedHandleBody {
  readonly contentHash: Hex | undefined;
  readonly cipherHash: Hex | undefined;
  readonly cipher: FileResourceCipherDTO | undefined;
  readonly metadata: FileResourceMetadata;
}

function assertHandleEnvelope(handle: FileResourceHandleDTO): void {
  if (typeof handle !== "object" || handle === null) {
    throw invalidHandle("句柄不是对象");
  }
  if (typeof handle.key !== "string" || handle.key.trim() === "") {
    throw invalidHandle("句柄缺少 key");
  }
  if (typeof handle.fileType !== "string" || handle.fileType.trim() === "") {
    throw invalidHandle(`句柄缺少 fileType：${handle.key}`, handle.key);
  }
}

function validateHandleBody(handle: FileResourceHandleDTO): ValidatedHandleBody {
  assertLocator(handle);
  if (handle.visibility !== undefined && !VISIBILITIES.has(handle.visibility)) {
    throw invalidHandle(`未知 visibility：${String(handle.visibility)}`, handle.key);
  }
  if (
    handle.policyRef !== undefined &&
    (typeof handle.policyRef !== "string" || handle.policyRef.trim() === "")
  ) {
    throw invalidHandle(`policyRef 必须是非空字符串：${handle.key}`, handle.key);
  }
  return {
    contentHash: normalizeHash(handle.contentHash, "contentHash", handle.key),
    cipherHash: normalizeHash(handle.cipherHash, "cipherHash", handle.key),
    cipher: normalizeCipher(handle.cipher, handle.key),
    metadata: normalizeMetadata(handle.metadata, handle.key)
  };
}

function assertLocator(handle: FileResourceHandleDTO): void {
  const locator = handle.locator;
  if (typeof locator !== "object" || locator === null || Array.isArray(locator)) {
    throw invalidHandle(`句柄 locator 必须是对象：${handle.key}`, handle.key);
  }
  const field = LOCATOR_FIELD_BY_TYPE[handle.fileType];
  const value = locator[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidHandle(`句柄 locator 缺少 ${field}：${handle.key}`, handle.key);
  }
}

function normalizeMetadata(
  value: unknown,
  handleKey: string
): FileResourceMetadata {
  if (value === undefined) {
    return {};
  }
  if (!isMetadata(value)) {
    throw invalidHandle(`metadata 必须是对象：${handleKey}`, handleKey);
  }
  return value;
}

function normalizeHash(
  value: unknown,
  field: string,
  handleKey: string
): Hex | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw invalidHandle(
      `${field} 必须是 0x 开头的 32 字节十六进制摘要：${handleKey}`,
      handleKey
    );
  }
  return value.toLowerCase() as Hex;
}

function normalizeCipher(
  value: unknown,
  handleKey: string
): FileResourceCipherDTO | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidHandle(`cipher 必须是对象：${handleKey}`, handleKey);
  }
  const { alg, keyRef } = value as { readonly alg?: unknown; readonly keyRef?: unknown };
  if (
    typeof alg !== "string" ||
    alg.trim() === "" ||
    typeof keyRef !== "string" ||
    keyRef.trim() === ""
  ) {
    throw invalidHandle(`cipher 必须含非空 alg/keyRef：${handleKey}`, handleKey);
  }
  return { alg, keyRef };
}

function isMetadata(value: unknown): value is FileResourceMetadata {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function hashBytes(bytes: Uint8Array, handleKey: string): Promise<Hex> {
  try {
    return await sha256Hex(bytes);
  } catch {
    throw new FileResourceError(
      "unavailable",
      `内容摘要计算失败：${handleKey}`,
      handleKey
    );
  }
}

async function verifyOrComputeHash(
  bytes: Uint8Array,
  expected: Hex | undefined,
  handleKey: string
): Promise<Hex> {
  const actual = await hashBytes(bytes, handleKey);
  if (expected !== undefined && !sameHash(actual, expected)) {
    throw hashMismatch(handleKey, "内容", expected, actual);
  }
  return actual;
}

function sameHash(actual: Hex, expected: Hex): boolean {
  return actual.toLowerCase() === expected.toLowerCase();
}

function hashMismatch(
  handleKey: string,
  label: string,
  expected: Hex,
  actual: Hex
): FileResourceError {
  return new FileResourceError(
    "hash_mismatch",
    `${label} hash 不符：${handleKey}（预期 ${expected}，实际 ${actual}）`,
    handleKey
  );
}

function invalidHandle(message: string, handleKey?: string): FileResourceError {
  return new FileResourceError("invalid_handle", message, handleKey);
}
