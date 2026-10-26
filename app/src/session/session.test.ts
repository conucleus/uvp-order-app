// 钱包会话行为：challenge → 钱包签名 → verify → token 持久化。
// 断言点落在请求形状、签名消息与 token 单源，不测 fetch 机械。

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createParticipantSession,
  ParticipantSessionError,
  type WalletSessionTokenStore
} from "./index";

const ADDRESS = "0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f";

function memoryStore(initial?: string): WalletSessionTokenStore & { readonly written: (string | undefined)[] } {
  let value = initial;
  const written: (string | undefined)[] = [];
  return {
    written,
    read: () => value,
    write(token) {
      value = token;
      written.push(token);
    }
  };
}

describe("participant wallet session", () => {
  it("signs the challenge message, verifies the nonce, and keeps the token in the injected store", async () => {
    const requests: { readonly url: string; readonly body: unknown }[] = [];
    const signed: { readonly address: string; readonly message: string }[] = [];
    const store = memoryStore("tok-restored");
    const session = createParticipantSession({
      baseUrl: "http://product-api.test",
      tokenStore: store,
      fetcher: async (input, init) => {
        const url = String(input);
        requests.push({ url, body: JSON.parse(String(init?.body)) });
        if (url.endsWith("/store/auth/challenge")) {
          return json({ challenge: { nonce: "nonce-1", message: "UVP login nonce-1", address: ADDRESS } });
        }
        if (url.endsWith("/store/auth/verify")) {
          return json({ token: "uvs_token_1", session: { anchoredAddress: ADDRESS } });
        }
        throw new Error(`unexpected url ${url}`);
      },
      personalSign: async (address, message) => {
        signed.push({ address, message });
        return "0xsignature";
      }
    });

    assert.equal(session.currentSessionToken(), "tok-restored");
    const proof = await session.proveWalletControl(ADDRESS);

    assert.deepEqual(proof, { sessionToken: "uvs_token_1", anchoredAddress: ADDRESS });
    assert.deepEqual(signed, [{ address: ADDRESS, message: "UVP login nonce-1" }]);
    assert.deepEqual(requests, [
      { url: "http://product-api.test/store/auth/challenge", body: { address: ADDRESS, intent: "login" } },
      { url: "http://product-api.test/store/auth/verify", body: { nonce: "nonce-1", signature: "0xsignature" } }
    ]);
    assert.equal(session.currentSessionToken(), "uvs_token_1");
    assert.deepEqual(store.written, ["uvs_token_1"]);
  });

  it("surfaces an HTTP failure with its status instead of minting a token", async () => {
    const session = createParticipantSession({
      baseUrl: "http://product-api.test",
      fetcher: async () => new Response("{}", { status: 401 }),
      personalSign: async () => "0xsignature"
    });
    await assert.rejects(
      () => session.proveWalletControl(ADDRESS),
      (error) => error instanceof ParticipantSessionError && error.code === "http" && error.status === 401
    );
    assert.equal(session.currentSessionToken(), undefined);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
