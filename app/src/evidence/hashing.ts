import { compareByCodePoint, stableStringify } from "../shared/canonical";

export { stableStringify, compareByCodePoint };
export async function sha256Hex(input: ArrayBuffer | Uint8Array<ArrayBufferLike> | string): Promise<`0x${string}`> {
  const bytes = typeof input === "string"
    ? bytesToArrayBuffer(new TextEncoder().encode(input))
    : input instanceof ArrayBuffer
      ? input
      : bytesToArrayBuffer(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function bytesToArrayBuffer(bytes: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
