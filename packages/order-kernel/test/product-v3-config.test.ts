// V3 配置摊平：bundle → 宿主可渲染的 stage 列表（验收方式、必须邀请的 slot、
// 标准句柄、时间表达式、token 小数位来源），派生规则与服务端 canonical 同口径。

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  flattenConfigVersion,
  flatStageByKey,
  isStandardHash,
  resolveTokenDecimals,
  slotLabel
} from "../src/product/v3/index";
import {
  CONFIG_HASH,
  PLAN_HASH,
  PLAN_ID,
  STAGE_ID_SOURCING,
  configVersionFixture
} from "./fixtures";

describe("flattenConfigVersion", () => {
  it("flattens every stage with stable keys and derived slot lists", () => {
    const flat = flattenConfigVersion(configVersionFixture());
    assert.equal(flat.configId, "used-car/proxy_buy");
    assert.equal(flat.version, "3.0.0");
    assert.equal(flat.configHash, CONFIG_HASH);
    assert.equal(flat.planId, PLAN_ID);
    assert.equal(flat.planHash, PLAN_HASH);
    assert.equal(flat.currency, "USDT");
    assert.deepEqual(flat.stages.map((stage) => stage.stageKey), ["requirements", "sourcing", "inspection"]);
    assert.equal(flat.defaultProfile, "default3");
    assert.deepEqual(flat.profiles.default3, ["requirements", "sourcing", "inspection"]);
    assert.equal(flat.feeBpsDefault, 100);
  });

  it("derives acceptance modes and invite slots like the server", () => {
    const flat = flattenConfigVersion(configVersionFixture());
    const requirements = flatStageByKey(flat, "requirements");
    assert.ok(requirements);
    assert.equal(requirements.funded, false);
    assert.equal(requirements.defaultAcceptance, "none");
    assert.deepEqual(requirements.requiredSlotKeys, []);
    assert.deepEqual(requirements.performerSlots, []);
    assert.deepEqual(requirements.verifierSlots, []);

    const sourcing = flatStageByKey(flat, "sourcing");
    assert.ok(sourcing);
    assert.equal(sourcing.funded, true);
    assert.equal(sourcing.defaultAcceptance, "self");
    assert.deepEqual(sourcing.requiredSlotKeys, ["performer"]);
    assert.deepEqual(sourcing.performerSlots.map((slot) => [slot.slotKey, slot.role]), [["performer", "performer"]]);
    assert.equal(sourcing.timeExpression, "approved +14d");
    assert.equal(sourcing.verifierSlotDeclared, false);

    const inspection = flatStageByKey(flat, "inspection");
    assert.ok(inspection);
    assert.equal(inspection.defaultAcceptance, "third_party");
    assert.equal(inspection.verifierSlot, "verifier");
    assert.equal(inspection.verifierSlotDeclared, true);
    assert.deepEqual(inspection.requiredSlotKeys, ["performer", "verifier"]);
    assert.deepEqual(inspection.verifierSlots.map((slot) => slot.slotKey), ["verifier"]);
    assert.equal(slotLabel(flat, "performer"), "履约方");
  });

  it("resolves standard handles and their hashes from the bundle", () => {
    const flat = flattenConfigVersion(configVersionFixture());
    const sourcing = flatStageByKey(flat, "sourcing");
    assert.ok(sourcing?.defaultStandard);
    assert.equal(sourcing.defaultStandard.resolvable, true);
    assert.equal(sourcing.defaultStandard.ref, "standards/sourcing.md");

    const inspection = flatStageByKey(flat, "inspection");
    assert.ok(inspection?.defaultStandard);
    assert.equal(inspection.defaultStandard.resolvable, true, "sha256:<64 hex> is accepted by the server");
    assert.equal(isStandardHash(inspection.defaultStandard.hash), true);
  });

  it("only carries stageId when the server already derived it", () => {
    const withoutIds = flattenConfigVersion(configVersionFixture());
    assert.equal(flatStageByKey(withoutIds, "sourcing")?.stageId, undefined);

    const withIds = flattenConfigVersion(configVersionFixture(), {
      stageIds: { sourcing: STAGE_ID_SOURCING }
    });
    assert.equal(flatStageByKey(withIds, "sourcing")?.stageId, STAGE_ID_SOURCING);
    assert.equal(flatStageByKey(withIds, "inspection")?.stageId, undefined);
  });

  it("derives token decimals from currency but never guesses unknown ones", () => {
    const usdt = flattenConfigVersion(configVersionFixture());
    assert.equal(usdt.tokenDecimals, 6);
    assert.equal(usdt.tokenDecimalsSource, "currency");

    const overridden = flattenConfigVersion(configVersionFixture(), { tokenDecimals: 18 });
    assert.equal(overridden.tokenDecimals, 18);
    assert.equal(overridden.tokenDecimalsSource, "override");

    const base = configVersionFixture();
    const { currency: _currency, ...withoutCurrency } = base;
    const unknown = { ...withoutCurrency, bundle: { ...base.bundle, currency: "XYZ" } };
    const flatUnknown = flattenConfigVersion(unknown);
    assert.equal(flatUnknown.tokenDecimals, undefined);
    assert.equal(flatUnknown.tokenDecimalsSource, "unknown");
    assert.ok(flatUnknown.tokenDecimalsProblem);
  });
});

describe("resolveTokenDecimals", () => {
  it("prefers an explicit per-currency override", () => {
    assert.deepEqual(resolveTokenDecimals("USDT"), { ok: true, decimals: 6, source: "currency" });
    assert.deepEqual(resolveTokenDecimals("usdt", { USDT: 18 }), { ok: true, decimals: 18, source: "override" });
    assert.deepEqual(resolveTokenDecimals(undefined), {
      ok: false,
      reason: "配置没有声明 currency，无法确定 token 小数位"
    });
  });
});
