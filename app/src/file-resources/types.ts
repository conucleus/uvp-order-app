/* fileResource 句柄解析层的公共契约（A 口径）：句柄形状、fileType 闭集与
 * locator 均取自 @uvp-eth/product-dto 的订单要求包 DTO，本模块不自造第二套；
 * 正文/密钥/存储凭据一律不进句柄。
 */
import type {
  FileResourceHandleDTO,
  FileResourceType
} from "@uvp-eth/product-dto";

export type Hex = `0x${string}`;

export type FileResourceMetadata = Readonly<Record<string, unknown>>;

export interface FileResourcePrincipal {
  readonly id: string;
  readonly walletAddress?: string | undefined;
  readonly scopes?: readonly string[] | undefined;
}

export type ResolvedFileResource =
  | {
      readonly kind: "text";
      readonly content: string;
      readonly hash: Hex;
      readonly metadata: FileResourceMetadata;
    }
  | {
      readonly kind: "bytes";
      readonly content: Uint8Array;
      readonly hash: Hex;
      readonly metadata: FileResourceMetadata;
    };

export type FileResourceErrorCode =
  | "unsupported_file_type"
  | "unavailable"
  | "unauthorized"
  | "decrypt_failed"
  | "hash_mismatch"
  | "invalid_handle";

export class FileResourceError extends Error {
  override readonly name = "FileResourceError";

  constructor(
    readonly code: FileResourceErrorCode,
    message: string,
    readonly handleKey?: string
  ) {
    super(message);
  }
}

export interface FileResourceAdapterResult {
  readonly kind: "text" | "bytes";
  readonly bytes: Uint8Array;
}

export interface FileResourceAdapter {
  readonly fileType: FileResourceType;
  resolve(
    handle: FileResourceHandleDTO,
    principal: FileResourcePrincipal
  ): Promise<FileResourceAdapterResult>;
}

export type FileResourceAuthorizer = (
  handle: FileResourceHandleDTO,
  principal: FileResourcePrincipal
) => boolean | Promise<boolean>;

export interface FileResourceKeyContext {
  readonly handle: FileResourceHandleDTO;
  readonly principal: FileResourcePrincipal;
}

export interface FileResourceKeyProvider {
  getKey(
    keyRef: string,
    context: FileResourceKeyContext
  ): Promise<CryptoKey | undefined>;
}

export interface FileResourceResolver {
  supports(handle: FileResourceHandleDTO): boolean;
  resolve(
    handle: FileResourceHandleDTO,
    principal: FileResourcePrincipal
  ): Promise<ResolvedFileResource>;
}
