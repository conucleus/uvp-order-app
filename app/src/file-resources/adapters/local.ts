/* local 句柄适配器（仅 dev/fixture）：locator.localFile.path 只允许落在显式
 * allowedRoots 之内；相对路径以首个 root 为基准，绝对路径必须命中某个 root；
 * 词法规整之后再 realpath 校验一道，越界统一 invalid_handle，读取失败与不存在
 * 都映射 unavailable。
 */
import type { FileResourceHandleDTO } from "@uvp-eth/product-dto";
import type { FileResourceAdapter } from "../types";
import { FileResourceError } from "../types";

type NodePath = typeof import("node:path");

export interface LocalFileAdapterOptions {
  readonly allowedRoots: readonly string[];
}

export function createLocalFileAdapter(
  options: LocalFileAdapterOptions
): FileResourceAdapter {
  const allowedRoots = options.allowedRoots
    .map((root) => root.trim())
    .filter((root) => root.length > 0);

  return {
    fileType: "local",
    async resolve(handle) {
      const path = await import("node:path");
      const { readFile, realpath } = await import("node:fs/promises");
      const lexicalTarget = resolveLexicalTarget(path, allowedRoots, handle);

      let canonicalTarget: string;
      try {
        canonicalTarget = await realpath(lexicalTarget);
      } catch (error) {
        throw mapFsError(error, handle.key);
      }

      let permitted = false;
      for (const root of allowedRoots) {
        try {
          const canonicalRoot = await realpath(root);
          if (within(path, canonicalRoot, canonicalTarget)) {
            permitted = true;
            break;
          }
        } catch {}
      }
      if (!permitted) {
        throw invalidPath(handle.key);
      }

      try {
        const bytes = await readFile(canonicalTarget);
        return { kind: "bytes", bytes: new Uint8Array(bytes) };
      } catch (error) {
        throw mapFsError(error, handle.key);
      }
    }
  };
}

function resolveLexicalTarget(
  path: NodePath,
  roots: readonly string[],
  handle: FileResourceHandleDTO
): string {
  const primaryRoot = roots[0];
  if (primaryRoot === undefined) {
    throw new FileResourceError(
      "invalid_handle",
      `local 句柄未配置允许目录：${handle.key}`,
      handle.key
    );
  }
  const locator = handle.locator.localFile?.path;
  if (
    typeof locator !== "string" ||
    locator.trim() === "" ||
    locator.includes("\0")
  ) {
    throw invalidPath(handle.key);
  }
  const target = path.isAbsolute(locator)
    ? path.resolve(locator)
    : path.resolve(primaryRoot, locator);
  for (const root of roots) {
    if (within(path, path.resolve(root), target)) {
      return target;
    }
  }
  throw invalidPath(handle.key);
}

function within(path: NodePath, root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function invalidPath(handleKey: string): FileResourceError {
  return new FileResourceError(
    "invalid_handle",
    `local locator 越出允许目录：${handleKey}`,
    handleKey
  );
}

function mapFsError(error: unknown, handleKey: string): FileResourceError {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { readonly code?: unknown }).code)
      : "";
  if (code === "EACCES" || code === "EPERM") {
    return new FileResourceError("unauthorized", `文件权限不足：${handleKey}`, handleKey);
  }
  if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
    return new FileResourceError(
      "unavailable",
      `文件不存在或不可读：${handleKey}`,
      handleKey
    );
  }
  return new FileResourceError("unavailable", `文件读取失败：${handleKey}`, handleKey);
}
