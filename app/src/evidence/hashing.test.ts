import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stableStringify } from "./hashing.js";

describe("evidence canonical hashing", () => {
  it("orders astral-plane keys after the BMP like UTF-8 bytes would", () => {
    const astral = stableStringify({ "\u{10FFFF}": 1, "\uE000": 2 });
    assert.equal(astral, '{"\uE000":2,"\u{10FFFF}":1}');
  });
});
