/* txcloud 句柄适配器占位：locator.txCloudFile 的 bucket/region/objectKey 交给
 * 应用注入的 storage reader；未注入时一律 unavailable，绝不伪造成功，凭据
 * 始终由 reader 侧持有、不进句柄。
 */
import type {
  FileResourceHandleDTO,
  TxCloudFileLocatorDTO
} from "@uvp-eth/product-dto";
import type {
  FileResourceAdapter,
  FileResourcePrincipal
} from "../types";
import { FileResourceError } from "../types";

export interface TxcloudObjectReader {
  readObject(
    locator: TxCloudFileLocatorDTO,
    principal: FileResourcePrincipal
  ): Promise<Uint8Array>;
}

export interface TxcloudFileAdapterOptions {
  readonly reader?: TxcloudObjectReader | undefined;
}

export function createTxcloudFileAdapter(
  options: TxcloudFileAdapterOptions = {}
): FileResourceAdapter {
  const reader = options.reader;

  return {
    fileType: "txcloud",
    async resolve(handle, principal) {
      const locator = readLocator(handle);
      if (!reader) {
        throw new FileResourceError(
          "unavailable",
          `txcloud 句柄需要应用注入 storage client 后解析（V1 占位）：${handle.key}`,
          handle.key
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = await reader.readObject(locator, principal);
      } catch (error) {
        if (error instanceof FileResourceError) {
          throw error;
        }
        throw new FileResourceError(
          "unavailable",
          `txcloud 对象不可达：${handle.key}`,
          handle.key
        );
      }
      if (!(bytes instanceof Uint8Array)) {
        throw new FileResourceError(
          "unavailable",
          `txcloud storage client 未返回字节：${handle.key}`,
          handle.key
        );
      }
      return { kind: "bytes", bytes };
    }
  };
}

function readLocator(handle: FileResourceHandleDTO): TxCloudFileLocatorDTO {
  const locator = handle.locator.txCloudFile;
  if (
    locator === undefined ||
    typeof locator.bucket !== "string" ||
    locator.bucket.trim() === "" ||
    typeof locator.region !== "string" ||
    locator.region.trim() === "" ||
    typeof locator.objectKey !== "string" ||
    locator.objectKey.trim() === ""
  ) {
    throw new FileResourceError(
      "invalid_handle",
      `txcloud locator 缺少 bucket/region/objectKey：${handle.key}`,
      handle.key
    );
  }
  return {
    bucket: locator.bucket,
    region: locator.region,
    objectKey: locator.objectKey
  };
}
