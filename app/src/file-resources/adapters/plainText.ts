/* plain_text 句柄适配器：locator.plainText.ref 是 base64 编码的本地 fixture
 * 内容引用，仅作 dev/演示；生产文件不走此类型，文本有效性与摘要校验由
 * resolver 统一做。
 */
import type { FileResourceAdapter } from "../types";
import { FileResourceError } from "../types";
import { decodeBase64 } from "../text";

export function createPlainTextFileAdapter(): FileResourceAdapter {
  return {
    fileType: "plain_text",
    async resolve(handle) {
      const ref = handle.locator.plainText?.ref;
      if (typeof ref !== "string" || ref.trim() === "") {
        throw new FileResourceError(
          "invalid_handle",
          `plain_text locator 缺少 ref：${handle.key}`,
          handle.key
        );
      }
      const bytes = decodeBase64(ref);
      if (!bytes) {
        throw new FileResourceError(
          "invalid_handle",
          `plain_text ref 不是合法 base64：${handle.key}`,
          handle.key
        );
      }
      return { kind: "text", bytes };
    }
  };
}
