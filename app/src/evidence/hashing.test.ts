import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stableStringify } from "./hashing.js";

describe("evidence canonical hashing", () => {
  it("sorts object keys in plain key order", () => {
    assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
    assert.equal(
      stableStringify({ outer: { z: 1, a: 2 }, list: [3, 1] }),
      '{"list":[3,1],"outer":{"a":2,"z":1}}'
    );
  });

  it("sorts keys by code point order, not locale collation", () => {
    // 码点序等价 UTF-8 字节序：ASCII < 拉丁扩展 < CJK。
    // localeCompare 在多数 locale 下会把 "é" 排到 "z" 之前（口音折叠），
    // 同一证据跨环境哈希漂移。
    const latin = stableStringify({ é: 1, z: 2, 中: 3 });
    assert.equal(latin, '{"z":2,"é":1,"中":3}');
  });

  it("orders astral-plane keys after the BMP like UTF-8 bytes would", () => {
    // UTF-16 码元序会把代理对（增补平面）排到 U+E000..U+FFFF 之前，
    // 偏离字节序；码点序必须把增补平面键排在全部 BMP 键之后。
    const astral = stableStringify({ "\u{10FFFF}": 1, "\uE000": 2 });
    assert.equal(astral, '{"\uE000":2,"\u{10FFFF}":1}');
  });
});
