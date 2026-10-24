/* UTF-8 文本判定与 base64 dev fixture 解码的单源：适配器只搬运字节，
 * 文本是否有效由这里统一判定，避免各 adapter 各自 decode。
 */

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export function decodeBase64(value: string): Uint8Array | undefined {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    return undefined;
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}
