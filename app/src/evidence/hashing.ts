export async function sha256Hex(input: ArrayBuffer | Uint8Array<ArrayBufferLike> | string): Promise<`0x${string}`> {
  const bytes = typeof input === "string"
    ? bytesToArrayBuffer(new TextEncoder().encode(input))
    : input instanceof ArrayBuffer
      ? input
      : bytesToArrayBuffer(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareByCodePoint(left, right))
        .map(([key, nested]) => [key, sortJsonValue(nested)])
    );
  }
  return value;
}

// 码点序等价 UTF-8 字节序，与 uvp-core/uvp-protocol/zhixu-store 的 canonical
// 口径一致；localeCompare 依赖 ICU/locale，同一份证据在不同环境会哈希出
// 不同指纹。按码点而非 UTF-16 码元比较：增补平面字符的代理对
// 在码元序里会排到 U+E000..U+FFFF 之前，偏离字节序。
export function compareByCodePoint(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCode = left.codePointAt(leftIndex)!;
    const rightCode = right.codePointAt(rightIndex)!;
    if (leftCode !== rightCode) {
      return leftCode < rightCode ? -1 : 1;
    }
    leftIndex += leftCode > 0xffff ? 2 : 1;
    rightIndex += rightCode > 0xffff ? 2 : 1;
  }
  return leftIndex < left.length ? 1 : rightIndex < right.length ? -1 : 0;
}

function bytesToArrayBuffer(bytes: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
