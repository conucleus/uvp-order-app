/* fileResource 句柄解析层（A 口径）的公共出口：principal/解析结果与错误码
 * 类型、resolver registry、V1 四类适配器都从这里取；句柄类型本身以
 * @uvp-eth/product-dto 为单源，正文、密钥与存储凭据不进句柄，解析失败以
 * 错误码返回而不坍缩成空文件。
 */
export {
  FileResourceError,
  type FileResourceAdapter,
  type FileResourceAdapterResult,
  type FileResourceAuthorizer,
  type FileResourceErrorCode,
  type FileResourceKeyContext,
  type FileResourceKeyProvider,
  type FileResourceMetadata,
  type FileResourcePrincipal,
  type FileResourceResolver,
  type Hex,
  type ResolvedFileResource
} from "./types";
export {
  FileResourceRegistry,
  createV1FileResourceResolver,
  type FileResourceRegistryOptions,
  type V1FileResourceResolverOptions
} from "./resolver";
export {
  createHttpFileAdapter,
  type HttpFileAdapterOptions
} from "./adapters/http";
export {
  createLocalFileAdapter,
  type LocalFileAdapterOptions
} from "./adapters/local";
export { createPlainTextFileAdapter } from "./adapters/plainText";
export {
  createTxcloudFileAdapter,
  type TxcloudFileAdapterOptions,
  type TxcloudObjectReader
} from "./adapters/txcloud";
