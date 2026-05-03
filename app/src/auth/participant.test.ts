import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  participantQueryFromSession,
  readParticipantSession,
  walletOverrideAllowed,
  walletOverrideSessionKey
} from "./participant.js";

const selectorWallet = "0x1111111111111111111111111111111111111111";
const customsWallet = "0x2222222222222222222222222222222222222222";

describe("participant session wallet selection", () => {
  it("lets local/testnet rehearsals switch participant wallet through a guarded query override", () => {
    const storage = memorySessionStorage();
    const session = readParticipantSession({
      env: {
        VITE_UVP_RUNTIME_ENV: "testnet",
        VITE_UVP_ORDER_APP_WALLET_ADDRESS: selectorWallet
      },
      locationSearch: `?participantWallet=${customsWallet}`,
      sessionStorage: storage
    });

    assert.equal(session.walletAddress, customsWallet);
    assert.equal(session.walletSource, "override");
    assert.deepEqual(participantQueryFromSession(session), { walletAddress: customsWallet });
    assert.equal(storage.getItem(walletOverrideSessionKey), customsWallet);
  });

  it("keeps wallet overrides disabled in production profiles", () => {
    const storage = memorySessionStorage([[walletOverrideSessionKey, customsWallet]]);
    const session = readParticipantSession({
      env: {
        VITE_UVP_RUNTIME_ENV: "production",
        VITE_UVP_ORDER_APP_WALLET_ADDRESS: selectorWallet
      },
      locationSearch: `?participantWallet=${customsWallet}`,
      sessionStorage: storage
    });

    assert.equal(walletOverrideAllowed({ VITE_UVP_RUNTIME_ENV: "production" }), false);
    assert.equal(session.walletAddress, selectorWallet);
    assert.equal(session.walletSource, "env");
  });

  it("does not treat invalid override text as a participant wallet", () => {
    const storage = memorySessionStorage([[walletOverrideSessionKey, customsWallet]]);
    const session = readParticipantSession({
      env: { VITE_UVP_RUNTIME_ENV: "local" },
      locationSearch: "?participantWallet=not-a-wallet",
      sessionStorage: storage
    });

    assert.equal(session.walletAddress, undefined);
    assert.equal(storage.getItem(walletOverrideSessionKey), null);
  });
});

function memorySessionStorage(entries: readonly (readonly [string, string])[] = []): Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  const values = new Map(entries);
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}
