/* fileResource 解析层行为用例：摘要校验、HTTP 状态映射、local 路径边界、
 * 加密包装、未知 fileType 各自断言到具体错误码；不测 adapter 内部机械。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileResourceHandleDTO } from "@uvp-eth/product-dto";
import { sha256Hex } from "../evidence/hashing.js";
import {
  FileResourceError,
  createV1FileResourceResolver,
  type FileResourceErrorCode,
  type FileResourcePrincipal
} from "./index.js";

const principal: FileResourcePrincipal = { id: "participant-1" };
const textHeaders = { "content-type": "text/plain; charset=utf-8" };

describe("fileResource resolver", () => {
  it("resolves http text when the handle content hash matches", async () => {
    const body = "sample declaration";
    const resolver = createV1FileResourceResolver({
      http: { fetcher: async () => new Response(body, { status: 200, headers: textHeaders }) }
    });

    const resolved = await resolver.resolve(
      {
        key: "declaration",
        fileType: "http",
        locator: { httpFile: { url: "https://files.example/declaration.txt" } },
        visibility: "public",
        contentHash: await sha256Hex(body)
      },
      principal
    );

    assert.ok(resolved.kind === "text");
    assert.equal(resolved.content, body);
    assert.equal(resolved.hash, await sha256Hex(body));
  });

  it("rejects http content when the handle content hash does not match", async () => {
    const resolver = createV1FileResourceResolver({
      http: {
        fetcher: async () =>
          new Response("sample declaration", { status: 200, headers: textHeaders })
      }
    });

    await assert.rejects(
      resolver.resolve(
        {
          key: "declaration",
          fileType: "http",
          locator: { httpFile: { url: "https://files.example/declaration.txt" } },
          visibility: "public",
          contentHash: await sha256Hex("another document")
        },
        principal
      ),
      isFileResourceError("hash_mismatch")
    );
  });

  it("maps http 401 to unauthorized", async () => {
    const resolver = createV1FileResourceResolver({
      http: { fetcher: async () => new Response("denied", { status: 401 }) }
    });

    await assert.rejects(
      resolver.resolve(httpHandle(), principal),
      isFileResourceError("unauthorized")
    );
  });

  it("maps http 404 to unavailable", async () => {
    const resolver = createV1FileResourceResolver({
      http: { fetcher: async () => new Response("missing", { status: 404 }) }
    });

    await assert.rejects(
      resolver.resolve(httpHandle(), principal),
      isFileResourceError("unavailable")
    );
  });

  it("rejects local locators that escape the allowed root", async () => {
    const resolver = createV1FileResourceResolver({
      localRoots: ["/tmp/file-resources-fixture"]
    });

    await assert.rejects(
      resolver.resolve(
        {
          key: "outside",
          fileType: "local",
          locator: { localFile: { path: "../secret.txt" } },
          visibility: "public"
        },
        principal
      ),
      isFileResourceError("invalid_handle")
    );
  });

  it("resolves a base64 plain_text fixture as text", async () => {
    const body = "hello 单证";
    const resolver = createV1FileResourceResolver();

    const resolved = await resolver.resolve(
      {
        key: "fixture",
        fileType: "plain_text",
        locator: { plainText: { ref: Buffer.from(body, "utf8").toString("base64") } },
        visibility: "public",
        contentHash: await sha256Hex(body)
      },
      principal
    );

    assert.ok(resolved.kind === "text");
    assert.equal(resolved.content, body);
    assert.equal(resolved.hash, await sha256Hex(body));
  });

  it("fails decrypt_failed when an encrypted handle has no key provider", async () => {
    const resolver = createV1FileResourceResolver();

    await assert.rejects(
      resolver.resolve(
        {
          key: "secret",
          fileType: "plain_text",
          locator: { plainText: { ref: Buffer.from("secret", "utf8").toString("base64") } },
          visibility: "public",
          cipher: { alg: "AES-GCM", keyRef: "fixture-key" }
        },
        principal
      ),
      isFileResourceError("decrypt_failed")
    );
  });

  it("decrypts with the injected key and verifies the plaintext hash", async () => {
    const body = "encrypted sample";
    const plaintext = new TextEncoder().encode(body);
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
    );
    const payload = new Uint8Array(iv.length + ciphertext.length);
    payload.set(iv, 0);
    payload.set(ciphertext, iv.length);
    const resolver = createV1FileResourceResolver({
      keyProvider: { getKey: async () => key }
    });

    const resolved = await resolver.resolve(
      {
        key: "encrypted",
        fileType: "plain_text",
        locator: { plainText: { ref: Buffer.from(payload).toString("base64") } },
        visibility: "public",
        cipher: { alg: "AES-GCM", keyRef: "fixture-key" },
        contentHash: await sha256Hex(plaintext)
      },
      principal
    );

    assert.ok(resolved.kind === "text");
    assert.equal(resolved.content, body);
  });

  it("rejects onchain handles as unsupported_file_type in V1", async () => {
    const resolver = createV1FileResourceResolver();
    const handle = {
      key: "anchor",
      fileType: "onchain",
      locator: { httpFile: { url: "0xanchor" } },
      visibility: "public"
    } as unknown as FileResourceHandleDTO;

    assert.equal(resolver.supports(handle), false);
    await assert.rejects(
      resolver.resolve(handle, principal),
      isFileResourceError("unsupported_file_type")
    );
  });
});

function httpHandle(): FileResourceHandleDTO {
  return {
    key: "declaration",
    fileType: "http",
    locator: { httpFile: { url: "https://files.example/declaration.txt" } },
    visibility: "public"
  };
}

function isFileResourceError(
  code: FileResourceErrorCode
): (error: unknown) => boolean {
  return (error) => error instanceof FileResourceError && error.code === code;
}
