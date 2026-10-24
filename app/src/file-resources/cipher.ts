/* 句柄声明的密文解密单源：算法为 AES-GCM，密文布局是 12 字节 IV 前缀
 * 加密文本体；密钥只经注入的 KeyProvider 取得，句柄/日志/错误信息里
 * 只允许出现 handle key 与 keyRef，不出现密钥材料。
 */
import type {
  FileResourceCipherDTO,
  FileResourceHandleDTO
} from "@uvp-eth/product-dto";
import type {
  FileResourceKeyProvider,
  FileResourcePrincipal
} from "./types";
import { FileResourceError } from "./types";

const AES_GCM = "AES-GCM";
const AES_GCM_IV_BYTES = 12;

export interface DecryptFileResourceInput {
  readonly cipher: FileResourceCipherDTO;
  readonly ciphertext: Uint8Array;
  readonly handle: FileResourceHandleDTO;
  readonly principal: FileResourcePrincipal;
  readonly keyProvider: FileResourceKeyProvider | undefined;
}

export async function decryptFileResource(
  input: DecryptFileResourceInput
): Promise<Uint8Array> {
  if (input.cipher.alg.trim().toUpperCase() !== AES_GCM) {
    throw decryptFailed(input.handle.key);
  }
  const keyProvider = input.keyProvider;
  if (!keyProvider) {
    throw decryptFailed(input.handle.key);
  }
  let key: CryptoKey | undefined;
  try {
    key = await keyProvider.getKey(input.cipher.keyRef, {
      handle: input.handle,
      principal: input.principal
    });
  } catch {
    throw decryptFailed(input.handle.key);
  }
  if (!key || input.ciphertext.byteLength <= AES_GCM_IV_BYTES) {
    throw decryptFailed(input.handle.key);
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: AES_GCM,
        iv: toArrayBuffer(input.ciphertext.subarray(0, AES_GCM_IV_BYTES))
      },
      key,
      toArrayBuffer(input.ciphertext.subarray(AES_GCM_IV_BYTES))
    );
    return new Uint8Array(plaintext);
  } catch {
    throw decryptFailed(input.handle.key);
  }
}

function decryptFailed(handleKey: string): FileResourceError {
  return new FileResourceError("decrypt_failed", `文件解密失败：${handleKey}`, handleKey);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
