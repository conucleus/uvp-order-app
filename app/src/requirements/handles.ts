/* 要求包句柄的解析视图：句柄元数据与解析状态分开承载，失败按 resolver
 * 错误码精确到因（无权限/不可达/解密失败/摘要不符/类型不支持），绝不把
 * 读取失败坍缩成“没有文件”。授权按 public/protected/private 与本单开单人/
 * 已接受参与方判定，解析正文只留在内存视图，密钥与存储凭据不进 UI。
 */
import type { FileResourceHandleDTO } from "@uvp-eth/product-dto";
import {
  FileResourceError,
  createV1FileResourceResolver,
  type FileResourcePrincipal,
  type FileResourceResolver,
  type ResolvedFileResource
} from "../file-resources";

export type HandleResolutionStatus =
  | "pending"
  | "resolved"
  | "unauthorized"
  | "unavailable"
  | "decrypt_failed"
  | "hash_mismatch"
  | "unsupported"
  | "invalid_handle";

export interface HandleResolutionView {
  readonly status: HandleResolutionStatus;
  readonly resolved?: ResolvedFileResource | undefined;
}

export interface RequirementsAccess {
  /** 要求包声明人（服务端字段）；private 句柄只对他可解析。 */
  readonly declarerWallet: string;
  /** 本单已接受参与方钱包（protected 句柄的读取面）。 */
  readonly acceptedWallets: readonly string[];
}

export function createRequirementsResolver(access: RequirementsAccess): FileResourceResolver {
  const declarer = access.declarerWallet.trim().toLowerCase();
  const accepted = new Set(
    access.acceptedWallets.map((wallet) => wallet.trim().toLowerCase()).filter(Boolean)
  );
  return createV1FileResourceResolver({
    authorize: (handle, principal) => {
      const wallet = principal.walletAddress?.trim().toLowerCase();
      if (!wallet) {
        return false;
      }
      const visibility = handle.visibility ?? "private";
      if (visibility === "private") {
        return wallet === declarer;
      }
      return wallet === declarer || accepted.has(wallet);
    }
  });
}

export function fileResourcePrincipal(walletAddress: string | undefined): FileResourcePrincipal {
  const wallet = walletAddress?.trim();
  return wallet
    ? { id: wallet.toLowerCase(), walletAddress: wallet }
    : { id: "anonymous" };
}

export async function resolveFileHandle(
  handle: FileResourceHandleDTO,
  resolver: FileResourceResolver,
  principal: FileResourcePrincipal
): Promise<HandleResolutionView> {
  try {
    return { status: "resolved", resolved: await resolver.resolve(handle, principal) };
  } catch (error) {
    return { status: handleStatusFromError(error) };
  }
}

export function handleStatusFromError(error: unknown): HandleResolutionStatus {
  if (!(error instanceof FileResourceError)) {
    // resolver 之外的意外失败同样不是“没有文件”；按不可达呈现。
    return "unavailable";
  }
  switch (error.code) {
    case "unauthorized":
      return "unauthorized";
    case "unavailable":
      return "unavailable";
    case "decrypt_failed":
      return "decrypt_failed";
    case "hash_mismatch":
      return "hash_mismatch";
    case "unsupported_file_type":
      return "unsupported";
    case "invalid_handle":
      return "invalid_handle";
    default:
      return "unavailable";
  }
}

export function handleStatusLabel(status: HandleResolutionStatus): string {
  switch (status) {
    case "pending":
      return "解析中";
    case "resolved":
      return "已解析";
    case "unauthorized":
      return "无权读取";
    case "unavailable":
      return "不可达 / 读取失败";
    case "decrypt_failed":
      return "解密失败";
    case "hash_mismatch":
      return "摘要不符";
    case "unsupported":
      return "类型不支持";
    case "invalid_handle":
      return "句柄非法";
  }
}

/** 失败原因固定文案：与“没有文件”显式区分，不暴露存储位置或凭据。 */
export function handleFailureCopy(status: HandleResolutionStatus): string | undefined {
  switch (status) {
    case "unauthorized":
      return "当前钱包无权解析该句柄（按 visibility/policy fail-closed），不等于没有文件。";
    case "unavailable":
      return "文件读取失败或不可达，不等于没有文件。";
    case "decrypt_failed":
      return "解密失败（缺少可用密钥或密文校验未通过），不等于没有文件。";
    case "hash_mismatch":
      return "摘要不符：解析出的内容与服务端承诺的 hash 不一致。";
    case "unsupported":
      return "该 fileType 不在本端可解析闭集内，V1 不新增句柄类型。";
    case "invalid_handle":
      return "句柄结构非法，无法解析。";
    default:
      return undefined;
  }
}
